import { OWNER, SEEDED_ROLES, type PermissionId, type SeededRole } from '@vertex/contracts';
import { err, newId, ok, refusal, refuse, type Result } from '@vertex/kernel';
import type { CommandContext, PermissionDeclaration } from '@vertex/platform';

import {
  SEC_PERMISSIONS,
  type NewRole,
  type RecordSession,
  type Role,
  type RoleId,
  type SecRefusal,
} from './contract.js';
import { decideFor, reachesAllOf, strandedBy, strandingRefusal } from './decide.js';
import { assignmentsIn, roleIn, rolesIn, writeRecord } from './records.js';

/**
 * Roles: `SEC-01`, and the two rules that keep `SEC-02` from being a way round
 * itself.
 *
 * Every function checks before it writes, for the reason `SYS` gives: a refusal
 * is a returned value, so the transaction it was refused in still commits, and
 * a command that had already written something would leave it behind.
 *
 * Every function also checks **the caller**, which no other module does. The
 * guard belongs at the boundary everywhere else, because no module may depend
 * on `SEC` to ask. Here the authority and the command are in one module, and
 * the command is the one whose unguarded version hands over everything.
 */

type Outcome<T> = Result<T, SecRefusal>;

function named(value: string): string | null {
  const name = value.trim();
  return name === '' ? null : name;
}

/**
 * What the seven start out holding, worked out from the declarations rather
 * than written down here.
 *
 * `SEC` never learns what another module's rights mean. `STK` says a warehouse
 * keeper has business with a stock location; an edition without `STK` simply
 * has no such right and no role mentions one. The owner is the exception and is
 * computed, not declared: every right the edition has, so that a module
 * shipping next year is covered by a decision taken now.
 */
export function seededRights(
  declared: readonly PermissionDeclaration[],
  role: SeededRole,
): readonly PermissionId[] {
  const held = declared.filter((one) => role === OWNER || (one.seededFor ?? []).includes(role));
  return Object.freeze(held.map((one) => one.id as PermissionId));
}

function guard(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  right: PermissionId,
): SecRefusal | null {
  const decision = decideFor(session, by, declared, right, undefined);
  return decision.granted ? null : refusal('sec.not-permitted', { right });
}

/**
 * Rights an administrator may put into a role: declared by a module, and held
 * by the administrator across the whole tenant.
 *
 * Tenant-wide because a role is tenant-wide. Whoever is assigned it without a
 * confinement holds every right in it everywhere, so a manager who may edit one
 * branch cannot put branch editing into a role and wait for somebody else to
 * hand it out.
 */
function grantable(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  rights: readonly PermissionId[],
): SecRefusal | null {
  for (const right of rights) {
    if (!declared.has(right)) return refusal('sec.right-undeclared', { right });
    if (!decideFor(session, by, declared, right, undefined).granted) {
      return refusal('sec.right-not-held', { right });
    }
  }
  return null;
}

/**
 * Whether the caller could have handed this role to everybody who holds it.
 *
 * Taking a right off a role, or withdrawing the role, acts on every person in
 * it, and needs only the right to edit roles. Without this, a person trusted to
 * maintain the cashier role could take role editing, company creation and
 * enrolment off the **owner's** role; the owner could then neither take them
 * back — granting needs them held — nor put themselves into the editor's role,
 * and the shop's roles belonged to whoever had been asked to tidy them.
 *
 * So the caller must reach every right of the role over the reach of each
 * assignment of it, active or not: an assignment standing withdrawn is one
 * click from counting again.
 */
function outranksHolders(
  session: RecordSession,
  by: CommandContext,
  role: Role,
): SecRefusal | null {
  for (const assignment of assignmentsIn(session, by.tenant)) {
    if (assignment.role !== role.id) continue;
    const outranked = reachesAllOf(session, by, role.rights, assignment.confinement);
    if (outranked !== null) return outranked;
  }
  return null;
}

function sameRights(one: readonly PermissionId[], two: readonly PermissionId[]): boolean {
  return one.length === two.length && one.every((right) => two.includes(right));
}

function without<T>(values: readonly T[], removed: readonly T[]): readonly T[] {
  return values.filter((one) => !removed.includes(one));
}

function withAll<T>(values: readonly T[], added: readonly T[]): readonly T[] {
  return [...values, ...added.filter((one) => !values.includes(one))];
}

export function seedRoles(
  session: RecordSession,
  by: CommandContext,
  declarations: readonly PermissionDeclaration[],
  declared: ReadonlySet<string>,
): Outcome<readonly Role[]> {
  const permitted = guard(session, by, declared, SEC_PERMISSIONS.role.create);
  if (permitted !== null) return err(permitted);

  const existing = new Map(
    rolesIn(session, by.tenant)
      .filter((role): role is Role & { seeded: SeededRole } => role.seeded !== null)
      .map((role) => [role.seeded, role] as const),
  );

  const seeded = SEEDED_ROLES.map((key) => {
    const shipped = seededRights(declarations, key);
    const already = existing.get(key);

    if (already === undefined) {
      const role: Role = {
        id: newId<'role'>(),
        tenant: by.tenant,
        seeded: key,
        // Displayed through the terminology layer until somebody renames it,
        // which is what design-system.md §12 requires of a string on a screen.
        name: null,
        rights: shipped,
        seededWith: shipped,
        active: true,
      };
      return writeRecord(session, 'role', by.tenant, [role.id], role);
    }

    // Already there. The shipped rights are a starting point and never an
    // argument — re-imposing them would silently undo every edit a shop had
    // made, and the shop would find out at a till. But an edition that has
    // grown since has rights this role has never been offered, and leaving
    // those out means a customer who buys `POS` finds that nobody may sell.
    //
    // So only what is genuinely **new** is added: a right the defaults have
    // never offered this role before. One an administrator took away is in
    // `seededWith` and stays gone.
    const added = shipped.filter((right) => !already.seededWith.includes(right));
    if (added.length === 0 && sameRights(already.seededWith, shipped)) return already;

    return writeRecord(session, 'role', by.tenant, [already.id], {
      ...already,
      rights: Object.freeze(withAll(already.rights, added)),
      seededWith: shipped,
    });
  });

  return ok(Object.freeze(seeded));
}

