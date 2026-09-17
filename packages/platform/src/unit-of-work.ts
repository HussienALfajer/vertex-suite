import { newId, type Clock, type Instant } from '@vertex/kernel';

import type { CommandContext } from './context.js';
import { SerialisationConflictError } from './errors.js';
import type { DomainEvent, EventBus, EventType } from './events.js';

/**
 * One command, one transaction.
 *
 * The unit of work is what makes that true rather than aspirational: it holds
 * the store session the command writes through, the events it produced, and the
 * effects it wants to happen only if it survives.
 *
 * SYN-05 is the acceptance criterion the whole shape exists for — killing the
 * power at any point during a sale leaves a complete sale or no sale, and never
 * a printed receipt without a stored one. A receipt is therefore not something
 * a command prints; it is something it defers to after commit.
 */
export interface UnitOfWork<Session = unknown> {
  /** The store handle of this transaction. Every write of the command goes through it. */
  readonly session: Session;
  readonly context: CommandContext;
  readonly startedAt: Instant;

  /**
   * States that something happened.
   *
   * Nothing is delivered here. The event is held until the transaction commits,
   * because a subscriber that acted on an event whose transaction then rolled
   * back has acted on something that did not happen — and unlike the database,
   * it cannot be rolled back afterwards.
   */
  publish<Payload>(type: EventType<Payload>, payload: Payload): DomainEvent<Payload>;

  /**
   * An effect that must happen only if the command survives: print the receipt,
   * open the drawer, release a device.
   */
  afterCommit(effect: () => void | Promise<void>): void;

  /**
   * An effect that undoes something the database cannot: a file already written,
   * a device already told. Runs when, and only when, the transaction rolls back.
   */
  onRollback(effect: () => void | Promise<void>): void;
}

/**
 * The store, as the transactor needs to see it.
 *
 * Deliberately three methods. Postgres on the store node and SQLite on the
 * register have very different opinions about isolation, locking and nesting,
 * and none of those opinions belongs in a package that hosts modules. The
 * drivers arrive with U07; what is fixed here is that a command is bracketed,
 * and that the bracket is the same shape on both.
 *
 * One opinion is not a driver's to hold: **conflicting commands serialise.**
 * The modules decide by reading and then writing — whether anybody else still
 * holds the right about to be removed, what the next document number is, whether
 * a handle is taken — and each of those is a lost update under anything weaker.
 * Two owners withdrawing each other at the same moment would both succeed, and
 * two tills would print one number. A driver provides serialisable isolation,
 * or locks that amount to it, and rejects the commit of a transaction that lost
 * — as the memory store below does.
 */
export interface SessionDriver<Session> {
  begin(context: CommandContext): Promise<Session>;
  commit(session: Session): Promise<void>;
  rollback(session: Session): Promise<void>;
}

/** An after-commit or compensating effect failed. */
export interface EffectFailure {
  readonly context: CommandContext;
  readonly phase: 'after-commit' | 'rollback';
  readonly cause: unknown;
}

export interface TransactorOptions<Session> {
  readonly driver: SessionDriver<Session>;
  readonly bus: EventBus;
  readonly clock: Clock;
  /**
   * Required, for the same reason the bus requires its own sink: an effect that
   * failed after the transaction committed cannot fail the command, and must
   * not disappear either.
   */
  readonly onEffectFailure: (failure: EffectFailure) => void;
}

/**
 * The failures a host's own sink raised, rethrown once everything it was told
 * about has still happened.
 *
 * A sink that throws is a host asking to be loud, and development does. What it
 * may not do is decide which effects run and which events are delivered: a sink
 * that threw on the first failed receipt used to skip every later effect and
 * never deliver the committed command's events at all.
 */
function rethrowSinkFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'The failure sink raised more than once.');
  }
}

export interface Transactor<Session = unknown> {
  /**
   * Runs one command.
   *
   * There is no ambient transaction to join. A command that calls another
   * passes its unit of work down; a command that does not receive one starts
   * its own. That is explicit on purpose — an ambient transaction discovered
   * through async local storage is invisible at the call site, and the first
   * time it matters is when somebody puts a long HTTP call inside one.
   */
  run<T>(context: CommandContext, work: (uow: UnitOfWork<Session>) => Promise<T>): Promise<T>;
}

