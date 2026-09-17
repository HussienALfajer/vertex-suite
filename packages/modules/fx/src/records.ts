import type { TenantId } from '@vertex/contracts';
import type { CurrencyCode } from '@vertex/kernel';

import type { RecordSession, TenantCurrency } from './contract.js';

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
}

export interface StoredShapes {
  readonly currency: TenantCurrency;
  readonly functional: FunctionalRecord;
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
 * Every record of a collection belonging to one tenant.
 *
 * A scan of the key space, which is what the memory store can do; `U07`'s
 * driver replaces it with an index. The prefix ends in a separator, so tenant
 * `ab` never reads the records of tenant `abc`.
 */
export function scanRecords<C extends Collection>(
  session: RecordSession,
  collection: C,
  tenant: TenantId,
): StoredShapes[C][] {
  const prefix = `${keyFor(collection, tenant, [])}/`;
  const found: StoredShapes[C][] = [];
  for (const key of session.keys()) {
    if (!key.startsWith(prefix)) continue;
    const value = session.get(key);
    if (value !== undefined && value !== null) found.push(value as StoredShapes[C]);
  }
  return found;
}
