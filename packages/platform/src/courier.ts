import type { DeviceId } from '@vertex/contracts';
import {
  ok,
  plusMillis,
  timeOf,
  type Clock,
  type Id,
  type Instant,
  type Refusal,
  type Result,
} from '@vertex/kernel';

import type { CommandContext } from './context.js';
import {
  deliverOutbox,
  escalateOperation,
  outboxEntries,
  type DeliveryAnswer,
  type OperationEnvelope,
  type OperationEscalation,
  type OperationFailure,
  type OutboxEntry,
} from './mailboxes.js';
import { untilCommitted, type MemorySession, type Transactor } from './unit-of-work.js';

/**
 * The register's side of synchronisation, running: it delivers the outbox,
 * waits when it cannot, and says at every moment what state it is in (SYN-06,
 * POS-18).
 *
 * `deliverOutbox` is one pass. What a till needs is the pass repeated for as
 * long as the till is on — soon after a sale, patiently while the line is down,
 * never in a loop that hammers a store node that has just come back — and a
 * truthful answer to the question the cashier and the supervisor actually ask:
 * is this register talking to the shop, and is anything it did still waiting?
 */

/** Whether the store node answers this register at all, asked when there is nothing to deliver. */
export type Reach = 'reachable' | 'unreachable' | 'unauthenticated';

/**
 * The store node, as the courier sees it.
 *
 * Both calls **must settle in bounded time**. The courier delivers one
 * operation at a time in sequence order, so a call that hangs holds every sale
 * behind it — and a register whose status never leaves "delivering" is the one
 * failure SYN-06 exists to rule out. Bounding it belongs to the link, which is
 * the only thing that knows what a slow answer looks like on its wire.
 */
export interface StoreLink {
  deliver(envelope: OperationEnvelope): Promise<DeliveryAnswer>;
  reach(): Promise<Reach>;
}

/**
 * What the register knows about its store node, from the last time it asked.
 *
 * `unknown` until the first answer: saying "connected" before anything has
 * been asked is a claim, and so is "offline". `signed-out` is the store node
 * answering and no longer knowing the session it is asked under — reachable,
 * and still delivering nothing until somebody signs in.
 */
export type Connection = 'unknown' | 'online' | 'offline' | 'signed-out';

/** One operation that has not been acknowledged, as the status shows it. */
export interface QueuedOperation {
  readonly key: Id<'operation'>;
  readonly sequence: number;
  readonly kind: string;
  /** When the register staged it, read from its time-ordered key rather than stored twice. */
  readonly stagedAt: Instant;
  readonly failure?: OperationFailure;
  readonly escalation?: OperationEscalation;
}

export interface SyncStatus {
  readonly connection: Connection;
  /**
   * Every operation the store node has not acknowledged, in the order it must
   * apply them. A failed one is at the head, because nothing behind it can be
   * applied first.
   */
  readonly queue: readonly QueuedOperation[];
  /** The last moment the store node answered anything. */
  readonly lastContact: Instant | null;
  /** When the courier will next try on its own, while it is waiting to. */
  readonly nextAttempt: Instant | null;
}

/**
 * How long to wait after an unsuccessful attempt: `first`, doubling with each
 * one after it, never more than `ceiling`. Milliseconds, both whole.
 */
export interface Backoff {
  readonly first: number;
  readonly ceiling: number;
}

/**
 * Schedules one attempt; the returned function cancels it. The attempt's
 * promise is handed to the timer so that one driven by hand can wait for it.
 */
export interface Timer {
  after(delay: number, run: () => Promise<void>): () => void;
}