export function createTransactor<Session>(
  options: TransactorOptions<Session>,
): Transactor<Session> {
  const { driver, bus, clock, onEffectFailure } = options;

  /** Reports a failure, and keeps what the sink itself raised for later. */
  const report = (failure: EffectFailure, raised: unknown[]): void => {
    try {
      onEffectFailure(failure);
    } catch (sinkFailure) {
      raised.push(sinkFailure);
    }
  };

  const runEffects = async (
    effects: readonly (() => void | Promise<void>)[],
    context: CommandContext,
    phase: EffectFailure['phase'],
    raised: unknown[],
  ): Promise<void> => {
    for (const effect of effects) {
      try {
        await effect();
      } catch (cause) {
        report({ context, phase, cause }, raised);
      }
    }
  };

  return {
    async run<T>(
      context: CommandContext,
      work: (uow: UnitOfWork<Session>) => Promise<T>,
    ): Promise<T> {
      const session = await driver.begin(context);
      const events: DomainEvent[] = [];
      const afterCommit: (() => void | Promise<void>)[] = [];
      const onRollback: (() => void | Promise<void>)[] = [];

      // Open while the work runs, and only then. An event published from an
      // after-commit effect was delivered as though the transaction had
      // produced it, and one published after `run` returned was silently
      // dropped; both are a command reaching for a unit of work that has ended.
      let open = true;
      const stillOpen = (what: string): void => {
        if (!open) {
          throw new Error(
            `${what} on a unit of work whose command has finished. Start a command of its own.`,
          );
        }
      };

      const uow: UnitOfWork<Session> = {
        session,
        context,
        startedAt: clock.now(),
        publish<Payload>(type: EventType<Payload>, payload: Payload): DomainEvent<Payload> {
          stillOpen(`Publishing ${type.name}`);
          const event: DomainEvent<Payload> = Object.freeze({
            id: newId<'event'>(),
            name: type.name,
            occurredAt: clock.now(),
            context,
            payload,
          });
          events.push(event);
          return event;
        },
        afterCommit(effect: () => void | Promise<void>): void {
          stillOpen('Deferring an effect');
          afterCommit.push(effect);
        },
        onRollback(effect: () => void | Promise<void>): void {
          stillOpen('Registering a compensation');
          onRollback.push(effect);
        },
      };

      // What the host's sink raised along the way. The command's own error, when
      // there is one, is what the caller is told; a sink's is kept for after.
      const raised: unknown[] = [];

      let outcome: T;
      try {
        outcome = await work(uow);
      } catch (cause) {
        open = false;
        // A rollback that throws — the connection already gone — used to replace
        // the command's own error and skip every compensation. The compensations
        // undo what the store never knew about either way, and the caller needs
        // to hear why the command failed, not why cleaning up after it did.
        try {
          await driver.rollback(session);
        } catch (rollbackFailure) {
          report({ context, phase: 'rollback', cause: rollbackFailure }, raised);
        }
        await runEffects(onRollback, context, 'rollback', raised);
        throw cause;
      }
      open = false;

      try {
        await driver.commit(session);
      } catch (cause) {
        // No rollback call here. A store that failed to commit has already
        // decided what state it is in, and asking it to roll back is as likely
        // to raise a second error that hides the first. The compensations still
        // run: they undo what the store never knew about.
        await runEffects(onRollback, context, 'rollback', raised);
        throw cause;
      }

      // Effects before subscribers, deliberately. The cashier is waiting for
      // the receipt; a subscriber is not waiting for anything. Both are after
      // the commit, so both are equally safe, and only one of them has a person
      // standing in front of it.
      await runEffects(afterCommit, context, 'after-commit', raised);
      try {
        // The bus catches every subscriber's failure itself; what reaches here
        // is its own sink raising, which waits with the rest.
        await bus.dispatch(events);
      } catch (sinkFailure) {
        raised.push(sinkFailure);
      }
      rethrowSinkFailures(raised);

      return outcome;
    },
  };
}

/**
 * A transactional store held in memory.
 *
 * Not a toy: it is what a module's own tests run against before any driver
 * exists, and it has the one property that makes such a test worth writing —
 * a rolled-back command leaves nothing behind. Writes go to an overlay that is
 * merged on commit and dropped on rollback.
 *
 * Values are copied in and copied out, as a database would. It once held the
 * objects themselves, so a command that edited what `get` returned and then
 * failed had changed committed state anyway — and a module could forget a
 * `put`, pass every test here, and lose the write against a real store.
 *
 * And it serialises, optimistically. A transaction that writes is refused at
 * commit with `SerialisationConflictError` when anything it read was changed by
 * a commit made while it ran, or when it listed the keys and a commit since
 * added or removed one. Without that, every read-then-write invariant a module
 * keeps passed its tests here and was a lost update the first time two commands
 * overlapped. A transaction that writes nothing is never refused: there is
 * nothing it could commit that rests on what it saw.
 */
