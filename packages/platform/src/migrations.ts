import type { CommandContext } from './context.js';
import { MigrationError } from './errors.js';
import type { MigrationDeclaration } from './module.js';
import type { MemorySession, Transactor } from './unit-of-work.js';

/**
 * Applying a module's schema, once, and knowing that it was applied.
 *
 * modules.md §4 rule 4 requires each module to own its migrations and states
 * the case that shapes this file: **enabling a module later runs its migrations
 * against live data**. A customer upgrading their edition is not a fresh
 * install, so a migration has to be idempotent at the level of the journal —
 * run once, recorded, never run again — rather than at the level of the SQL,
 * which nobody can guarantee.
 */
export interface MigrationJournal<Session> {
  applied(session: Session): Promise<ReadonlySet<string>>;
  record(session: Session, id: string): Promise<void>;
}

export interface MigrationOutcome {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export interface RunMigrationsOptions<Session> {
  readonly plan: readonly MigrationDeclaration<Session>[];
  readonly transactor: Transactor<Session>;
  readonly context: CommandContext;
  readonly journal: MigrationJournal<Session>;
}

/**
 * Runs the migrations of a plan that have not run yet.
 *
 * One transaction per migration, with the journal entry written **inside that
 * same transaction**. That is the whole design: a crash between applying a
 * migration and recording it would leave a store whose schema has moved and
 * whose journal says it has not, and the next start would run the migration
 * again against the shape it had already produced.
 *
 * Migrations run in the registry's activation order, so a module's tables exist
 * before those of anything that depends on it.
 */
export async function runMigrations<Session>(
  options: RunMigrationsOptions<Session>,
): Promise<MigrationOutcome> {
  const { plan, transactor, context, journal } = options;

  const seen = new Set<string>();
  for (const migration of plan) {
    if (seen.has(migration.id)) {
      throw new MigrationError(`The plan holds the migration "${migration.id}" twice.`);
    }
    seen.add(migration.id);
  }

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const migration of plan) {
    await transactor.run(context, async (uow) => {
      const done = await journal.applied(uow.session);
      if (done.has(migration.id)) {
        alreadyApplied.push(migration.id);
        return;
      }
      try {
        await migration.up(uow.session);
      } catch (cause) {
        throw new MigrationError(`The migration "${migration.id}" failed.`, { cause });
      }
      await journal.record(uow.session, migration.id);
      applied.push(migration.id);
    });
  }

  return Object.freeze({
    applied: Object.freeze(applied),
    alreadyApplied: Object.freeze(alreadyApplied),
  });
}

const JOURNAL_PREFIX = 'platform.migration.';

/**
 * A journal in the memory store, for a module's own tests.
 *
 * It lives in the same store as everything else the migration writes, which is
 * the property that matters: rolling back a failed migration rolls back its
 * journal entry too, exactly as the real one will.
 */
export function memoryJournal(): MigrationJournal<MemorySession> {
  return {
    applied(session: MemorySession): Promise<ReadonlySet<string>> {
      const ids = session
        .keys()
        .filter((key) => key.startsWith(JOURNAL_PREFIX))
        .map((key) => key.slice(JOURNAL_PREFIX.length));
      return Promise.resolve(new Set(ids));
    },
    record(session: MemorySession, id: string): Promise<void> {
      session.put(`${JOURNAL_PREFIX}${id}`, true);
      return Promise.resolve();
    },
  };
}