export interface CourierOptions {
  readonly transactor: Transactor<MemorySession>;
  /**
   * The register, and the person signed in at it.
   *
   * The store node accepts an operation only from the person who staged it
   * (`U07.3`), so a courier delivers that person's operations: after a change
   * of cashier, an operation the previous one left at the head of the queue is
   * refused until they sign in again. A till that changes hands mid-queue
   * needs delivery on the register's own authority, which arrives with user
   * switching (`POS-15`, `U20`).
   */
  readonly context: CommandContext;
  readonly link: StoreLink;
  readonly clock: Clock;
  readonly backoff?: Backoff;
  /** How often an idle register asks whether its store node is still there. */
  readonly heartbeat?: number;
  readonly timer?: Timer;
  /**
   * Required, with no default, as the event bus's and the transactor's sinks
   * are. A link that throws, or a store that fails to commit, is a defect, and
   * a courier that swallowed it would show a register quietly offline forever;
   * one that rethrew it would stop delivering at the first. So it is reported
   * here, and the courier waits as it does after any failed attempt and then
   * tries again.
   */
  readonly onFault: (cause: unknown) => void;
}

export interface Courier {
  /**
   * The current status. The same object until something in it changes.
   *
   * This and `subscribe` are properties rather than methods so they may be
   * handed on unbound, which is how an external store is read in React.
   */
  readonly status: () => SyncStatus;
  /** Called after every change of status; the returned function unsubscribes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Begins delivering. Resolves when the first attempt has finished. */
  start(): Promise<void>;
  /**
   * Something was staged. Delivers now, unless the courier is waiting out a
   * store node that did not answer or an operation it refused: then only the
   * queue is refreshed. A register offline all afternoon would otherwise
   * knock on a closed door with every sale, and one with a refused head would
   * count every sale as another refusal. A session the store node forgot is
   * the exception — it answers at once, and the sale may be the first thing
   * done after signing in again.
   */
  nudge(): Promise<void>;
  /**
   * Try now, and start the backoff over from its first step: a person asked,
   * or something the courier cannot see has changed — a new session, a line
   * plugged back in.
   */
  retry(): Promise<void>;
  /** Hands a failed operation on to a supervisor (`escalateOperation`), and refreshes the status. */
  escalate(
    key: Id<'operation'>,
  ): Promise<Result<QueuedOperation, Refusal<'syn.operation-not-failed'>>>;
  /** Stops scheduling and waits for an attempt in flight. Nothing is delivered after it resolves. */
  stop(): Promise<void>;
}

const DEFAULT_BACKOFF: Backoff = Object.freeze({ first: 1_000, ceiling: 60_000 });
const DEFAULT_HEARTBEAT = 15_000;

/**
 * Declared here rather than taken from `lib.dom` or `@types/node`, for
 * `unit-of-work.ts`'s reason: they are globals in every runtime the platform
 * ships to, and the package opts into neither set of ambient types.
 */
declare function setTimeout(run: () => void, delay: number): unknown;
declare function clearTimeout(handle: unknown): void;

const systemTimer: Timer = Object.freeze({
  after(delay: number, run: () => Promise<void>): () => void {
    const handle = setTimeout(() => {
      void run();
    }, delay);
    return () => {
      clearTimeout(handle);
    };
  },
});

/** Whole-number division of non-negative integers, without the `Math` rounding the platform bans. */
function quotient(dividend: number, divisor: number): number {
  return (dividend - (dividend % divisor)) / divisor;
}

/**
 * Where in its window this register waits, as thousandths: a fixed point per
 * device, from its identifier.
 *
 * Every till in a shop loses the store node at the same moment, when it
 * restarts, and without a spread they would all come back at the same moments
 * too, doubling in step — the burst the backoff is there to prevent. Derived
 * rather than drawn: the spread only has to differ between devices, not between
 * attempts, and a delay that is a function of the device is one a test can
 * state.
 */