export function defineRole(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  input: NewRole,
): Outcome<Role> {
  const permitted = guard(session, by, declared, SEC_PERMISSIONS.role.create);
  if (permitted !== null) return err(permitted);

  const name = named(input.name);
  if (name === null) return refuse('sec.role-name-required');

  const rights = input.rights ?? [];
  const wrong = grantable(session, by, declared, rights);
  if (wrong !== null) return err(wrong);

  const role: Role = {
    id: newId<'role'>(),
    tenant: by.tenant,
    seeded: null,
    name,
    rights: Object.freeze([...rights]),
    seededWith: Object.freeze([]),
    active: true,
  };
  return ok(writeRecord(session, 'role', by.tenant, [role.id], role));
}

function revised(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: RoleId,
  right: PermissionId,
): Outcome<Role> {
  const permitted = guard(session, by, declared, right);
  if (permitted !== null) return err(permitted);

  const role = roleIn(session, by.tenant, id);
  if (role === null) return refuse('sec.role-not-found', { role: id });
  return ok(role);
}

export function renameRole(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: RoleId,
  name: string,
): Outcome<Role> {
  const found = revised(session, by, declared, id, SEC_PERMISSIONS.role.edit);
  if (!found.ok) return found;

  const trimmed = named(name);
  if (trimmed === null) return refuse('sec.role-name-required');

  return ok(writeRecord(session, 'role', by.tenant, [id], { ...found.value, name: trimmed }));
}

export function grantRights(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: RoleId,
  rights: readonly PermissionId[],
): Outcome<Role> {
  const found = revised(session, by, declared, id, SEC_PERMISSIONS.role.edit);
  if (!found.ok) return found;
  if (!found.value.active) return refuse('sec.role-withdrawn', { role: id });

  const wrong = grantable(session, by, declared, rights);
  if (wrong !== null) return err(wrong);

  return ok(
    writeRecord(session, 'role', by.tenant, [id], {
      ...found.value,
      rights: Object.freeze(withAll(found.value.rights, rights)),
    }),
  );
}

/**
 * Taking a right out needs only the right to edit the role.
 *
 * Deliberately not symmetrical with granting. Requiring somebody to hold a
 * right before they may remove it would mean an administrator who cannot do a
 * thing also cannot stop somebody else doing it — and the moment that matters
 * is the one where a right has to come off a role quickly.
 *
 * Two things are still asked. The caller must outrank the people in the role
 * (`outranksHolders`), and the last tenant-wide holding of a right may not be
 * the one removed (`strandedBy`): a right nobody holds tenant-wide is a right
 * nobody can ever grant again.
 */
export function revokeRights(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: RoleId,
  rights: readonly PermissionId[],
): Outcome<Role> {
  const found = revised(session, by, declared, id, SEC_PERMISSIONS.role.edit);
  if (!found.ok) return found;

  const outranked = outranksHolders(session, by, found.value);
  if (outranked !== null) return err(outranked);

  const stranded = strandedBy(session, by.tenant, { kind: 'role', role: id }, rights);
  if (stranded !== null) return err(strandingRefusal(stranded, { role: id }));

  return ok(
    writeRecord(session, 'role', by.tenant, [id], {
      ...found.value,
      rights: Object.freeze(without(found.value.rights, rights)),
    }),
  );
}

export function setRoleActive(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: RoleId,
  active: boolean,
): Outcome<Role> {
  const found = revised(session, by, declared, id, SEC_PERMISSIONS.role.withdraw);
  if (!found.ok) return found;

  if (!active) {
    const outranked = outranksHolders(session, by, found.value);
    if (outranked !== null) return err(outranked);

    const stranded = strandedBy(session, by.tenant, { kind: 'role', role: id });
    if (stranded !== null) return err(strandingRefusal(stranded, { role: id }));
  } else if (!found.value.active) {
    // Restoring a role switches every right in it back on for everybody still
    // assigned to it, which is granting those rights by another door. It was
    // guarded by the right to withdraw roles alone, so an administrator still
    // assigned to a withdrawn role could restore it and take back what the owner
    // had withdrawn it to remove.
    const wrong = grantable(session, by, declared, found.value.rights);
    if (wrong !== null) return err(wrong);
  }

  // Idempotent: `SYN-02` replays a command that may already have been applied,
  // and a second withdrawal that refused would turn a sync that worked into a
  // sync that failed over a state that is already what was asked for.
  return ok(writeRecord(session, 'role', by.tenant, [id], { ...found.value, active }));
}
