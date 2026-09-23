import {
  isId,
  newId,
  ok,
  refuse,
  type Id,
  type Instant,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import type { DeviceId, TenantId, UserId } from '@vertex/contracts';

import type { CommandContext, CorrelationId } from './context.js';
import type { MigrationDeclaration } from './module.js';
import {
  untilCommitted,
  type MemorySession,
  type Transactor,
  type UnitOfWork,
} from './unit-of-work.js';

/** A wire operation is data for one explicitly registered command, never a method name. */
export interface OperationEnvelope<Payload = unknown> {
  readonly key: Id<'operation'>;
  readonly tenant: TenantId;
  readonly actor: UserId;
  readonly device: DeviceId;
  readonly correlation: CorrelationId;
  readonly sequence: number;
  readonly kind: string;
  readonly payload: Payload;
}

export interface OutboxEntry<Payload = unknown> {
  readonly envelope: OperationEnvelope<Payload>;
  readonly acknowledged: boolean;
  /** Present while the store node refuses to apply this operation (SYN-06). */
  readonly failure?: OperationFailure;
  /** Present once a person has handed the failure on; kept after it is resolved. */
  readonly escalation?: OperationEscalation;
}

export interface DeliveryProgress {
  readonly acknowledged: number;
  /** What stopped the pass, or null when every pending operation was acknowledged. */
  readonly halted: DeliveryAnswer | null;
}

/** What the store node's inbox decided about one operation (`receiveOperation`). */
export type Receipt =
  | { readonly status: 'applied' | 'duplicate' | 'conflict' }
  | { readonly status: 'sequence-gap' | 'out-of-order'; readonly expected: number };

/**
 * Why the store node would not even put an operation to its inbox: this
 * register may not deliver it (`forbidden`), it names a kind the node does not
 * apply (`unsupported`), or it is not an operation at all (`invalid`).
 */
export type RefusalReason = 'forbidden' | 'unsupported' | 'invalid';

/**
 * Everything one delivery attempt can learn, as a value.
 *
 * The four that are not a receipt are told apart because each asks for a
 * different response, and SYN-06 turns on getting that right. `unreachable` is
 * the ordinary condition of a register with no line — nothing about the
 * operation is wrong, and it is simply tried again. `unauthenticated` is the
 * store node answering but no longer knowing the session: also not the
 * operation's fault, and fixed by signing in, not by waiting. A receipt other
 * than applied or duplicate, and a `refused`, are the store node looking at
 * this operation and declining it — the only outcomes recorded against it.
 *
 * A link returns one of these rather than throwing, because none of them is a
 * defect. What a link throws is treated as one.
 */
export type DeliveryAnswer =
  | Receipt
  | { readonly status: 'refused'; readonly reason: RefusalReason }
  | { readonly status: 'unreachable' }
  | { readonly status: 'unauthenticated' };

/** Why an operation the store node answered for has not been applied. */
export type FailureReason =
  Extract<Receipt['status'], 'conflict' | 'sequence-gap' | 'out-of-order'> | RefusalReason;

/**
 * An operation the store node answered and would not apply, kept on the
 * operation itself so that a register restarted in the middle of it still
 * knows — and still says — what is holding its queue.
 */
export interface OperationFailure {
  readonly reason: FailureReason;
  /** The sequence the store node expected in its place, for a gap or an out-of-order delivery. */
  readonly expected?: number;
  /** When the store node first declined it, and when it last did. */
  readonly since: Instant;
  readonly latest: Instant;
  /** How many attempts it has declined. */
  readonly attempts: number;
}

/** Who handed a failed operation on to somebody who can resolve it, and when. */
export interface OperationEscalation {
  readonly by: UserId;
  readonly at: Instant;
}

const VERSION = 'platform.mailboxes.version';
const OUTBOX = 'platform.outbox.';
const INBOX = 'platform.inbox.';
const OUTGOING_SEQUENCE = 'platform.outgoing-sequence.';
const INCOMING_SEQUENCE = 'platform.incoming-sequence.';

/** Both persistent stores already have an atomic record table; this migration activates its mailbox namespace. */
export function operationMailboxMigrations<
  Session extends MemorySession,
>(): readonly MigrationDeclaration<Session>[] {
  return [
    {
      id: 'platform.0001-operation-mailboxes',
      target: 'both',
      up(session) {
        if (session.get(VERSION) !== undefined)
          throw new Error('Mailbox version already exists without its journal.');
        session.put(VERSION, 1);
        return Promise.resolve();
      },
    },
  ];
}

function ready(session: MemorySession): void {
  if (session.get(VERSION) !== 1) throw new Error('Operation mailbox migration has not run.');
}

function plain(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0))
      throw new TypeError(
        'An operation number must be an exact integer; use decimal strings for business values.',
      );
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('An operation must contain plain JSON data.');
  if (seen.has(value)) throw new TypeError('An operation cannot contain a cycle.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1)
        throw new TypeError('An operation array cannot have extra properties.');
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
          throw new TypeError('An operation array must be dense data.');
        result.push(plain(descriptor.value, seen));
      }
      return result;
    }
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    )
      throw new TypeError('An operation must contain plain JSON data.');
    const result: Record<string, unknown> = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !('value' in descriptor) ||
        !descriptor.enumerable ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype'
      )
        throw new TypeError('An operation must contain plain data fields.');
      result[key] = plain(descriptor.value, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(plain(value, new Set()));
}

