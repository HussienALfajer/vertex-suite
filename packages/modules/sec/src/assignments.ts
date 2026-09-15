import type { BranchId, PermissionId, TenantId, UserId } from '@vertex/contracts';
import { err, ok, refusal, refuse, type Result } from '@vertex/kernel';
import type { CommandContext } from '@vertex/platform';
import type { Organisation } from '@vertex/sys/contract';

import {
  SEC_PERMISSIONS,
  type Assignment,
  type Confinement,
  type NewAssignment,
  type RecordSession,
  type RoleId,
  type SecRefusal,
} from './contract.js';
import { covers, reachesNothing, reachFor } from './decide.js';
import { assignmentIn, assignmentsIn, roleIn, rolesIn, writeAssignment } from './records.js';

/**
 * Putting a user into a role over a stretch of the shop group: `SEC-04`.
 *
 * This is where the product's one real escalation path is closed. The right to
 * staff a shop is, without care, the right to become the owner of it — assign
 * yourself a richer role, or assign somebody else one and be told the password.
 * Two rules, both checked here:
 *
 *   - the assigner's own reach must **cover** the confinement being handed out,
 *     so a manager covering one branch staffs that branch;
 *   - and it must cover it **for every right in the role**, because a role is a
 *     set and it takes one member of it to escalate.
 *
 * The places themselves are checked against `SYS`, through its published
 * contract and no further: a branch that is not in this tenant is not a branch,
 * and a location that belongs to a branch nobody named would be a reach the
 * administrator did not mean to grant and could not see on the screen.
 */

type Outcome<T> = Result<T, SecRefusal>;

/**
 * The confinement, checked against the organisation it claims to name.
 *
 * Asked **before** this command's own transaction opens, not inside it. `SYS`
 * is reached through its contract, and that contract opens a transaction of its
 * own; asking from within ours would hold two at once for a read, which is
 * harmless over the memory store and is a second connection held open under
 * Postgres when the drivers arrive in `U07`.
 *
 * The window that opens — a branch withdrawn between this check and the write —
 * is deliberate and small. `SYS` does not cascade deactivation, and an
 * assignment naming a branch that has since shut is not wrong: the branch
 * reopens and the staffing is as it was. What would be wrong is an assignment
 * naming a branch that never existed, and that is what this refuses.
 *
 * It also means the places are confirmed before the caller's own right to staff
 * anybody is. What that discloses is whether an identifier the caller already
 * held names a branch of the tenant they are already signed in to, to somebody
 * who then gets no further; the alternatives are a second transaction per
 * command or a nested one, and neither is worth buying that back.
 */
export async function placesNamed(
  organisation: Organisation,
  by: CommandContext,
  confinement: Confinement,
): Promise<SecRefusal | null> {
  if (confinement.kind === 'tenant') return null;
  if (confinement.branches.length === 0) return refusal('sec.confinement-empty');

  const named = new Set<BranchId>(confinement.branches);
  for (const branch of confinement.branches) {
    const found = await organisation.branch(by, branch);
    if (found === null) return refusal('sec.branch-not-found', { branch });
    if (!found.active) return refusal('sec.branch-inactive', { branch: found.name });
  }
  for (const location of confinement.locations) {
    const found = await organisation.location(by, location);
    if (found === null) return refusal('sec.location-not-found', { location });
    // A location narrows within the branches named beside it. One that belongs
    // to a branch nobody named is either a mistake or a reach the administrator
    // cannot see on the screen they granted it from.
    if (!named.has(found.branch)) {
      return refusal('sec.location-outside-confinement', { location: found.name });
    }
  }
  return null;
}

/** Everything the assigner would be handing over, right by right. */
function withinTheirReach(
  session: RecordSession,
  by: CommandContext,
  rights: readonly PermissionId[],
  confinement: Confinement,
): SecRefusal | null {
  if (by.actor === null) return null;

  for (const right of rights) {
    const reach = reachFor(session, by.tenant, by.actor, right);
    if (!covers(reach, confinement)) {
      return refusal('sec.right-not-held', { right });
    }
  }
  return null;
}

