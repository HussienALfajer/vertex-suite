import { newId, type Clock, type Instant } from '@vertex/kernel';

import type { CommandContext } from './context.js';
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

  const runEffects = async (
    effects: readonly (() => void | Promise<void>)[],
    context: CommandContext,
    phase: EffectFailure['phase'],
  ): Promise<void> => {
    for (const effect of effects) {
      try {
        await effect();
      } catch (cause) {
        onEffectFailure({ context, phase, cause });
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

      const uow: UnitOfWork<Session> = {
        session,
        context,
        startedAt: clock.now(),
        publish<Payload>(type: EventType<Payload>, payload: Payload): DomainEvent<Payload> {
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
          afterCommit.push(effect);
        },
        onRollback(effect: () => void | Promise<void>): void {
          onRollback.push(effect);
        },
      };

      let outcome: T;
      try {
        outcome = await work(uow);
      } catch (cause) {
        await driver.rollback(session);
        await runEffects(onRollback, context, 'rollback');
        throw cause;
      }

      try {
        await driver.commit(session);
      } catch (cause) {
        // No rollback call here. A store that failed to commit has already
        // decided what state it is in, and asking it to roll back is as likely
        // to raise a second error that hides the first. The compensations still
        // run: they undo what the store never knew about.
        await runEffects(onRollback, context, 'rollback');
        throw cause;
      }

      // Effects before subscribers, deliberately. The cashier is waiting for
      // the receipt; the ledger is not waiting for anything. Both are after the
      // commit, so both are equally safe, and only one of them has a person
      // standing in front of it.
      await runEffects(afterCommit, context, 'after-commit');
      await bus.dispatch(events);

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

/** What one uncommitted write says: a value, or the absence of one. */
type Slot = { readonly removed: true } | { readonly value: unknown };

const REMOVED: Slot = Object.freeze({ removed: true });

export function createMemoryStore(): MemoryStore {
  const committed = new Map<string, unknown>();
  const overlays = new WeakMap<MemorySession, Map<string, Slot>>();

  const overlayOf = (session: MemorySession): Map<string, Slot> => {
    const overlay = overlays.get(session);
    if (overlay === undefined) {
      throw new Error('This session does not belong to this store, or has already ended.');
    }
    return overlay;
  };

  const begin = (): Promise<MemorySession> => {
    const overlay = new Map<string, Slot>();
    const session: MemorySession = {
      put(key: string, value: unknown): void {
        overlay.set(key, { value });
      },
      get(key: string): unknown {
        const slot = overlay.get(key);
        if (slot === undefined) return committed.get(key);
        return 'removed' in slot ? undefined : slot.value;
      },
      remove(key: string): void {
        overlay.set(key, REMOVED);
      },
      keys(): readonly string[] {
        const all = new Set(committed.keys());
        for (const [key, slot] of overlay) {
          if ('removed' in slot) all.delete(key);
          else all.add(key);
        }
        return [...all].sort();
      },
    };
    overlays.set(session, overlay);
    return Promise.resolve(session);
  };

  return {
    driver: {
      begin,
      commit(session: MemorySession): Promise<void> {
        for (const [key, slot] of overlayOf(session)) {
          if ('removed' in slot) committed.delete(key);
          else committed.set(key, slot.value);
        }
        overlays.delete(session);
        return Promise.resolve();
      },
      rollback(session: MemorySession): Promise<void> {
        // The overlay is simply dropped, which is the whole of it: nothing the
        // command wrote was ever visible to anything outside its own session.
        overlays.delete(session);
        return Promise.resolve();
      },
    },
    committed(): ReadonlyMap<string, unknown> {
      return new Map(committed);
    },
  };
}
