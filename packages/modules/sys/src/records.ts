import type { TenantId } from '@vertex/contracts';

import type { Branch, BusinessProfile, Company, Location, Register } from './contract.js';

/**
 * What `SYS` needs from a store, stated so that `U07` knows what to satisfy.
 *
 * The drivers arrive with `U07`; until then this module runs over the memory
 * store the platform ships, and the point of naming the port is that the module
 * depends on a shape rather than on that store. When the real session arrives,
 * this file is what changes.
 *
 * Note what is **missing**: there is no `remove`. `SYS-09` says structural
 * entities are deactivated and never deleted, because stock movements and
 * documents reference them permanently — and the strongest way to say that is
 * to write a module that has no way of deleting anything. A future command that
 * wanted to would have to widen this interface first, in a diff a reviewer
 * reads before the deletion rather than after it.
 */
export interface RecordSession {
  put(key: string, value: unknown): void;
  get(key: string): unknown;
  keys(): readonly string[];
}

/**
 * A setting's stored form, which is not the value itself.
 *
 * `null` is a real answer here: it says this branch has deliberately no opinion
 * and takes the tenant's. The distinction is what lets an override be cleared
 * without deleting the row that records it.
 */
export interface SettingRecord {
  readonly value: string | null;
}

/**
 * What lives in each collection.
 *
 * The store hands back `unknown`, so somewhere a shape has to be asserted. It
 * is asserted **here, against the collection name**, so that the assertion and
 * the key that produced it are the same decision — reading a branch key and
 * calling the result a `Company` is not expressible.
 */
export interface StoredShapes {
  readonly company: Company;
  readonly branch: Branch;
  readonly location: Location;
  readonly register: Register;
  readonly profile: BusinessProfile;
  readonly setting: SettingRecord;
}

export type Collection = keyof StoredShapes;

/**
 * `sys/branch/<tenant>/<id>`.
 *
 * The tenant is the third segment of every key this module writes, which makes
 * a read that forgot it a read that finds nothing rather than a read that finds
 * somebody else's shop.
 *
 * Every segment is percent-encoded, the tenant included. A setting key is
 * chosen by whichever module declared it, so a `/` in one would silently
 * reshape the key — and the tenant is encoded for a sharper reason: the brand
 * on `TenantId` is a compile-time claim that is gone at run time, so a value
 * carrying a `/` would nest one tenant's keys underneath another's prefix and
 * put its records into that tenant's listings. Encoding costs nothing for a
 * well-formed identifier and removes the question.
 */
function keyFor(collection: Collection, tenant: TenantId, parts: readonly string[]): string {
  return ['sys', collection, ...[tenant, ...parts].map(encodeURIComponent)].join('/');
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
  // cannot let them edit committed state from the outside. Frozen in place
  // rather than through the return value, which a generic shape cannot be
  // proved equal to itself once `Readonly` has been applied to it.
  Object.freeze(record);
  session.put(keyFor(collection, tenant, parts), record);
  return record;
}

/**
 * Every record of a collection belonging to one tenant.
 *
 * A full scan of the key space, which is what the memory store can do and what
 * the driver of `U07` will replace with an index. It is correct now and slow
 * later, which is the right way round: the shape of the answer is what the rest
 * of this module is written against.
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