/**
 * Whether this administrator may staff that much of the shop group.
 *
 * Two refusals rather than one, because they are two different sentences to
 * whoever is holding the screen: a person who does not staff anybody at all,
 * and a person who staffs their own branch and has just tried to staff the
 * group. The second is an ordinary mistake and the first is a job description.
 */
function mayStaff(
  session: RecordSession,
  by: CommandContext,
  right: PermissionId,
  confinement: Confinement,
): SecRefusal | null {
  if (by.actor === null) return null;

  const reach = reachFor(session, by.tenant, by.actor, right);
  if (reachesNothing(reach)) return refusal('sec.not-permitted', { right });
  if (!covers(reach, confinement)) return refusal('sec.confinement-exceeds-own', { right });
  return null;
}

export function assignRole(
  session: RecordSession,
  by: CommandContext,
  input: NewAssignment,
): Outcome<Assignment> {
  const permitted = mayStaff(session, by, SEC_PERMISSIONS.assignment.create, input.confinement);
  if (permitted !== null) return err(permitted);

  const role = roleIn(session, by.tenant, input.role);
  if (role === null) return refuse('sec.role-not-found', { role: input.role });
  if (!role.active) return refuse('sec.role-withdrawn', { role: input.role });

  const beyond = withinTheirReach(session, by, role.rights, input.confinement);
  if (beyond !== null) return err(beyond);

  const assignment: Assignment = {
    tenant: by.tenant,
    user: input.user,
    role: role.id,
    confinement: Object.freeze(input.confinement),
    active: true,
  };
  return ok(writeAssignment(session, by.tenant, assignment));
}

export function withdrawAssignment(
  session: RecordSession,
  by: CommandContext,
  user: UserId,
  role: RoleId,
): Outcome<Assignment> {
  const existing = assignmentIn(session, by.tenant, user, role);
  if (existing === null) return refuse('sec.assignment-not-found', { role });

  // Measured against what is being taken away rather than against nothing: an
  // administrator who may staff a branch may also stand down whoever they put
  // there, and may not reach into the branch next door to do it.
  const permitted = mayStaff(
    session,
    by,
    SEC_PERMISSIONS.assignment.withdraw,
    existing.confinement,
  );
  if (permitted !== null) return err(permitted);

  const lockout = wouldStrandTheTenant(session, by.tenant, existing);
  if (lockout !== null) return err(lockout);

  // Idempotent, like every other withdrawal in this system: a replayed command
  // must not turn a sync that worked into a sync that failed.
  return ok(writeAssignment(session, by.tenant, { ...existing, active: false }));
}

/**
 * Whether standing this person down leaves nobody who can put them back.
 *
 * The same rule as withdrawing the last role that can edit roles, one level
 * out: `SYS-09` and `SEC-09` both say this is the tenant's own administrator's
 * work and **never the vendor's**, and a shop whose last administrator has been
 * withdrawn has no way back that does not involve somebody with a database
 * client. The command is refused while there is still somebody who can act.
 */
function wouldStrandTheTenant(
  session: RecordSession,
  tenant: TenantId,
  leaving: Assignment,
): SecRefusal | null {
  const keystone = SEC_PERMISSIONS.role.edit;
  const rolesHolding = new Set(
    rolesIn(session, tenant)
      .filter((role) => role.active && role.rights.includes(keystone))
      .map((role) => role.id),
  );
  if (!rolesHolding.has(leaving.role)) return null;

  const others = assignmentsIn(session, tenant).filter(
    (one) =>
      one.active &&
      rolesHolding.has(one.role) &&
      !(one.user === leaving.user && one.role === leaving.role),
  );
  return others.length === 0 ? refusal('sec.last-owner', { user: leaving.user }) : null;
}
