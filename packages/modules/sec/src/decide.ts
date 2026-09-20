import type { PermissionId, TenantId, UserId } from '@vertex/contracts';
import type { CommandContext } from '@vertex/platform';

import { refusal } from '@vertex/kernel';

import {
  SEC_PERMISSIONS,
  type Assignment,
  type Confinement,
  type Decision,
  type RecordSession,
  type RoleId,
  type SecRefusal,
  type Where,
} from './contract.js';
import { assignmentsIn, rolesIn, userIn } from './records.js';

/**
 * The answer to `SEC-02` and `SEC-04`, and nothing else.
 *
 * Every function here is pure over what it is handed. That is worth insisting
 * on: this is the file that decides whether somebody may take money out of a
 * till, and a decision that depends on the time, on a cache, or on which screen
 * asked it is a decision nobody can reproduce when it turns out to have been
 * wrong.
 *
 * The decision asks nothing of `SYS`. Whether a branch is still trading is
 * `SYS`'s question, answered by the command that is about to write to it; this
 * file answers only whether this person's rights reach that place. Two
 * questions with two owners, and conflating them would make every permission
 * check a second round trip that fails differently.
 */

/**
 * Whether a confinement admits an action taken here.
 *
 * `where` without a branch is the tenant-wide place — an action that has no
 * branch at all, like revising the company's own profile — and only an
 * unconfined assignment admits one. The other reading, that an absent branch
 * means "anywhere", is how somebody who runs one shop comes to edit the tax
 * number printed on every receipt in the group.
 */
function admits(confinement: Confinement, where: Where | undefined): boolean {
  if (confinement.kind === 'tenant') return true;

  const branch = where?.branch;
  if (branch === undefined) return false;
  if (!confinement.branches.includes(branch)) return false;

  const location = where?.location;
  if (location === undefined) return true;
  // Naming no location means every location of those branches. Naming some
  // narrows only the questions that name one: a keeper confined to the store
  // room can still be shown which branch they are standing in.
  if (confinement.locations.length === 0) return true;
  return confinement.locations.includes(location);
}

/**
 * Whether the grants somebody holds reach everywhere a confinement does.
 *
 * A list of grants rather than one merged confinement, and that is the whole
 * point. Merging them loses the thing that matters: somebody who may work in
 * every location of Homs and only in the store room of Aleppo cannot be
 * described by one set of branches and one set of locations, and the merged
 * answer — both branches, no location narrowing — hands out Aleppo's shop
 * floor to a person the decision itself refuses there.
 *
 * It is still a comparison of shapes rather than of places, because the places
 * inside a confinement are not enumerable: "every location of Aleppo" includes
 * the one that opens next month, so checking place by place would pass a grant
 * that outlives the check.
 *
 * Where the shapes cannot be told apart it refuses. A confinement's locations
 * are not attributed to particular branches, so a grant narrowed in one branch
 * is treated as narrowing the question in every branch of that confinement.
 * That refuses a few assignments somebody could legitimately have made; the
 * opposite error hands out a shop.
 */
export function coveredBy(mine: readonly Confinement[], theirs: Confinement): boolean {
  if (mine.some((one) => one.kind === 'tenant')) return true;
  if (theirs.kind === 'tenant') return false;
  // Vacuously true is not an answer a guard may give. A confinement that
  // reaches nowhere is not something to hand out, and "everything covers
  // nothing" is exactly how an empty list slips past a check.
  if (theirs.branches.length === 0) return false;

  return theirs.branches.every((branch) => {
    const here = mine.filter((one) => one.kind === 'branches' && one.branches.includes(branch));
    if (here.length === 0) return false;
    // Held across the whole branch by at least one grant: nothing to narrow.
    if (here.some((one) => one.kind === 'branches' && one.locations.length === 0)) return true;

    const reachable = new Set(
      here.flatMap((one) => (one.kind === 'branches' ? [...one.locations] : [])),
    );
    if (theirs.locations.length === 0) return false;
    return theirs.locations.every((location) => reachable.has(location));
  });
}

/**
 * Somebody who does not hold the right anywhere. Distinct from a narrow reach,
 * and the two produce different refusals, because "you do not do this" and "not
 * in that branch" are different things to be told.
 */
export function reachesNothing(grants: readonly Confinement[]): boolean {
  return grants.length === 0;
}

export interface Grant {
  readonly assignment: Assignment;
  readonly rights: readonly PermissionId[];
}

