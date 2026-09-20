import type { TenantId } from '@vertex/contracts';

import type {
  Account,
  AccountMapping,
  EntrySource,
  JournalEntry,
  JournalEntryId,
  JournalLine,
  PeriodReopening,
  PostingException,
  PostingExceptionId,
  RecordSession,
  Reversal,
  TenantCalendar,
} from './contract.js';

/**
 * The key layout, and the one place a stored shape is asserted.
 *
 * The arrangement `SYS`, `SEC` and `FX` use, for their reasons: the store hands
 * back `unknown`, so a shape has to be asserted somewhere, and asserting it
 * against the collection name makes the assertion and the key that produced it
 * one decision. Reading a mapping and calling it an account is not
 * expressible.
 *
 * Four modules now carry a file of this shape, and it is still not lifted into
 * the platform. The drivers of `U07` replace every one of them with a schema of
 * the module's own, and a shared helper would be a fifth thing to delete that
 * day.
 *
 * **Two writers, and which collection each may touch is a type.** The chart
 * and the calendar are revised in place — an account is renamed, a period is
 * closed — and go through `writeRecord`. The journal is `FIN-03`'s: an entry,
 * its lines and the pointers between them are written **once** and never
 * again, and go through `appendRecord`, which refuses a key that already holds
 * something. The two sets of collections are disjoint types, so the writer that
 * revises cannot be handed a journal collection at all: there is no code path
 * that updates or deletes a posted journal line because the one function that
 * could write one refuses to compile against it.
 */
export interface RevisedShapes {
  /** `fin/account/<tenant>/<id>` */
  readonly account: Account;
  /** `fin/mapping/<tenant>/<role>`: one account per role, the latest mapping winning. */
  readonly mapping: AccountMapping;
  /**
   * `fin/calendar/<tenant>`: every fiscal year of the tenant, in one record.
   *
   * The only key here with no last segment, because there is exactly one per
   * tenant — which is the point of it. `TenantCalendar` says why the years are
   * not a record each: `FIN-02` asks which period a day falls in for every
   * entry it writes, and a key it can read by name costs that path nothing.
   */
  readonly calendar: TenantCalendar;
  /** `fin/reopening/<tenant>/<period>/<id>`: append-only in practice, and read by period. */
  readonly reopening: PeriodReopening;
  /**
   * `fin/exception/<tenant>/<id>`: the queue of `FIN-05`. Revised exactly once,
   * from waiting to decided; the entry it holds is never touched.
   */
  readonly exception: PostingException;
}

/** Where a business event's entry is: the idempotency of `FIN-02`, as a record. */
export interface Placement {
  readonly tenant: TenantId;
  readonly source: EntrySource;
  readonly entry: JournalEntryId;
}

/** Where a business event's entry waits, when it could not be posted on arrival. */
export interface Queued {
  readonly tenant: TenantId;
  readonly source: EntrySource;
  readonly exception: PostingExceptionId;
}

export interface AppendedShapes {
  /** `fin/entry/<tenant>/<id>` */
  readonly entry: JournalEntry;
  /** `fin/line/<tenant>/<entry>/<ordinal>`: read by entry, which is how lines are always read. */
  readonly line: JournalLine;
  /**
   * `fin/posted/<tenant>/<kind>/<document>`: the entry a business event became.
   *
   * Written once, with the entry, so that a replayed posting finds the entry
   * the event already has by a key it can read by name — never by scanning
   * entries for a source, which under serialisable isolation would make every
   * sale conflict with every other.
   */
  readonly posted: Placement;
  /** `fin/queued/<tenant>/<kind>/<document>`: the exception an arrival was routed to; written once. */
  readonly queued: Queued;
  /** `fin/reversal/<tenant>/<original>`: the append-only pointer of `FIN-03`. */
  readonly reversal: Reversal;
}

export type StoredShapes = RevisedShapes & AppendedShapes;

export type Collection = keyof StoredShapes;

type Revised = keyof RevisedShapes;

type Appended = keyof AppendedShapes;

/**
 * The tenant is the third segment of every key, so a read that forgot it finds
 * nothing rather than somebody else's shop. Every segment is percent-encoded,
 * the tenant included: the brand on `TenantId` is gone at run time, and a value
 * carrying a `/` would nest one tenant's records under another's prefix.
 */
function keyFor(collection: Collection, tenant: TenantId, parts: readonly string[]): string {
  return ['fin', collection, ...[tenant, ...parts].map(encodeURIComponent)].join('/');
}

export function readRecord<C extends Collection>(
  session: RecordSession,
  collection: C,
  tenant: TenantId,
  parts: readonly string[],
): StoredShapes[C] | null {
  const value = session.get(keyFor(collection, tenant, parts));
  return value === undefined || value === null ? null : (value as StoredShapes[C]);
}

/** Writes a record of a collection that is revised in place, replacing what was there. */
export function writeRecord<C extends Revised>(
  session: RecordSession,
  collection: C,
  tenant: TenantId,
  parts: readonly string[],
  record: RevisedShapes[C],
): RevisedShapes[C] {
  // Frozen on the way in, so that handing the stored object back to a reader
  // cannot let them edit committed state from the outside.
  Object.freeze(record);
  session.put(keyFor(collection, tenant, parts), record);
  return record;
}

/**
 * Writes a record of the journal, where there is none (`FIN-03`).
 *
 * The read before the write is the whole of it. A key that already holds a
 * record is a second write to something that is written once, and that is a
 * defect in whatever asked — an identifier reused for a second event, a
 * reversal of an entry already reversed that nothing checked — so it raises
 * rather than refusing: a caller that reached this has already been given the
 * refusal it could act on, or should have been, and quietly keeping the first
 * record would hide the defect under a success.
 *
 * The read is also what makes two commands writing one key at once serialise:
 * both read it absent, one commits, and the other's commit is refused for
 * having read what the first changed.
 */
export function appendRecord<C extends Appended>(
  session: RecordSession,
  collection: C,
  tenant: TenantId,
  parts: readonly string[],
  record: AppendedShapes[C],
): AppendedShapes[C] {
  const key = keyFor(collection, tenant, parts);
  const existing = session.get(key);
  if (existing !== undefined && existing !== null) {
    throw new Error(
      `The journal already holds ${collection} ${parts.join('/')} of tenant ${tenant}. ` +
        'A journal record is written once and never again (FIN-03).',
    );
  }
  Object.freeze(record);
  session.put(key, record);
  return record;
}

/**
 * Every record of a collection belonging to one tenant, beneath a prefix.
 *
 * A scan of the key space, which is what the memory store can do; `U07`'s
 * driver replaces it with an index. The prefix ends in a separator, so tenant
 * `ab` never reads the records of tenant `abc`, and an entry's lines never
 * include those of an entry whose identifier merely begins the same way.
 */
export function scanRecords<C extends Collection>(
  session: RecordSession,
  collection: C,
  tenant: TenantId,
  parts: readonly string[] = [],
): StoredShapes[C][] {
  const prefix = `${keyFor(collection, tenant, parts)}/`;
  const found: StoredShapes[C][] = [];
  for (const key of session.keys()) {
    if (!key.startsWith(prefix)) continue;
    const value = session.get(key);
    if (value !== undefined && value !== null) found.push(value as StoredShapes[C]);
  }
  return found;
}
