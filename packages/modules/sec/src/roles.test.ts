import { SEEDED_ROLES, permissionId, type PermissionId } from '@vertex/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { SYS_PERMISSIONS } from '@vertex/sys/contract';

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

function seededAs(roles: readonly Role[], seeded: string): Role {
  const role = roles.find((one) => one.seeded === seeded);
  if (role === undefined) throw new Error(`Seeding produced no ${seeded}.`);
  return role;
}

describe('Seven seeded roles — SEC-01', () => {
  it('seeds the seven the feature names, and seeds them once', async () => {
    const seeded = taken(await sec.admin.roles.seed(sec.system));

    expect(seeded.map((role) => role.seeded)).toEqual([...SEEDED_ROLES]);

    // Seeding again is not a second set. A first run that was interrupted, and
    // a command SYN-02 replays, both arrive here.
    taken(await sec.admin.roles.seed(sec.system));
    const roles = await sec.directory.roles(sec.system);
    expect(roles).toHaveLength(SEEDED_ROLES.length);
  });

  it('gives the owner every right the edition declares, without any module naming the owner', async () => {
    const seeded = taken(await sec.admin.roles.seed(sec.system));
    const owner = seededAs(seeded, 'owner');

    const declared = sec.registry.permissions.map((one) => one.id as PermissionId);
    expect([...owner.rights].sort()).toEqual([...declared].sort());

    // The point of computing it: SEC has never heard of a business profile or a
    // numbering series, and the owner holds both.
    expect(owner.rights).toContain(SYS_PERMISSIONS.businessProfile.edit);
    expect(owner.rights).toContain(SYS_PERMISSIONS.numberingSeries.edit);
  });

  it('seeds the rest from what each module said its own rights are for', async () => {
    const seeded = taken(await sec.admin.roles.seed(sec.system));
    const cashier = seededAs(seeded, 'cashier');
    const accountant = seededAs(seeded, 'accountant');

    // A cashier prints receipts, so they read the profile SYS-05 puts on one —
    // and they do not open a branch.
    expect(cashier.rights).toContain(SYS_PERMISSIONS.businessProfile.view);
    expect(cashier.rights).toContain(SYS_PERMISSIONS.register.view);
    expect(cashier.rights).not.toContain(SYS_PERMISSIONS.businessProfile.edit);
    expect(cashier.rights).not.toContain(SYS_PERMISSIONS.branch.create);

    // The series format is what an inspector reads a year later.
    expect(accountant.rights).toContain(SYS_PERMISSIONS.numberingSeries.edit);
    expect(accountant.rights).not.toContain(SYS_PERMISSIONS.register.create);
  });

  it('is fully editable, and a second seeding does not undo the editing', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const cashier = seededAs(await sec.directory.roles(owner), 'cashier');

    taken(await sec.admin.roles.rename(owner, cashier.id, 'أمين صندوق'));
    taken(await sec.admin.roles.grant(owner, cashier.id, [SYS_PERMISSIONS.location.view]));
    taken(await sec.admin.roles.revoke(owner, cashier.id, [SYS_PERMISSIONS.register.view]));

    // The shipped defaults are a starting point and never an argument: seeding
    // again must not re-impose what a shop deliberately changed.
    taken(await sec.admin.roles.seed(sec.system));

    // Read back by identifier rather than by looking for a cashier: a seeding
    // that quietly made a second one would leave the edited role findable and
    // the shop with two.
    expect(await sec.directory.roles(owner)).toHaveLength(SEEDED_ROLES.length);
    const edited = await sec.directory.role(owner, cashier.id);
    expect(edited).not.toBeNull();
    if (edited === null) return;
    expect(edited.name).toBe('أمين صندوق');
    expect(edited.rights).toContain(SYS_PERMISSIONS.location.view);
    expect(edited.rights).not.toContain(SYS_PERMISSIONS.register.view);
  });

  it('is extensible: a shop adds a role of its own, named in its own words', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));

    const nightManager = taken(
      await sec.admin.roles.define(owner, {
        name: 'مناوبة ليلية',
        rights: [SYS_PERMISSIONS.register.view, SYS_PERMISSIONS.location.view],
      }),
    );

    expect(nightManager.seeded).toBeNull();
    expect(nightManager.name).toBe('مناوبة ليلية');

    const user = sec.someone();
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: nightManager.id,
        confinement: TENANT_WIDE,
      }),
    );
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.register.view)).toBe(true);
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.register.edit)).toBe(false);
  });

  it('withdraws a role rather than deleting it, and the rights go with it', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const cashier = seededAs(await sec.directory.roles(owner), 'cashier');

    const user = sec.someone();
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: cashier.id,
        confinement: TENANT_WIDE,
      }),
    );
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.register.view)).toBe(true);

    taken(await sec.admin.roles.withdraw(owner, cashier.id));
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.register.view)).toBe(false);

    // Withdrawn and still there: SEC-06 asks a year from now what this person
    // held on the day of a particular sale, and a removed row answers nothing.
    expect(await sec.directory.roles(owner)).not.toContainEqual(
      expect.objectContaining({ id: cashier.id }),
    );
    expect(await sec.directory.roles(owner, { including: 'all' })).toContainEqual(
      expect.objectContaining({ id: cashier.id, active: false }),
    );

    taken(await sec.admin.roles.restore(owner, cashier.id));
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.register.view)).toBe(true);
  });

  it('refuses to withdraw the last owner, because nobody but the vendor could put it back', async () => {
    const only = await aShopWithAnOwner(sec);
    const owner = sec.as(only);
    const role = seededAs(await sec.directory.roles(owner), 'owner');

    expect(refusalOf(await sec.admin.roles.withdraw(owner, role.id))).toBe('sec.last-owner');
    expect(refusalOf(await sec.admin.assignments.withdraw(owner, only, role.id))).toBe(
      'sec.last-owner',
    );

    // With a second owner in place there is no lock-out to prevent, and the
    // first one may be stood down like anybody else.
    const second = sec.someone();
    taken(
      await sec.admin.assignments.assign(owner, {
        user: second,
        role: role.id,
        confinement: TENANT_WIDE,
      }),
    );
    taken(await sec.admin.assignments.withdraw(owner, only, role.id));
    expect(await sec.auth.may(owner, SYS_PERMISSIONS.branch.create)).toBe(false);
    expect(await sec.auth.may(sec.as(second), SYS_PERMISSIONS.branch.create)).toBe(true);
  });

  it('keeps one tenant roles out of another tenant reach', async () => {
    taken(await sec.admin.roles.seed(sec.system));
    taken(await sec.admin.roles.seed(sec.otherSystem));

    const ours = await sec.directory.roles(sec.system);
    const theirs = await sec.directory.roles(sec.otherSystem);

    expect(ours).toHaveLength(SEEDED_ROLES.length);
    expect(theirs).toHaveLength(SEEDED_ROLES.length);
    expect(ours.map((role) => role.id)).not.toEqual(
      expect.arrayContaining(theirs.map((role) => role.id)),
    );
    expect(await sec.directory.role(sec.otherSystem, seededAs(ours, 'owner').id)).toBeNull();
  });

  it('refuses a role with no name, since a role nobody can read is a role nobody can grant', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));

    expect(refusalOf(await sec.admin.roles.define(owner, { name: '   ' }))).toBe(
      'sec.role-name-required',
    );
    const cashier = seededAs(await sec.directory.roles(owner), 'cashier');
    expect(refusalOf(await sec.admin.roles.rename(owner, cashier.id, ''))).toBe(
      'sec.role-name-required',
    );
  });

  it('refuses to seed a role a right nobody declared, whatever the grammar says', async () => {
    const owner = sec.as(await aShopWithAnOwner(sec));
    const invented = permissionId('sys', 'branch', 'approve');

    expect(refusalOf(await sec.admin.roles.define(owner, { name: 'x', rights: [invented] }))).toBe(
      'sec.right-undeclared',
    );
    expect(sec.registry.permissions.map((one) => one.id)).toContain(SEC_PERMISSIONS.role.edit);
  });
});
