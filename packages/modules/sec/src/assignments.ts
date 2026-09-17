import type { BranchId, PermissionId, UserId } from '@vertex/contracts';
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
import {
  coveredBy,
  reachesAllOf,
  reachesNothing,
  reachFor,
  strandedBy,
  strandingRefusal,
} from './decide.js';
import { assignmentIn, roleIn, userIn, writeAssignment } from './records.js';

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

/** A confinement of this module's own, holding nothing the caller can still reach. */
function copyOf(confinement: Confinement): Confinement {
  if (confinement.kind === 'tenant') return Object.freeze({ kind: 'tenant' as const });
  return Object.freeze({
    kind: 'branches' as const,
    branches: Object.freeze([...confinement.branches]),
    locations: Object.freeze([...confinement.locations]),
  });
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
  if (!coveredBy(reach, confinement)) return refusal('sec.confinement-exceeds-own', { right });
  return null;
}

export function assignRole(
  session: RecordSession,
  by: CommandContext,
  input: NewAssignment,
): Outcome<Assignment> {
  // Checked here as well as in `placesNamed`, which runs first and has already
  // refused this. The two are in different files and only one of them is on the
  // path of every future caller; a confinement that reaches nowhere is not an
  // assignment anybody means to make, and it is the shape most likely to slip
  // past a guard written elsewhere.
  if (input.confinement.kind === 'branches' && input.confinement.branches.length === 0) {
    return refuse('sec.confinement-empty');
  }

  const permitted = mayStaff(session, by, SEC_PERMISSIONS.assignment.create, input.confinement);
  if (permitted !== null) return err(permitted);

  // Somebody who works here. An assignment naming anybody else was accepted and
  // sat dormant, and took effect the day that identity was admitted to this
  // tenant — a grant nobody decided on at the moment it began to count.
  if (userIn(session, by.tenant, input.user) === null) {
    return refuse('sec.user-not-found', { user: input.user });
  }

  const role = roleIn(session, by.tenant, input.role);
  if (role === null) return refuse('sec.role-not-found', { role: input.role });
  if (!role.active) return refuse('sec.role-withdrawn', { role: input.role });

  const beyond = reachesAllOf(session, by, role.rights, input.confinement);
  if (beyond !== null) return err(beyond);

  // Assigning a role somebody already holds replaces its reach, which is a
  // withdrawal of the old reach as much as a grant of the new one. Checked only
  // as a grant, it was the way round every rule a withdrawal keeps: an
  // administrator of one branch who may not stand down a tenant-wide cashier
  // re-assigned them to that branch instead, and an owner confined to Aleppo
  // narrowed the real owner's role to Aleppo — after which nobody held role
  // editing anywhere the shop could use it, for good.
  const existing = assignmentIn(session, by.tenant, input.user, role.id);
  if (existing?.active === true) {
    const standDown = mayStaff(
      session,
      by,
      SEC_PERMISSIONS.assignment.withdraw,
      existing.confinement,
    );
    if (standDown !== null) return err(standDown);

    const outranked = reachesAllOf(session, by, role.rights, existing.confinement);
    if (outranked !== null) return err(outranked);

    if (existing.confinement.kind === 'tenant' && input.confinement.kind !== 'tenant') {
      const stranded = strandedBy(session, by.tenant, {
        kind: 'assignment',
        user: input.user,
        role: role.id,
      });
      if (stranded !== null) return err(strandingRefusal(stranded, { user: input.user }));
    }
  }

  const assignment: Assignment = {
    tenant: by.tenant,
    user: input.user,
    role: role.id,
    // Copied, not merely frozen. The arrays came from the caller, and the store
    // keeps what it is given: an array the caller went on to push onto would
    // widen a committed grant with no command having run.
    confinement: copyOf(input.confinement),
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

  // Ranked, as standing a person down is: taking somebody's role away is how an
  // account comes to hold nothing, and an account that holds nothing is one a
  // password reset no longer protects. A manager withdrew a co-owner's role,
  // reset the password of what was left, and signed in as a co-owner the moment
  // the owner put the role back.
  const held = roleIn(session, by.tenant, role);
  if (held !== null) {
    const outranked = reachesAllOf(session, by, held.rights, existing.confinement);
    if (outranked !== null) return err(outranked);
  }

  const stranded = strandedBy(session, by.tenant, { kind: 'assignment', user, role });
  if (stranded !== null) return err(strandingRefusal(stranded, { user }));

  // Idempotent, like every other withdrawal in this system: a replayed command
  // must not turn a sync that worked into a sync that failed.
  return ok(writeAssignment(session, by.tenant, { ...existing, active: false }));
}