function grants(
  session: RecordSession,
  tenant: TenantId,
  user: UserId,
  live: boolean,
): readonly Grant[] {
  const roles = new Map(rolesIn(session, tenant).map((role) => [role.id, role] as const));
  return assignmentsIn(session, tenant)
    .filter((assignment) => assignment.user === user && (!live || assignment.active))
    .flatMap((assignment) => {
      const role = roles.get(assignment.role);
      if (role === undefined || (live && !role.active)) return [];
      return [{ assignment, rights: role.rights }];
    });
}

/**
 * Everything a role would give this person, whether or not they still work
 * here — and whether or not the assignment, or the role, is still in force.
 *
 * The distinction from `liveGrants` is not pedantry. It is what a **password
 * reset** has to be measured against (`SEC-09`): resetting the password of a
 * withdrawn administrator, then putting them back, is the same escalation as
 * resetting a working one — and a check that read only live grants would wave
 * the first one through because a withdrawn person appears to hold nothing.
 *
 * A withdrawn assignment and a withdrawn role are the same move one step
 * removed, and this once counted neither: withdraw the co-owner's assignment,
 * reset the password of an account that now held nothing, wait for the owner
 * to put the assignment back, sign in as a co-owner. So what somebody **could
 * be given back** counts, because giving it back is one click by somebody else.
 */
export function grantsOf(session: RecordSession, tenant: TenantId, user: UserId): readonly Grant[] {
  return grants(session, tenant, user, false);
}

/**
 * What this person may actually do here, now.
 *
 * A withdrawn user holds nothing, immediately and everywhere: `SEC-09`
 * deactivates rather than deletes, and a deactivation that left the rights
 * behind would be a sacking that still opens the till. Somebody who was never
 * enrolled in this tenant holds nothing for the same reason — an assignment
 * naming them is a row about a person who does not work here.
 */
function liveGrants(session: RecordSession, tenant: TenantId, user: UserId): readonly Grant[] {
  const here = userIn(session, tenant, user);
  if (!here?.active) return [];
  return grants(session, tenant, user, true);
}

/**
 * Every grant that gives a user one right, one per assignment that carries it.
 *
 * Not merged into a single confinement, for the reason `coveredBy` gives: two
 * grants of different shapes have no single shape, and the merged one always
 * errs the dangerous way.
 */
export function reachFor(
  session: RecordSession,
  tenant: TenantId,
  user: UserId,
  right: PermissionId,
): readonly Confinement[] {
  return Object.freeze(
    liveGrants(session, tenant, user)
      .filter((grant) => grant.rights.includes(right))
      .map((grant) => grant.assignment.confinement),
  );
}

/**
 * Whether the caller could hand every one of these rights over that much of the
 * shop group — the rule an assignment is held to, right by right, because a
 * role is a set and it takes one member of it to escalate.
 *
 * The system reaches everything. `null` is a refusal naming the first right
 * the caller does not reach there.
 */
export function reachesAllOf(
  session: RecordSession,
  by: CommandContext,
  rights: readonly PermissionId[],
  confinement: Confinement,
): SecRefusal | null {
  if (by.actor === null) return null;
  for (const right of rights) {
    if (!coveredBy(reachFor(session, by.tenant, by.actor, right), confinement)) {
      return refusal('sec.right-not-held', { right });
    }
  }
  return null;
}

/**
 * The grant about to stop granting anything, as the lock-out rule weighs it.
 *
 * Three commands can take the last way back out of a shop — withdrawing a role
 * or revoking the right from it, standing a person down, and withdrawing one
 * assignment — so the question each of them asks is the same question about a
 * different removal.
 */
export type Removing =
  | { readonly kind: 'role'; readonly role: RoleId }
  | { readonly kind: 'user'; readonly user: UserId }
  | { readonly kind: 'assignment'; readonly user: UserId; readonly role: RoleId };

function removed(assignment: Assignment, removing: Removing): boolean {
  switch (removing.kind) {
    case 'role':
      return assignment.role === removing.role;
    case 'user':
      return assignment.user === removing.user;
    case 'assignment':
      return assignment.user === removing.user && assignment.role === removing.role;
  }
}

/**
 * Whether anybody would still hold a right **across the whole tenant** once
 * that grant is gone.
 *
 * **A person holds a right only when three things are live at once**: the
 * person, the assignment, and the role. Counting any one of them by itself is
 * how a shop is told it has a way back that nobody can walk — a second role
 * carrying the right that nobody was ever put into, or an assignment to
 * somebody who no longer works here. Both look like cover and neither is.
 *
 * **And only tenant-wide.** Every role and user command is guarded with no
 * branch, which only an unconfined grant admits, and a right can be put into a
 * role only by somebody holding it tenant-wide. An owner confined to Aleppo was
 * once counted as the way back, and after the real owner stood down nobody
 * could edit a role, enrol a person or put the owner back.
 *
 * One function for all three commands on purpose. The rule was written out
 * three times, each counting something different, and the one that counted
 * roles let an administrator withdraw the only role anybody held: the command
 * was permitted, and afterwards nobody in the shop could restore the role,
 * staff anybody, or hire. `SEC-09` and `SYS-09` both say the way back is never
 * the vendor, so there was no way back at all.
 */
