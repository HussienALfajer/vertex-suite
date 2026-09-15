import type { PermissionId, TenantId, UserId } from '@vertex/contracts';
import type { CommandContext } from '@vertex/platform';

import type { Assignment, Confinement, Decision, RecordSession, Where } from './contract.js';
import { assignmentsIn, rolesIn } from './records.js';

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
export function admits(confinement: Confinement, where: Where | undefined): boolean {
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

/** The assignments of one user that are live, with the roles behind them live too. */
export function liveGrants(
  session: RecordSession,
  tenant: TenantId,
  user: UserId,
): readonly { assignment: Assignment; rights: readonly PermissionId[] }[] {
  const roles = new Map(rolesIn(session, tenant).map((role) => [role.id, role] as const));
  return assignmentsIn(session, tenant)
    .filter((assignment) => assignment.user === user && assignment.active)
    .flatMap((assignment) => {
      const role = roles.get(assignment.role);
      if (!role?.active) return [];
      return [{ assignment, rights: role.rights }];
    });
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
