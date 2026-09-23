import type { CommandContext } from './context.js';
import { MigrationError } from './errors.js';
import type { MigrationDeclaration } from './module.js';
import { untilCommitted, type MemorySession, type Transactor } from './unit-of-work.js';

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

  await transactor.run(context, async (uow) => {
    agreeWithJournal(plan, await journal.applied(uow.session));
  });

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const migration of plan) {
    const didApply = await untilCommitted(() =>
      transactor.run(context, async (uow) => {
        const done = await journal.applied(uow.session);
        if (done.has(migration.id)) return false;
        try {
          await migration.up(uow.session);
        } catch (cause) {
          throw new MigrationError(`The migration "${migration.id}" failed.`, { cause });
        }
        await journal.record(uow.session, migration.id);
        return true;
      }),
    );
    (didApply ? applied : alreadyApplied).push(migration.id);
  }

  return Object.freeze({
    applied: Object.freeze(applied),
    alreadyApplied: Object.freeze(alreadyApplied),
  });
}

/** `sys.0001-tenant` belongs to `sys`; `defineModule` refuses any other shape. */
const moduleOf = (id: string): string => id.slice(0, id.indexOf('.'));

/**
 * Refuses a plan that disagrees with what the store says has already run.
 *
 * The journal is keyed by identifier, so it cannot tell a new migration from an
 * old one renamed. Without this, a release that renamed `0003` ran it again
 * under its new name against live data, and a release that inserted `0002`
 * before an applied `0003` ran it after — against a shape that had already
 * moved past it. Both went through without a word.
 *
 * Only the modules the plan names are compared. A module the journal knows and
 * the plan does not is one this edition no longer ships, and its record is
 * history rather than a disagreement.
 */
function agreeWithJournal<Session>(
  plan: readonly MigrationDeclaration<Session>[],
  done: ReadonlySet<string>,
): void {
  const planned = new Set(plan.map((migration) => migration.id));
  const modules = new Set(plan.map((migration) => moduleOf(migration.id)));

  for (const id of [...done].sort()) {
    if (modules.has(moduleOf(id)) && !planned.has(id)) {
      throw new MigrationError(
        `The store records "${id}" as applied and this plan does not contain it. A migration ` +
          'renamed or removed after it ran would otherwise run again under its new name.',
      );
    }
  }

  const waiting = new Map<string, string>();
  for (const { id } of plan) {
    const module = moduleOf(id);
    const earlier = waiting.get(module);
    if (done.has(id) && earlier !== undefined) {
      throw new MigrationError(
        `"${earlier}" has not run and "${id}", which comes after it, has. Running it now would ` +
          'apply it against a shape that has already moved past it.',
      );
    }
    if (!done.has(id) && earlier === undefined) waiting.set(module, id);
  }
}

const JOURNAL_PREFIX = 'platform.migration.';

/**
 * A journal in the memory store, for a module's own tests.
 *
 * It lives in the same store as everything else the migration writes, which is
 * the property that matters: rolling back a failed migration rolls back its
 * journal entry too, exactly as the real one will.
 */
export function recordJournal(): MigrationJournal<MemorySession> {
  return {
    applied(session: MemorySession): Promise<ReadonlySet<string>> {
      const ids = session
        .keys()
        .filter((key) => key.startsWith(JOURNAL_PREFIX))
        .map((key) => {
          if (session.get(key) !== true)
            throw new MigrationError(`Corrupted migration journal entry at "${key}".`);
          return key.slice(JOURNAL_PREFIX.length);
        });
      return Promise.resolve(new Set(ids));
    },
    record(session: MemorySession, id: string): Promise<void> {
      session.put(`${JOURNAL_PREFIX}${id}`, true);
      return Promise.resolve();
    },
  };
}

/** The same transactional journal over the memory driver in module tests. */
export const memoryJournal = recordJournal;