function stillHeldByAnybody(
  session: RecordSession,
  tenant: TenantId,
  right: PermissionId,
  removing: Removing,
): boolean {
  const roles = new Map(rolesIn(session, tenant).map((role) => [role.id, role] as const));

  return assignmentsIn(session, tenant).some((assignment) => {
    if (!assignment.active || removed(assignment, removing)) return false;
    if (assignment.confinement.kind !== 'tenant') return false;
    const role = roles.get(assignment.role);
    if (role === undefined || !role.active || !role.rights.includes(right)) return false;
    return userIn(session, tenant, assignment.user)?.active === true;
  });
}

/**
 * The first right a removal would leave nobody holding across the tenant.
 *
 * Every right, and not only the right to edit roles. Granting a right needs it
 * held tenant-wide, so the moment nobody holds one tenant-wide is the moment
 * nobody can ever grant it again — and taking a right off a role needs only the
 * right to edit the role. An owner who unticked "assign roles" on their own
 * role, alone in their shop, had removed it from the product for good: nobody
 * could re-grant it, define a role with it, or staff anybody. `SEC-09` says the
 * way back is never the vendor, so that has to be refused while it can be.
 *
 * Only rights the removed grants actually hold tenant-wide are weighed: a
 * removal that takes nothing away from the tenant-wide picture strands nothing,
 * whatever else is already missing from it. `among` narrows the rights to the
 * ones being taken, for a revocation that leaves the rest of the role alone.
 *
 * Role editing is weighed first, so the refusal names the loss that matters most.
 */
export function strandedBy(
  session: RecordSession,
  tenant: TenantId,
  removing: Removing,
  among?: readonly PermissionId[],
): PermissionId | null {
  const roles = new Map(rolesIn(session, tenant).map((role) => [role.id, role] as const));
  const losing = new Set<PermissionId>();

  for (const assignment of assignmentsIn(session, tenant)) {
    if (!assignment.active || assignment.confinement.kind !== 'tenant') continue;
    if (!removed(assignment, removing)) continue;
    const role = roles.get(assignment.role);
    if (!role?.active) continue;
    if (!userIn(session, tenant, assignment.user)?.active) continue;
    for (const right of role.rights) {
      if (among === undefined || among.includes(right)) losing.add(right);
    }
  }

  const keystone = SEC_PERMISSIONS.role.edit;
  const ordered = [...losing].sort(
    (one, two) => Number(two === keystone) - Number(one === keystone),
  );
  return ordered.find((right) => !stillHeldByAnybody(session, tenant, right, removing)) ?? null;
}

/**
 * The refusal for a removal that would strand a right.
 *
 * Role editing keeps its own code: it is the loss after which nothing else can
 * be repaired, and the sentence a person reads says so.
 */
export function strandingRefusal(
  right: PermissionId,
  values: Readonly<Record<string, string>>,
): SecRefusal {
  return right === SEC_PERMISSIONS.role.edit
    ? refusal('sec.last-owner', values)
    : refusal('sec.last-holder', { ...values, right });
}

/**
 * The decision itself.
 *
 * `declared` is what this edition's modules define. A right outside it is the
 * host's own defect — a name nothing declares, so nothing can ever grant it —
 * and reporting that as an ordinary "not permitted" would leave a screen
 * showing a disabled button instead of a mistake somebody can fix.
 */
export function decideFor(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  right: PermissionId,
  where: Where | undefined,
): Decision {
  if (!declared.has(right)) return { granted: false, grounds: 'no-such-right' };

  // No actor is the system: a migration, a scheduled job, a sync applying work
  // that was authorised on the register that did it. Refusing these would leave
  // a store node unable to apply the trading of a shop that was offline, which
  // is the one thing `POS-19` promises. The grounds record that it happened, so
  // `SEC-06`'s audit can tell it from a person.
  if (by.actor === null) return { granted: true, grounds: 'system' };

  const grants = liveGrants(session, by.tenant, by.actor);
  const holding = grants.filter((grant) => grant.rights.includes(right));
  if (holding.length === 0) return { granted: false, grounds: 'no-actor-rights' };
  if (!holding.some((grant) => admits(grant.assignment.confinement, where))) {
    return { granted: false, grounds: 'outside-confinement' };
  }
  return { granted: true, grounds: 'granted' };
}
