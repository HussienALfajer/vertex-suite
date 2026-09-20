import type { TenantId, UserId } from '@vertex/contracts';

import type {
  Assignment,
  RecordSession,
  Recovery,
  RecoveryId,
  Role,
  RoleId,
  User,
} from './contract.js';

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
  readonly user: User;
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

function readRecord<C extends Collection>(
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

function scanRecords<C extends Collection>(
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

export function userIn(session: RecordSession, tenant: TenantId, id: UserId): User | null {
  return readRecord(session, 'user', tenant, [id]);
}

export function usersIn(session: RecordSession, tenant: TenantId): readonly User[] {
  return scanRecords(session, 'user', tenant);
}

export function writeUser(session: RecordSession, user: User): User {
  return writeRecord(session, 'user', user.tenant, [user.id], user);
}

/**
 * The sign-in behind a person, and the two records in this module that **no
 * tenant owns**.
 *
 * Everything else here is keyed under a tenant, and that is what makes a read
 * that forgot the tenant a read that finds nothing. These two cannot be: a
 * credential is precisely the thing two tenants may share, and `SEC-09`'s rule
 * — that an administrator may reset a password only when the sign-in is this
 * tenant's alone — is unanswerable from inside one tenant's keys.
 *
 * So the boundary moves rather than disappearing. The record is reachable only
 * through this module's own commands, each of which checks the tenant asking
 * against the tenants on the record, and nothing it holds is ever returned to a
 * caller: `User.shared` is a boolean computed from it, never the list.
 */
export interface IdentityRecord {
  readonly id: UserId;
  /** Null for a sign-in that has never had a password set. */
  readonly credential: string | null;
  /** Every tenant this sign-in works in. Never shown to any of them. */
  readonly tenants: readonly TenantId[];
}

function sharedKey(collection: 'identity' | 'recovery', id: string): string {
  return ['sec', collection, encodeURIComponent(id)].join('/');
}

export function identityIn(session: RecordSession, id: UserId): IdentityRecord | null {
  const value = session.get(sharedKey('identity', id));
  return value === undefined || value === null ? null : (value as IdentityRecord);
}

export function writeIdentity(session: RecordSession, record: IdentityRecord): IdentityRecord {
  Object.freeze(record);
  session.put(sharedKey('identity', record.id), record);
  return record;
}

export function recoveryIn(session: RecordSession, id: RecoveryId): Recovery | null {
  const value = session.get(sharedKey('recovery', id));
  return value === undefined || value === null ? null : (value as Recovery);
}

export function writeRecovery(session: RecordSession, record: Recovery): Recovery {
  Object.freeze(record);
  session.put(sharedKey('recovery', record.id), record);
  return record;
}
