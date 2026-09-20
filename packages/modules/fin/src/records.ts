import type { TenantId } from '@vertex/contracts';

import type { Account, AccountMapping, RecordSession } from './contract.js';

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
 * What this file will grow, and what it will not: the journal of `FIN-02`
 * arrives with its own collections and its own **append-only** writer, because
 * `FIN-03` forbids a second write to an entry or a line. The chart is not
 * append-only — an account is renamed, moved and withdrawn in place — and the
 * two are kept apart so that the writer below can never be the one that
 * touches a posted line.
 */
export interface StoredShapes {
  /** `fin/account/<tenant>/<id>` */
  readonly account: Account;
  /** `fin/mapping/<tenant>/<role>`: one account per role, the latest mapping winning. */
  readonly mapping: AccountMapping;
}

export type Collection = keyof StoredShapes;

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
