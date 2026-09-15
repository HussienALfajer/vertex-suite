import type { TenantId, UserId } from '@vertex/contracts';

import type { Assignment, RecordSession, Role, RoleId } from './contract.js';

/**
 * The key layout, and the one place a stored shape is asserted.
 *
 * The same arrangement `SYS` uses, for the same reasons: the store hands back
 * `unknown`, so a shape has to be asserted somewhere, and asserting it against
 * the collection name makes the assertion and the key that produced it one
 * decision. Reading an assignment key and calling the result a `Role` is not
 * expressible.
 *
 * The drivers arrive with `U07`. Until then this module runs over the memory
 * store the platform ships and depends on a shape rather than on that store;
 * when the real session arrives, this file is what changes.
 */
export interface StoredShapes {
  readonly role: Role;
  readonly assignment: Assignment;
}

export type Collection = keyof StoredShapes;

/**
 * `sec/role/<tenant>/<id>`.
 *
 * Every segment is percent-encoded, the tenant included: the brand on a
 * `TenantId` is a compile-time claim that is gone at run time, and a value
 * carrying a `/` would nest one tenant's records underneath another's prefix —
 * which here would mean one shop's roles appearing in another shop's role
 * editor.
 */
function keyFor(collection: Collection, tenant: TenantId, parts: readonly string[]): string {
  return ['sec', collection, ...[tenant, ...parts].map(encodeURIComponent)].join('/');
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
  // Frozen on the way in, so that handing the stored object to a reader cannot
  // let them edit committed state from the outside — which for a role would be
  // editing what somebody may do without any command having been run.
  Object.freeze(record);
  session.put(keyFor(collection, tenant, parts), record);
  return record;
}

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

export function roleIn(session: RecordSession, tenant: TenantId, id: RoleId): Role | null {
  return readRecord(session, 'role', tenant, [id]);
}

export function rolesIn(session: RecordSession, tenant: TenantId): readonly Role[] {
  return scanRecords(session, 'role', tenant);
}

/**
 * One assignment per user and role.
 *
 * The pair is the key rather than an identifier of its own, which makes
 * assigning a role somebody already holds a revision of what they hold instead
 * of a second grant. `SYN-02` replays commands, and two rows for one grant
 * would leave a withdrawal that withdraws half of it.
 */
export function assignmentIn(
  session: RecordSession,
  tenant: TenantId,
  user: UserId,
  role: RoleId,
): Assignment | null {
  return readRecord(session, 'assignment', tenant, [user, role]);
}

export function writeAssignment(
  session: RecordSession,
  tenant: TenantId,
  assignment: Assignment,
): Assignment {
  return writeRecord(session, 'assignment', tenant, [assignment.user, assignment.role], assignment);
}

export function assignmentsIn(session: RecordSession, tenant: TenantId): readonly Assignment[] {
  return scanRecords(session, 'assignment', tenant);
}