function validated(envelope: OperationEnvelope): string {
  if (
    !isId(envelope.key) ||
    !isId(envelope.tenant) ||
    !isId(envelope.actor) ||
    !isId(envelope.device) ||
    !isId(envelope.correlation) ||
    !Number.isSafeInteger(envelope.sequence) ||
    envelope.sequence < 1 ||
    !/^[a-z][a-z0-9.-]{0,79}$/u.test(envelope.kind)
  )
    throw new TypeError('Invalid operation envelope.');
  return canonical(envelope);
}

function contextMatches(context: CommandContext, envelope: OperationEnvelope): void {
  if (
    context.tenant !== envelope.tenant ||
    context.actor !== envelope.actor ||
    context.device !== envelope.device
  )
    throw new TypeError('Operation authority does not match the validated command context.');
}

/** Called within the same unit of work that writes the local document and balance. */
export function stageOperation<Payload>(
  uow: UnitOfWork<MemorySession>,
  kind: string,
  payload: Payload,
): OperationEnvelope<Payload> {
  ready(uow.session);
  const { tenant, actor, device, correlation } = uow.context;
  if (actor === null || device === null)
    throw new TypeError('An outgoing operation needs an actor and device.');
  const sequenceKey = `${OUTGOING_SEQUENCE}${tenant}.${device}`;
  const previous = uow.session.get(sequenceKey) ?? 0;
  if (
    !Number.isSafeInteger(previous) ||
    (previous as number) < 0 ||
    (previous as number) >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('Corrupted or exhausted outgoing sequence.');
  const envelope: OperationEnvelope<Payload> = {
    key: newId<'operation'>(),
    tenant,
    actor,
    device,
    correlation,
    sequence: (previous as number) + 1,
    kind,
    payload: JSON.parse(canonical(payload)) as Payload,
  };
  validated(envelope);
  uow.session.put(outboxKey(envelope), { envelope, acknowledged: false });
  uow.session.put(sequenceKey, envelope.sequence);
  return envelope;
}

export function outboxEntries(
  session: MemorySession,
  tenant: TenantId,
  device: DeviceId,
): readonly OutboxEntry[] {
  ready(session);
  const prefix = `${OUTBOX}${tenant}.${device}.`;
  return session
    .keys()
    .filter((key) => key.startsWith(prefix))
    .map((key) => session.get(key) as OutboxEntry)
    .sort((a, b) => a.envelope.sequence - b.envelope.sequence);
}

/** A lost acknowledgement only leaves an unacknowledged row; replay is always permitted. */
export function acknowledgeOperation(
  uow: UnitOfWork<MemorySession>,
  envelope: OperationEnvelope,
): void {
  ready(uow.session);
  validated(envelope);
  contextMatches(uow.context, envelope);
  const key = outboxKey(envelope);
  const existing = uow.session.get(key) as OutboxEntry | undefined;
  if (!existing || canonical(existing.envelope) !== canonical(envelope))
    throw new TypeError('Acknowledgement does not match an outgoing operation.');
  // Applied is the end of the failure, not of the record that somebody was
  // asked to look at it: the escalation stays, and the failure goes.
  if (!existing.acknowledged)
    uow.session.put(key, {
      envelope: existing.envelope,
      acknowledged: true,
      ...(existing.escalation === undefined ? {} : { escalation: existing.escalation }),
    });
}

function outboxKey(envelope: OperationEnvelope): string {
  return `${OUTBOX}${envelope.tenant}.${envelope.device}.${envelope.key}`;
}

/** The reason an answer is recorded against its operation, or null when it says nothing about it. */
function failureOf(answer: DeliveryAnswer): FailureReason | null {
  switch (answer.status) {
    case 'conflict':
    case 'sequence-gap':
    case 'out-of-order':
      return answer.status;
    case 'refused':
      return answer.reason;
    case 'applied':
    case 'duplicate':
    case 'unreachable':
    case 'unauthenticated':
      return null;
  }
}

/**
 * Writes down that the store node declined an operation, on the operation.
 *
 * The first refusal's moment is kept and every later one counted: "refused
 * forty times since nine this morning" is what tells a supervisor this is not
 * going to clear itself, and "refused once, a minute ago" that it might.
 */
function recordFailure(
  uow: UnitOfWork<MemorySession>,
  envelope: OperationEnvelope,
  answer: DeliveryAnswer,
  reason: FailureReason,
): void {
  const key = outboxKey(envelope);
  const existing = uow.session.get(key) as OutboxEntry | undefined;
  if (!existing || canonical(existing.envelope) !== canonical(envelope))
    throw new TypeError('A failure does not match an outgoing operation.');
  if (existing.acknowledged) return;
  const expected = 'expected' in answer ? answer.expected : undefined;
  const failure: OperationFailure = {
    reason,
    ...(expected === undefined ? {} : { expected }),
    since: existing.failure?.since ?? uow.startedAt,
    latest: uow.startedAt,
    attempts: (existing.failure?.attempts ?? 0) + 1,
  };
  uow.session.put(key, { ...existing, failure });
}

/**
 * Deliver in device order, stopping at the first operation that is not applied.
 *
 * Stopping is the only order-preserving choice: the store node applies one
 * device's operations strictly in sequence, so an operation delivered past a
 * failed one is refused as a gap, and would be recorded as a second failure
 * that is really the first one again. When the store node declined the
 * operation, why is recorded against it in its own transaction; when it could
 * not be asked, nothing is written, because nothing about the operation is
 * wrong.
 */
export async function deliverOutbox(
  transactor: Transactor<MemorySession>,
  context: CommandContext,
  deliver: (envelope: OperationEnvelope) => Promise<DeliveryAnswer>,
): Promise<DeliveryProgress> {
  const device = context.device;
  if (context.actor === null || device === null)
    throw new TypeError('Outbox delivery needs a signed-in actor and device.');
  const entries = await transactor.run(context, (uow) =>
    Promise.resolve(outboxEntries(uow.session, context.tenant, device)),
  );
  let acknowledged = 0;
  for (const entry of entries) {
    if (entry.acknowledged) continue;
    const answer = await deliver(entry.envelope);
    if (answer.status !== 'applied' && answer.status !== 'duplicate') {
      const reason = failureOf(answer);
      if (reason !== null)
        await untilCommitted(() =>
          transactor.run(context, (uow) => {
            recordFailure(uow, entry.envelope, answer, reason);
            return Promise.resolve();
          }),
        );
      return { acknowledged, halted: answer };
    }
    await untilCommitted(() =>
      transactor.run(context, (uow) => {
        acknowledgeOperation(uow, entry.envelope);
        return Promise.resolve();
      }),
    );
    acknowledged += 1;
  }
  return { acknowledged, halted: null };
}

/**
 * A person hands a failed operation on to somebody who can resolve it (SYN-06).
 *
 * Only a failed operation can be escalated: one that is merely waiting for a
 * line has nothing wrong with it for anybody to look at, and one already
 * applied has nothing left to resolve — which is what a person pressing the
 * button a moment after the courier's own retry succeeded is told, as a
 * refusal rather than an error. Escalating twice keeps the first: the question
 * is who raised it first, and a second press is not a second report.
 */
export function escalateOperation(
  uow: UnitOfWork<MemorySession>,
  key: Id<'operation'>,
): Result<OutboxEntry, Refusal<'syn.operation-not-failed'>> {
  ready(uow.session);
  const { tenant, actor, device } = uow.context;
  if (actor === null || device === null)
    throw new TypeError('Only a person at a register escalates an operation.');
  const stored = `${OUTBOX}${tenant}.${device}.${key}`;
  const existing = uow.session.get(stored) as OutboxEntry | undefined;
  if (!existing) throw new TypeError('No such outgoing operation on this register.');
  if (existing.acknowledged || existing.failure === undefined)
    return refuse('syn.operation-not-failed');
  if (existing.escalation !== undefined) return ok(existing);
  const escalated: OutboxEntry = { ...existing, escalation: { by: actor, at: uow.startedAt } };
  uow.session.put(stored, escalated);
  return ok(escalated);
}

/** The caller supplies an allowlisted owning-module decision using this same transaction. */
export async function receiveOperation(
  uow: UnitOfWork<MemorySession>,
  envelope: OperationEnvelope,
  apply: () => Promise<void>,
): Promise<Receipt> {
  ready(uow.session);
  const serialized = validated(envelope);
  contextMatches(uow.context, envelope);
  const inboxKey = `${INBOX}${envelope.tenant}.${envelope.key}`;
  const existing = uow.session.get(inboxKey) as { envelope: OperationEnvelope } | undefined;
  if (existing)
    return { status: canonical(existing.envelope) === serialized ? 'duplicate' : 'conflict' };
  const sequenceKey = `${INCOMING_SEQUENCE}${envelope.tenant}.${envelope.device}`;
  const previous = uow.session.get(sequenceKey) ?? 0;
  if (!Number.isSafeInteger(previous) || (previous as number) < 0)
    throw new Error('Corrupted incoming sequence.');
  const expected = (previous as number) + 1;
  if (envelope.sequence !== expected)
    return { status: envelope.sequence > expected ? 'sequence-gap' : 'out-of-order', expected };
  await apply();
  uow.session.put(inboxKey, { envelope });
  uow.session.put(sequenceKey, envelope.sequence);
  return { status: 'applied' };
}
