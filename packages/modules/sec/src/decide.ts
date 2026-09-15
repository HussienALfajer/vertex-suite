import type { BranchId, LocationId, PermissionId, TenantId, UserId } from '@vertex/contracts';
import type { CommandContext } from '@vertex/platform';

import {
  TENANT_WIDE,
  type Assignment,
  type Confinement,
  type Decision,
  type RecordSession,
  type Where,
} from './contract.js';
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

const NOWHERE: Confinement = Object.freeze({ kind: 'branches', branches: [], locations: [] });

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
 * Whether `mine` reaches everywhere `theirs` does.
 *
 * What stops an administrator handing out more than they were given. It is
 * deliberately a comparison of two confinements rather than a series of
 * questions about places: the places inside a confinement are not enumerable —
 * "every location of Aleppo" includes the one that opens next month — so
 * checking place by place would silently pass a grant that outlives the check.
 */
export function covers(mine: Confinement, theirs: Confinement): boolean {
  if (mine.kind === 'tenant') return true;
  if (theirs.kind === 'tenant') return false;
  if (!theirs.branches.every((branch) => mine.branches.includes(branch))) return false;
  if (mine.locations.length === 0) return true;
  if (theirs.locations.length === 0) return false;
  return theirs.locations.every((location) => mine.locations.includes(location));
}

/**
 * A reach that admits nothing at all: somebody who does not hold the right
 * anywhere. Distinct from a narrow reach, and the two produce different
 * refusals, because "you do not do this" and "not in that branch" are different
 * things to be told.
 */
export function reachesNothing(confinement: Confinement): boolean {
  return confinement.kind === 'branches' && confinement.branches.length === 0;
}

export function union(confinements: readonly Confinement[]): Confinement {
  if (confinements.some((one) => one.kind === 'tenant')) return TENANT_WIDE;

  const branches = new Set<BranchId>();
  const locations = new Set<LocationId>();
  // A confinement that names no location already reaches every location of its
  // branches, so a union with a narrowed one is not the union of their two
  // lists — it is no list at all. Keeping both would claim a reach narrower
  // than the wider of the two grants already gives.
  let anyUnnarrowed = false;
  for (const one of confinements) {
    if (one.kind !== 'branches') continue;
    for (const branch of one.branches) branches.add(branch);
    if (one.locations.length === 0) anyUnnarrowed = true;
    else for (const location of one.locations) locations.add(location);
  }

  return Object.freeze({
    kind: 'branches' as const,
    branches: Object.freeze([...branches]),
    locations: Object.freeze(anyUnnarrowed ? [] : [...locations]),
  });
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
 * Everywhere a user holds one right, gathered across every role they are in.
 *
 * `NOWHERE` when they hold it in none — a confinement that admits nothing,
 * which `covers` then refuses to let them hand on. An absent answer would have
 * had to be special-cased at each of the three call sites, and one of them
 * would have got it wrong.
 */
export function reachFor(
  session: RecordSession,
  tenant: TenantId,
  user: UserId,
  right: PermissionId,
): Confinement {
  const held = liveGrants(session, tenant, user)
    .filter((grant) => grant.rights.includes(right))
    .map((grant) => grant.assignment.confinement);
  return held.length === 0 ? NOWHERE : union(held);
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