function spreadOf(device: string): number {
  // FNV-1a, 32 bits.
  let hash = 0x811c9dc5;
  for (let index = 0; index < device.length; index += 1) {
    hash = Math.imul(hash ^ device.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0) % 1000;
}

/**
 * The wait before the next attempt after `failures` unsuccessful ones in a
 * row: the exponential step, of which the first half is always waited and the
 * second half by this device's spread.
 */
export function backoffDelay(backoff: Backoff, failures: number, device: string): number {
  let step = backoff.first;
  for (let doubled = 1; doubled < failures && step < backoff.ceiling; doubled += 1) step *= 2;
  step = Math.min(step, backoff.ceiling);
  const half = quotient(step, 2);
  return step - half + quotient(half * spreadOf(device), 1000);
}

function validBackoff(backoff: Backoff): Backoff {
  if (
    !Number.isSafeInteger(backoff.first) ||
    !Number.isSafeInteger(backoff.ceiling) ||
    backoff.first < 1 ||
    backoff.ceiling < backoff.first ||
    // The step doubles and is then spread in thousandths; bounded so neither
    // leaves the integers.
    backoff.ceiling > 86_400_000
  )
    throw new RangeError('A backoff is whole milliseconds, at least one, rising to a ceiling.');
  return backoff;
}

function queuedOf({ envelope, failure, escalation }: OutboxEntry): QueuedOperation {
  return {
    key: envelope.key,
    sequence: envelope.sequence,
    kind: envelope.kind,
    stagedAt: timeOf(envelope.key),
    ...(failure === undefined ? {} : { failure }),
    ...(escalation === undefined ? {} : { escalation }),
  };
}

function queueOf(
  session: MemorySession,
  context: CommandContext,
  device: DeviceId,
): readonly QueuedOperation[] {
  return outboxEntries(session, context.tenant, device)
    .filter((entry) => !entry.acknowledged)
    .map(queuedOf);
}

/** What one attempt found out, before it is turned into a status and a schedule. */
interface Finding {
  readonly connection: Connection | null;
  readonly answered: boolean;
  readonly succeeded: boolean;
}

/**
 * `null` is a pass that delivered everything; a `Reach` is the answer to the
 * question asked when there was nothing to deliver. `delivered` counts what
 * was acknowledged before the pass stopped: a line that dropped halfway through
 * the queue still answered, a moment ago.
 */
function findingOf(answer: DeliveryAnswer | Reach | null, delivered: number): Finding {
  const status =
    answer === null ? 'reachable' : typeof answer === 'string' ? answer : answer.status;
  switch (status) {
    case 'reachable':
    case 'applied':
    case 'duplicate':
      return { connection: 'online', answered: true, succeeded: true };
    case 'unreachable':
      return { connection: 'offline', answered: delivered > 0, succeeded: false };
    case 'unauthenticated':
      return { connection: 'signed-out', answered: true, succeeded: false };
    // The store node answered, and declined: it is there, and this operation
    // is what is wrong. `deliverOutbox` has already recorded why.
    case 'conflict':
    case 'sequence-gap':
    case 'out-of-order':
    case 'refused':
      return { connection: 'online', answered: true, succeeded: false };
  }
}

function sameStatus(a: SyncStatus, b: SyncStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createCourier(options: CourierOptions): Courier {
  const { transactor, context, link, clock, onFault } = options;
  const device = context.device;
  if (context.actor === null || device === null)
    throw new TypeError('A courier delivers for a person signed in at a register.');
  const backoff = validBackoff(options.backoff ?? DEFAULT_BACKOFF);
  const heartbeat = options.heartbeat ?? DEFAULT_HEARTBEAT;
  if (!Number.isSafeInteger(heartbeat) || heartbeat < 1)
    throw new RangeError('A heartbeat is whole milliseconds, at least one.');
  const timer = options.timer ?? systemTimer;

  let current: SyncStatus = Object.freeze({
    connection: 'unknown',
    queue: Object.freeze([]),
    lastContact: null,
    nextAttempt: null,
  });
  const listeners = new Set<() => void>();
  let failures = 0;
  let launched: Promise<void> | null = null;
  let started = false;
  let stopped = false;
  // Every read of the queue is numbered when it begins, and a queue older than
  // the one on show is never put back: a refresh that began before an attempt
  // must not land after it and restore what it delivered. What else a late
  // attempt learned — the connection, the next wait — is still news.
  let reads = 0;
  let shown = 0;
  let running: Promise<void> | null = null;
  let again = false;
  let cancelTimer: (() => void) | null = null;
  // Read through functions after an `await`: either can change while one is
  // pending, and a flag read directly there is narrowed as if it could not.
  const isStopped = (): boolean => stopped;
  const isAskedAgain = (): boolean => again;

  const publish = (update: SyncStatus, read: number): void => {
    const stale = read < shown;
    if (!stale) shown = read;
    const next = stale ? { ...update, queue: current.queue } : update;
    if (sameStatus(current, next)) return;
    current = Object.freeze({ ...next, queue: Object.freeze([...next.queue]) });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (cause) {
        onFault(cause);
      }
    }
  };

  const readQueue = async (): Promise<{ read: number; queue: readonly QueuedOperation[] }> => {
    reads += 1;
    const read = reads;
    const queue = await transactor.run(context, (uow) =>
      Promise.resolve(queueOf(uow.session, context, device)),
    );
    return { read, queue };
  };

  const clearSchedule = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const schedule = (delay: number): Instant => {
    clearSchedule();
    cancelTimer = timer.after(delay, () => {
      cancelTimer = null;
      return pass();
    });
    return plusMillis(clock.now(), delay);
  };

  /** One attempt: deliver what is queued, or, with nothing queued, ask whether anyone is there. */
  const attempt = async (): Promise<void> => {
    clearSchedule();
    let finding: Finding;
    try {
      const { queue: queued } = await readQueue();
      if (queued.length === 0) {
        finding = findingOf(await link.reach(), 0);
      } else {
        const progress = await deliverOutbox(transactor, context, (envelope) =>
          link.deliver(envelope),
        );
        finding = findingOf(progress.halted, progress.acknowledged);
      }
    } catch (cause) {
      onFault(cause);
      finding = { connection: null, answered: false, succeeded: false };
    }
    if (isStopped()) return;

    let queue = current.queue;
    let read = shown;
    try {
      ({ read, queue } = await readQueue());
    } catch (cause) {
      onFault(cause);
    }
    if (isStopped()) return;

    let nextAttempt: Instant | null = null;
    if (finding.succeeded) {
      failures = 0;
      // Staged while this attempt was delivering: go round again at once,
      // rather than leave a sale waiting out a heartbeat.
      if (queue.length > 0) again = true;
      else schedule(heartbeat);
    } else {
      failures += 1;
      nextAttempt = schedule(backoffDelay(backoff, failures, device));
    }
    publish(
      {
        connection: finding.connection ?? current.connection,
        queue,
        lastContact: finding.answered ? clock.now() : current.lastContact,
        nextAttempt,
      },
      read,
    );
  };

  /**
   * One attempt at a time, ever. A request for another while one runs is
   * remembered and served when it finishes: two concurrent passes would each
   * deliver the head of the queue, which the store node survives (SYN-02) and
   * the status does not.
   */
  const pass = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running !== null) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await attempt();
        } while (isAskedAgain() && !isStopped());
      } finally {
        running = null;
      }
    })();
    return running;
  };

  const refresh = async (): Promise<void> => {
    try {
      const { read, queue } = await readQueue();
      if (!isStopped()) publish({ ...current, queue }, read);
    } catch (cause) {
      onFault(cause);
    }
  };

  return {
    status: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (stopped) return Promise.reject(new Error('A stopped courier does not start again.'));
      launched ??= (async () => {
        // What the store already holds is shown before anything is asked of
        // the store node: a register restarted with a refused sale at the head
        // of its queue says so at once, not after its first attempt timed out.
        await refresh();
        started = true;
        await pass();
      })();
      return launched;
    },
    nudge() {
      if (!started || stopped) return refresh();
      const waiting = failures > 0 && current.connection !== 'signed-out';
      return waiting ? refresh() : pass();
    },
    retry() {
      if (!started || stopped) return Promise.resolve();
      failures = 0;
      return pass();
    },
    async escalate(key) {
      const outcome = await untilCommitted(() =>
        transactor.run(context, (uow) => Promise.resolve(escalateOperation(uow, key))),
      );
      await refresh();
      // From what was committed, not from the refreshed queue: a retry running
      // alongside may already have delivered it, which is not this call failing.
      return outcome.ok ? ok(queuedOf(outcome.value)) : outcome;
    },
    async stop() {
      stopped = true;
      clearSchedule();
      await running;
    },
  };
}
