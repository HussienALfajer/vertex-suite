import { isId, newId, type Id } from '@vertex/kernel';
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
}

export interface DeliveryProgress {
  readonly acknowledged: number;
  readonly halted: Receipt | null;
}

export type Receipt =
  | { readonly status: 'applied' | 'duplicate' | 'conflict' }
  | { readonly status: 'sequence-gap' | 'out-of-order'; readonly expected: number };

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
  uow.session.put(`${OUTBOX}${tenant}.${device}.${envelope.key}`, {
    envelope,
    acknowledged: false,
  });
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
  const key = `${OUTBOX}${envelope.tenant}.${envelope.device}.${envelope.key}`;
  const existing = uow.session.get(key) as OutboxEntry | undefined;
  if (!existing || canonical(existing.envelope) !== canonical(envelope))
    throw new TypeError('Acknowledgement does not match an outgoing operation.');
  if (!existing.acknowledged)
    uow.session.put(key, { envelope: existing.envelope, acknowledged: true });
}

/** Deliver in device order. A transport failure leaves the row pending for a later run. */
export async function deliverOutbox(
  transactor: Transactor<MemorySession>,
  context: CommandContext,
  deliver: (envelope: OperationEnvelope) => Promise<Receipt>,
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
    const receipt = await deliver(entry.envelope);
    if (receipt.status !== 'applied' && receipt.status !== 'duplicate')
      return { acknowledged, halted: receipt };
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
