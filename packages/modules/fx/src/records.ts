import type { TenantId } from '@vertex/contracts';
import type { CurrencyCode, Instant, LocalDate } from '@vertex/kernel';

import type {
  LastKnownRates,
  RateOverride,
  RateRevision,
  RateRevisionId,
  RateStamp,
  RecordSession,
  SuggestedRate,
  SuggestedRateId,
  TenantCurrency,
} from './contract.js';

/**
 * The key layout, and the one place a stored shape is asserted.
 *
 * The arrangement `SYS` and `SEC` use, for their reasons: the store hands back
 * `unknown`, so a shape has to be asserted somewhere, and asserting it against
 * the collection name makes the assertion and the key that produced it one
 * decision. Reading the functional choice and calling it a currency is not
 * expressible.
 *
 * Three modules now carry a file of this shape, and it is not lifted into the
 * platform. The drivers of `U07` replace every one of them with a schema of the
 * module's own, and a shared helper would be a fourth thing to delete that day.
 */

/**
 * Which currency the books are kept in (`FX-02`).
 *
 * Its own record, and not a flag on a currency: a flag on each would have to be
 * kept true on exactly one of them, and two commands moving it at once would
 * leave either none or two. One record naming one code cannot say either.
 */
export interface FunctionalRecord {
  readonly tenant: TenantId;
  readonly currency: CurrencyCode;
  /**
   * When the first rate was written against it, after which it cannot change;
   * null until then. On this record rather than found by looking for rates, so
   * that the command choosing a currency and the command recording a rate each
   * read what the other writes, and the store refuses whichever commits second.
   */
  readonly fixedAt: Instant | null;
}

/**
 * Which revision of a day is in force, and how many there have been.
 *
 * A pointer rather than a search for the highest sequence: two corrections
 * recorded at once each read it before writing it, so one of them is refused at
 * commit instead of both being numbered 2.
 */
export interface RevisionHead {
  readonly revision: RateRevisionId;
  readonly sequence: number;
}

/** The tenant's latest suggestion for one currency, for the same reason. */
export interface SuggestionHead {
  readonly suggestion: SuggestedRateId;
}

/**
 * The furthest day a branch has recorded a rate for.
 *
 * A pointer rather than a scan of the branch's revisions for the highest day,
 * for the reason `RevisionHead` is one and for a second of its own: the scan
 * grows with every day the shop trades, and this is read before every rate
 * recorded anywhere.
 *
 * Written only when the day advances, so the ordinary case — several
 * currencies entered on the day already open — reads this key and writes
 * nothing, and two such commands do not collide over it. Two commands opening
 * the *same* new day do collide, and one of them is refused at commit and
 * succeeds on the retry, which is the correct answer rather than a cost.
 */
export interface LatestRateDay {
  readonly day: LocalDate;
}

export interface StoredShapes {
  readonly currency: TenantCurrency;
  readonly functional: FunctionalRecord;
  /** `fx/revision/<tenant>/<branch>/<currency>/<day>/<id>` */
  readonly revision: RateRevision;
  /** `fx/revision-head/<tenant>/<branch>/<currency>/<day>` */
  readonly 'revision-head': RevisionHead;
  /** `fx/suggestion/<tenant>/<currency>/<id>` */
  readonly suggestion: SuggestedRate;
  /** `fx/suggestion-head/<tenant>/<currency>` */
  readonly 'suggestion-head': SuggestionHead;
  /** `fx/last-known/<tenant>/<branch>/<day>/<device>`: one confirmation per register per day. */
  readonly 'last-known': LastKnownRates;
  /** `fx/latest-day/<tenant>/<branch>` */
  readonly 'latest-day': LatestRateDay;
  /**
   * `fx/stamp/<tenant>/<id>`
   *
   * By identifier alone, because that is how it is read: a document carries the
   * identifier and asks for that one stamp. Nothing lists a branch's stamps —
   * what a review reads is the override log below, which is much smaller and
   * keyed for exactly that question.
   */
  readonly stamp: RateStamp;
  /** `fx/override/<tenant>/<branch>/<day>/<id>` */
  readonly override: RateOverride;
}

export type Collection = keyof StoredShapes;

/**
 * `fx/currency/<tenant>/<code>`, and `fx/functional/<tenant>`.
 *
 * The tenant is the third segment of every key, so a read that forgot it finds
 * nothing rather than somebody else's shop. Every segment is percent-encoded,
 * the tenant included: the brand on `TenantId` is gone at run time, and a value
 * carrying a `/` would nest one tenant's records under another's prefix.
 */
function keyFor(collection: Collection, tenant: TenantId, parts: readonly string[]): string {
  return ['fx', collection, ...[tenant, ...parts].map(encodeURIComponent)].join('/');
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

export function writeRecord<C extends Collection>(
  session: RecordSession,
  collection: C,
  tenant: TenantId,
  parts: readonly string[],
  record: StoredShapes[C],
): StoredShapes[C] {
  // Frozen on the way in, so that handing the stored object back to a reader
  // cannot let them edit committed state from the outside.
  Object.freeze(record);
  session.put(keyFor(collection, tenant, parts), record);
  return record;
}

/**
 * Every record of a collection belonging to one tenant, or to one stretch of
 * its keys — `within` a branch and a currency, say.
 *
 * A scan of the key space, which is what the memory store can do; `U07`'s
 * driver replaces it with an index. The prefix ends in a separator, so tenant
 * `ab` never reads the records of tenant `abc`, and the revisions of one day
 * never include those of another whose key merely begins the same way.
 */
export function scanRecords<C extends Collection>(
  session: RecordSession,
  collection: C,
  tenant: TenantId,
  within: readonly string[] = [],
): StoredShapes[C][] {
  const prefix = `${keyFor(collection, tenant, within)}/`;
  const found: StoredShapes[C][] = [];
  for (const key of session.keys()) {
    if (!key.startsWith(prefix)) continue;
    const value = session.get(key);
    if (value !== undefined && value !== null) found.push(value as StoredShapes[C]);
  }
  return found;
}