export interface MemorySession {
  put(key: string, value: unknown): void;
  get(key: string): unknown;
  remove(key: string): void;
  keys(): readonly string[];
}

export interface MemoryStore {
  readonly driver: SessionDriver<MemorySession>;
  /** What is committed. A test asserts against this, never against a session. */
  committed(): ReadonlyMap<string, unknown>;
}

/**
 * Declared here rather than taken from `lib.dom` or `@types/node`, neither of
 * which this package opts into: it is a global in every runtime the platform
 * ships to — the store node, Electron and the browser.
 */
declare function structuredClone<T>(value: T): T;

/** What one uncommitted write says: a value, or the absence of one. */
type Slot = { readonly removed: true } | { readonly value: unknown };

const REMOVED: Slot = Object.freeze({ removed: true });

/** What a commit changed, for the transactions that were running while it did. */
interface CommitRecord {
  readonly version: number;
  readonly written: ReadonlySet<string>;
  /** A key was added or removed, which is what a listing of the keys can see. */
  readonly reshaped: boolean;
}

/** What a transaction saw, for the check at its own commit. */
interface Observed {
  readonly since: number;
  readonly read: Set<string>;
  scanned: boolean;
}

export function createMemoryStore(): MemoryStore {
  const committed = new Map<string, unknown>();
  const overlays = new WeakMap<MemorySession, Map<string, Slot>>();
  const observations = new WeakMap<MemorySession, Observed>();
  const running = new Set<Observed>();
  let version = 0;
  let history: CommitRecord[] = [];

  /** Forgets the commits no running transaction began before. */
  const prune = (): void => {
    const oldest = Math.min(version, ...[...running].map((one) => one.since));
    history = history.filter((record) => record.version > oldest);
  };

  const conflicts = (observed: Observed): boolean =>
    history.some(
      (record) =>
        record.version > observed.since &&
        ((observed.scanned && record.reshaped) ||
          [...record.written].some((key) => observed.read.has(key))),
    );

  const overlayOf = (session: MemorySession): Map<string, Slot> => {
    const overlay = overlays.get(session);
    if (overlay === undefined) {
      throw new Error('This session does not belong to this store, or has already ended.');
    }
    return overlay;
  };

  const begin = (): Promise<MemorySession> => {
    const overlay = new Map<string, Slot>();
    const observed: Observed = { since: version, read: new Set(), scanned: false };
    const session: MemorySession = {
      put(key: string, value: unknown): void {
        overlay.set(key, { value: structuredClone(value) });
      },
      get(key: string): unknown {
        const slot = overlay.get(key);
        if (slot === undefined) {
          observed.read.add(key);
          return structuredClone(committed.get(key));
        }
        return 'removed' in slot ? undefined : structuredClone(slot.value);
      },
      remove(key: string): void {
        overlay.set(key, REMOVED);
      },
      keys(): readonly string[] {
        observed.scanned = true;
        const all = new Set(committed.keys());
        for (const [key, slot] of overlay) {
          if ('removed' in slot) all.delete(key);
          else all.add(key);
        }
        return [...all].sort();
      },
    };
    overlays.set(session, overlay);
    observations.set(session, observed);
    running.add(observed);
    return Promise.resolve(session);
  };

  const end = (session: MemorySession): void => {
    const observed = observations.get(session);
    if (observed !== undefined) running.delete(observed);
    overlays.delete(session);
    observations.delete(session);
    prune();
  };

  return {
    driver: {
      begin,
      commit(session: MemorySession): Promise<void> {
        const overlay = overlayOf(session);
        const observed = observations.get(session);
        if (overlay.size > 0 && observed !== undefined && conflicts(observed)) {
          end(session);
          return Promise.reject(
            new SerialisationConflictError(
              'Another command committed a change to what this one read while it ran. ' +
                'Nothing was written; running the command again decides on the current state.',
            ),
          );
        }

        let reshaped = false;
        for (const [key, slot] of overlay) {
          if ('removed' in slot) {
            reshaped ||= committed.has(key);
            committed.delete(key);
          } else {
            reshaped ||= !committed.has(key);
            committed.set(key, slot.value);
          }
        }
        if (overlay.size > 0) {
          version += 1;
          history.push({ version, written: new Set(overlay.keys()), reshaped });
        }
        end(session);
        return Promise.resolve();
      },
      rollback(session: MemorySession): Promise<void> {
        // The overlay is simply dropped, which is the whole of it: nothing the
        // command wrote was ever visible to anything outside its own session.
        end(session);
        return Promise.resolve();
      },
    },
    committed(): ReadonlyMap<string, unknown> {
      return structuredClone(committed);
    },
  };
}
