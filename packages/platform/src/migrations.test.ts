import { newId, systemClock } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import { commandContext, type CommandContext } from './context.js';
import { createEventBus } from './events.js';
import { MigrationError } from './errors.js';
import { memoryJournal, runMigrations } from './migrations.js';
import type { MigrationDeclaration } from './module.js';
import {
  createMemoryStore,
  createTransactor,
  type MemorySession,
  type MemoryStore,
  type Transactor,
} from './unit-of-work.js';

function store(): {
  store: MemoryStore;
  transactor: Transactor<MemorySession>;
  context: CommandContext;
} {
  const memory = createMemoryStore();
  const bus = createEventBus({
    onHandlerFailure: () => {
      throw new Error('a migration publishes nothing');
    },
  });
  return {
    store: memory,
    transactor: createTransactor({
      driver: memory.driver,
      bus,
      clock: systemClock,
      onEffectFailure: () => {
        throw new Error('a migration defers nothing');
      },
    }),
    context: commandContext({ tenant: newId<'tenant'>() }),
  };
}

const plan: readonly MigrationDeclaration<MemorySession>[] = [
  {
    id: 'sys.0001-tenant',
    target: 'both',
    up: (session) => {
      session.put('table:tenant', []);
      return Promise.resolve();
    },
  },
  {
    id: 'sec.0001-user',
    target: 'store-node',
    up: (session) => {
      session.put('table:user', []);
      return Promise.resolve();
    },
  },
];

describe('runMigrations', () => {
  it('applies what has not run, and records it', async () => {
    const { store: memory, transactor, context } = store();

    const outcome = await runMigrations({ plan, transactor, context, journal: memoryJournal() });

    expect(outcome.applied).toEqual(['sys.0001-tenant', 'sec.0001-user']);
    expect(outcome.alreadyApplied).toEqual([]);
    expect(memory.committed().has('table:user')).toBe(true);
  });

  it('does nothing the second time, which is what upgrading an edition needs', async () => {
    // modules.md §4: enabling a module later runs its migrations against live
    // data. The ones already applied must be left alone, and knowing which is
    // the journal's whole job.
    const { transactor, context } = store();
    const journal = memoryJournal();

    await runMigrations({ plan, transactor, context, journal });
    const second = await runMigrations({ plan, transactor, context, journal });

    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(['sys.0001-tenant', 'sec.0001-user']);
  });

  it('leaves neither the change nor its record when a migration fails', async () => {
    // The pair has to be atomic. A schema that moved and a journal that says it
    // did not is a store that runs the same migration again on the next start,
    // against the shape it has already produced.
    const { store: memory, transactor, context } = store();
    const journal = memoryJournal();
    const failing: readonly MigrationDeclaration<MemorySession>[] = [
      plan[0]!,
      {
        id: 'sec.0002-role',
        target: 'both',
        up: (session) => {
          session.put('table:role', []);
          return Promise.reject(new Error('the column already exists'));
        },
      },
    ];

    await expect(runMigrations({ plan: failing, transactor, context, journal })).rejects.toThrow(
      MigrationError,
    );

    expect(memory.committed().has('table:tenant')).toBe(true);
    expect(memory.committed().has('table:role')).toBe(false);
    expect([...memory.committed().keys()].some((key) => key.includes('sec.0002-role'))).toBe(false);
  });

  it('refuses a plan that names one migration twice', async () => {
    const { transactor, context } = store();
    await expect(
      runMigrations({
        plan: [plan[0]!, plan[0]!],
        transactor,
        context,
        journal: memoryJournal(),
      }),
    ).rejects.toThrow(MigrationError);
  });
});
