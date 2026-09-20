import { permissionId, STANDARD_ACTIONS } from '@vertex/contracts';
import { SYS_PERMISSIONS } from '@vertex/sys/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { SEC_PERMISSIONS, TENANT_WIDE, type Role } from './contract.js';
import {
  aShopWithAnOwner,
  installSec,
  refusalOf,
  taken,
  type Installed,
} from './edition.fixture.js';

let sec: Installed;

beforeEach(() => {
  sec = installSec();
});

async function seeded(who: ReturnType<Installed['as']>, role: string): Promise<Role> {
  const found = (await sec.directory.roles(who)).find((one) => one.seeded === role);
  if (found === undefined) throw new Error(`No ${role} role.`);
  return found;
}

describe('Action-level permissions — SEC-02', () => {
  it('lets a role hold the view of a thing without the editing of it', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const clerk = taken(
      await sec.admin.roles.define(owner, {
        name: 'clerk',
        rights: [SYS_PERMISSIONS.branch.view],
      }),
    );

    const user = await sec.hire('person-1');
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: clerk.id,
        confinement: TENANT_WIDE,
      }),
    );

    const them = sec.as(user);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.branch.view)).toBe(true);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.branch.edit)).toBe(false);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.branch.create)).toBe(false);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.branch.withdraw)).toBe(false);
  });

  it('separates the actions of one resource from the same actions of another', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const keeper = taken(
      await sec.admin.roles.define(owner, {
        name: 'keeper',
        rights: [SYS_PERMISSIONS.location.edit, SYS_PERMISSIONS.branch.view],
      }),
    );

    const user = await sec.hire('person-2');
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: keeper.id,
        confinement: TENANT_WIDE,
      }),
    );

    const them = sec.as(user);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.location.edit)).toBe(true);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.branch.edit)).toBe(false);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.location.view)).toBe(false);
  });

  it('refuses a right no module declared, so a tick in the role editor never does nothing', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const role = await seeded(owner, 'cashier');

    // Well-formed, one of the five actions, and nobody's: SYS declares no
    // approval over a branch. Granting it would put a line in the role editor
    // that an administrator ticks and that changes nothing anywhere.
    const nobodys = permissionId('sys', 'branch', 'approve');
    expect(STANDARD_ACTIONS).toContain('approve');
    expect(refusalOf(await sec.admin.roles.grant(owner, role.id, [nobodys]))).toBe(
      'sec.right-undeclared',
    );

    const decision = await sec.auth.decide(owner, nobodys);
    expect(decision).toEqual({ granted: false, grounds: 'no-such-right' });
  });

  it('declares no right over an assignment that no command asks for', () => {
    // An assignment is granted and withdrawn, never revised in place: giving
    // somebody a role they already hold replaces its reach, and that is judged
    // as both a withdrawal and a grant. `sec.role-assignment.edit` was declared
    // beside those two and asked by nothing — a tick in the role editor that
    // read as protection and was none.
    const declared = sec.registry.permissions.map((one) => one.id);
    expect(declared).toContain(SEC_PERMISSIONS.assignment.create);
    expect(declared).toContain(SEC_PERMISSIONS.assignment.withdraw);
    expect(declared).not.toContain(permissionId('sec', 'role-assignment', 'edit'));
  });

  it('grants nothing at all to somebody in no role', async () => {
    await aShopWithAnOwner(sec);
    const stranger = sec.as(await sec.hire('person-3'));

    expect(await sec.auth.may(stranger, SYS_PERMISSIONS.branch.view)).toBe(false);
    expect(await sec.auth.decide(stranger, SYS_PERMISSIONS.branch.view)).toEqual({
      granted: false,
      grounds: 'no-actor-rights',
    });
  });

  it('permits the system itself, and says that is what happened', async () => {
    // A migration, a scheduled revaluation, a sync applying a sale somebody
    // else authorised on a register. Refusing these would leave a store node
    // unable to apply the work of a shop that was offline; SEC-06 needs the
    // difference recorded rather than hidden, which is what the grounds are for.
    const decision = await sec.auth.decide(sec.system, SYS_PERMISSIONS.company.create);
    expect(decision).toEqual({ granted: true, grounds: 'system' });
  });

  it('stops granting the moment the assignment is withdrawn', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const role = await seeded(owner, 'floor-supervisor');

    const user = await sec.hire('person-4');
    taken(
      await sec.admin.assignments.assign(owner, { user, role: role.id, confinement: TENANT_WIDE }),
    );
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.branch.view)).toBe(true);

    taken(await sec.admin.assignments.withdraw(owner, user, role.id));
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.branch.view)).toBe(false);

    // The record of having held it stays, which is the whole reason withdrawing
    // is not deleting.
    expect(await sec.directory.assignmentsOf(owner, user)).toEqual([]);
    expect(await sec.directory.assignmentsOf(owner, user, { including: 'all' })).toEqual([
      expect.objectContaining({ role: role.id, active: false }),
    ]);
  });

  it('refuses to put into a role a right the administrator does not hold', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const manager = await seeded(owner, 'manager');

    // A manager who may design roles is still a manager. Without this, the
    // right to edit a role is the right to become the owner: grant yourself
    // everything, then assign it to yourself.
    taken(await sec.admin.roles.grant(owner, manager.id, [SEC_PERMISSIONS.role.edit]));
    const user = await sec.hire('person-5');
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: manager.id,
        confinement: TENANT_WIDE,
      }),
    );

    const them = sec.as(user);
    expect(await sec.auth.may(them, SEC_PERMISSIONS.role.edit)).toBe(true);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.company.create)).toBe(false);

    expect(
      refusalOf(await sec.admin.roles.grant(them, manager.id, [SYS_PERMISSIONS.company.create])),
    ).toBe('sec.right-not-held');

    // And what they do hold, they may hand on.
    taken(await sec.admin.roles.grant(them, manager.id, [SYS_PERMISSIONS.location.view]));
  });

  it('refuses the commands of this module to anybody not permitted to run them', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const cashierRole = await seeded(owner, 'cashier');

    const user = await sec.hire('person-6');
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: cashierRole.id,
        confinement: TENANT_WIDE,
      }),
    );

    const cashier = sec.as(user);
    expect(refusalOf(await sec.admin.roles.define(cashier, { name: 'anything' }))).toBe(
      'sec.not-permitted',
    );
    expect(
      refusalOf(
        await sec.admin.roles.grant(cashier, cashierRole.id, [SYS_PERMISSIONS.branch.create]),
      ),
    ).toBe('sec.not-permitted');
    expect(
      refusalOf(
        await sec.admin.assignments.assign(cashier, {
          user: await sec.hire('person-7'),
          role: cashierRole.id,
          confinement: TENANT_WIDE,
        }),
      ),
    ).toBe('sec.not-permitted');
  });

  it('refuses a command whose refusal leaves the store exactly as it was', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const before = new Map(sec.store.committed());

    expect(refusalOf(await sec.admin.roles.define(owner, { name: '' }))).toBe(
      'sec.role-name-required',
    );

    // Checks before writes, everywhere: a refusal is a returned value, so the
    // transaction it was refused in still commits, and a command that had
    // already written something would leave it behind.
    expect(new Map(sec.store.committed())).toEqual(before);
  });
});
