import type { BranchId, LocationId, PermissionId, UserId } from '@vertex/contracts';
import { newId } from '@vertex/kernel';
import { SYS_PERMISSIONS } from '@vertex/sys/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { SEC_PERMISSIONS, TENANT_WIDE, type Confinement, type RoleId } from './contract.js';
import {
  aShopWithAnOwner,
  installSec,
  refusalOf,
  taken,
  type Installed,
} from './edition.fixture.js';

let sec: Installed;
let owner: ReturnType<Installed['as']>;
let aleppo: BranchId;
let homs: BranchId;
let shopFloor: LocationId;
let storeRoom: LocationId;

beforeEach(async () => {
  sec = installSec();
  owner = sec.as(await aShopWithAnOwner(sec));

  aleppo = sec.openBranch('Aleppo');
  homs = sec.openBranch('Homs');
  shopFloor = sec.openLocation(aleppo, 'Shop floor');
  storeRoom = sec.openLocation(aleppo, 'Store room', 'store-room');
});

/** A role holding exactly these rights, and a user in it over this ground. */
async function someoneHolding(
  rights: readonly PermissionId[],
  confinement: Confinement,
  name = 'role',
): Promise<{ user: UserId; role: RoleId }> {
  const role = taken(await sec.admin.roles.define(owner, { name, rights }));
  const user = await sec.hire(name);
  taken(await sec.admin.assignments.assign(owner, { user, role: role.id, confinement }));
  return { user, role: role.id };
}

describe('Location- and branch-scoped permissions — SEC-04', () => {
  it('limits a right to the branches the assignment names', async () => {
    const { user } = await someoneHolding([SYS_PERMISSIONS.branch.edit], {
      kind: 'branches',
      branches: [aleppo],
      locations: [],
    });
    const them = sec.as(user);

    expect(await sec.auth.may(them, SYS_PERMISSIONS.branch.edit, { branch: aleppo })).toBe(true);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.branch.edit, { branch: homs })).toBe(false);
    expect(await sec.auth.decide(them, SYS_PERMISSIONS.branch.edit, { branch: homs })).toEqual({
      granted: false,
      grounds: 'outside-confinement',
    });
  });

  it('refuses an action that has no place to anybody who is confined to one', async () => {
    const { user } = await someoneHolding([SYS_PERMISSIONS.businessProfile.edit], {
      kind: 'branches',
      branches: [aleppo],
      locations: [],
    });

    // Asking without a place is not asking about anywhere. The business profile
    // of SYS-05 belongs to the company and prints on every receipt in the
    // group, so somebody who runs one shop does not revise it — and the other
    // reading of an absent branch is exactly how they would.
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.businessProfile.edit)).toBe(false);
    expect(await sec.auth.may(owner, SYS_PERMISSIONS.businessProfile.edit)).toBe(true);
  });

  it('narrows to a location within a branch, and reaches a location opened later when none is named', async () => {
    const narrowed = await someoneHolding(
      [SYS_PERMISSIONS.location.edit],
      { kind: 'branches', branches: [aleppo], locations: [storeRoom] },
      'store keeper',
    );
    const keeper = sec.as(narrowed.user);

    expect(
      await sec.auth.may(keeper, SYS_PERMISSIONS.location.edit, {
        branch: aleppo,
        location: storeRoom,
      }),
    ).toBe(true);
    expect(
      await sec.auth.may(keeper, SYS_PERMISSIONS.location.edit, {
        branch: aleppo,
        location: shopFloor,
      }),
    ).toBe(false);

    const wide = await someoneHolding(
      [SYS_PERMISSIONS.location.edit],
      { kind: 'branches', branches: [aleppo], locations: [] },
      'branch keeper',
    );
    const vanOpenedLater = sec.openLocation(aleppo, 'Van', 'vehicle');

    // Naming no location means every location of the branch, including one
    // opened this afternoon. The alternative locks a keeper out of the store
    // room somebody added an hour ago, in the middle of a delivery, with
    // nothing on the screen connecting the two.
    expect(
      await sec.auth.may(sec.as(wide.user), SYS_PERMISSIONS.location.edit, {
        branch: aleppo,
        location: vanOpenedLater,
      }),
    ).toBe(true);
  });

  it('keeps a manager in one branch from managing the branch they only stand at a till in', async () => {
    const user = await sec.hire('person-2');
    const manager = taken(
      await sec.admin.roles.define(owner, {
        name: 'branch manager',
        rights: [SYS_PERMISSIONS.branch.edit, SYS_PERMISSIONS.register.edit],
      }),
    );
    const cashier = taken(
      await sec.admin.roles.define(owner, {
        name: 'till',
        rights: [SYS_PERMISSIONS.register.view],
      }),
    );

    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: manager.id,
        confinement: { kind: 'branches', branches: [aleppo], locations: [] },
      }),
    );
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: cashier.id,
        confinement: { kind: 'branches', branches: [homs], locations: [] },
      }),
    );

    const them = sec.as(user);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.register.edit, { branch: aleppo })).toBe(true);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.register.view, { branch: homs })).toBe(true);

    // The confinement belongs to the assignment and not to the person. One
    // confinement per user would make this shop choose between a supervisor who
    // cannot serve a customer in Homs and one who reconfigures its tills.
    expect(await sec.auth.may(them, SYS_PERMISSIONS.register.edit, { branch: homs })).toBe(false);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.register.view, { branch: aleppo })).toBe(false);
  });

  it('gathers the reach of one right across every role the user is in', async () => {
    const user = await sec.hire('person-3');
    const viewer = taken(
      await sec.admin.roles.define(owner, {
        name: 'viewer',
        rights: [SYS_PERMISSIONS.branch.view],
      }),
    );
    for (const branch of [aleppo, homs]) {
      taken(
        await sec.admin.assignments.assign(owner, {
          user,
          role: viewer.id,
          confinement: { kind: 'branches', branches: [branch], locations: [] },
        }),
      );
    }

    // Assigning the same role again replaces that assignment's confinement
    // rather than adding a second — SYN-02 replays commands, and two rows for
    // one grant would leave a withdrawal that withdraws half of it.
    expect(await sec.directory.assignmentsOf(owner, user)).toHaveLength(1);
    expect(await sec.auth.reachOf(sec.as(user), SYS_PERMISSIONS.branch.view)).toEqual([
      { kind: 'branches', branches: [homs], locations: [] },
    ]);

    const alsoInAleppo = taken(
      await sec.admin.roles.define(owner, {
        name: 'second viewer',
        rights: [SYS_PERMISSIONS.branch.view],
      }),
    );
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: alsoInAleppo.id,
        confinement: { kind: 'branches', branches: [aleppo], locations: [] },
      }),
    );

    // One grant per role rather than one merged answer: a person who works
    // everywhere in one branch and in a single store room of another has no
    // single pair of lists that says so, and merging them claims a reach the
    // decision itself refuses.
    const reach = await sec.auth.reachOf(sec.as(user), SYS_PERMISSIONS.branch.view);
    expect(
      reach.flatMap((one) => (one.kind === 'branches' ? [...one.branches] : [])).sort(),
    ).toEqual([aleppo, homs].sort());
    expect(await sec.auth.reachOf(owner, SYS_PERMISSIONS.branch.view)).toEqual([TENANT_WIDE]);
  });

  it('does not lift a narrowing in one branch onto another branch entirely', async () => {
    const user = await sec.hire('person-4');
    const right = SYS_PERMISSIONS.location.edit;
    const inTheStoreRoom = taken(
      await sec.admin.roles.define(owner, { name: 'store keeper', rights: [right] }),
    );
    const allOfHoms = taken(
      await sec.admin.roles.define(owner, { name: 'homs keeper', rights: [right] }),
    );

    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: inTheStoreRoom.id,
        confinement: { kind: 'branches', branches: [aleppo], locations: [storeRoom] },
      }),
    );
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: allOfHoms.id,
        confinement: { kind: 'branches', branches: [homs], locations: [] },
      }),
    );

    const them = sec.as(user);
    expect(await sec.auth.may(them, right, { branch: aleppo, location: storeRoom })).toBe(true);
    expect(await sec.auth.may(them, right, { branch: aleppo, location: shopFloor })).toBe(false);

    // What they may hand on has to agree with what they may do. The staffing
    // right is given tenant-wide on purpose, so that nothing but the merged
    // reach of `right` itself can be what refuses: merged into one pair of
    // lists it reads "both branches, no narrowing", and this assignment —
    // Aleppo's shop floor, where they may not work — goes through.
    const staffing = taken(
      await sec.admin.roles.define(owner, {
        name: 'staffing',
        rights: [SEC_PERMISSIONS.assignment.create],
      }),
    );
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: staffing.id,
        confinement: TENANT_WIDE,
      }),
    );
    const till = taken(await sec.admin.roles.define(owner, { name: 'till', rights: [right] }));
    expect(
      refusalOf(
        await sec.admin.assignments.assign(them, {
          user: await sec.hire('person-5'),
          role: till.id,
          confinement: { kind: 'branches', branches: [aleppo], locations: [shopFloor] },
        }),
      ),
    ).toBe('sec.right-not-held');
  });

  it('keeps what a confinement names, not the list the caller passed in', async () => {
    const role = taken(
      await sec.admin.roles.define(owner, { name: 'r', rights: [SYS_PERMISSIONS.branch.view] }),
    );
    const user = await sec.hire('person-6');
    const branches = [aleppo];
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: role.id,
        confinement: { kind: 'branches', branches, locations: [] },
      }),
    );

    // The store keeps what it is given, and what it was given here came from a
    // caller who still holds it. Widening a committed grant must take a command.
    branches.push(homs);
    expect(await sec.auth.may(sec.as(user), SYS_PERMISSIONS.branch.view, { branch: homs })).toBe(
      false,
    );
  });

  it('refuses a confinement that names nowhere, or somewhere that is not there', async () => {
    const role = taken(
      await sec.admin.roles.define(owner, { name: 'r', rights: [SYS_PERMISSIONS.branch.view] }),
    );
    const candidate = await sec.hire('person-7');
    const assign = (confinement: Confinement) =>
      sec.admin.assignments.assign(owner, { user: candidate, role: role.id, confinement });

    expect(refusalOf(await assign({ kind: 'branches', branches: [], locations: [] }))).toBe(
      'sec.confinement-empty',
    );

    // A branch of another tenant is not a branch: the lookup is made in the
    // caller's tenant, so the identifier simply is not there.
    const theirBranch = sec.openBranch('Latakia', sec.otherTenant);
    expect(
      refusalOf(await assign({ kind: 'branches', branches: [theirBranch], locations: [] })),
    ).toBe('sec.branch-not-found');

    expect(
      refusalOf(await assign({ kind: 'branches', branches: [homs], locations: [shopFloor] })),
    ).toBe('sec.location-outside-confinement');

    expect(
      refusalOf(
        await assign({ kind: 'branches', branches: [aleppo], locations: [newId<'location'>()] }),
      ),
    ).toBe('sec.location-not-found');

    // A branch that has been shut is a mistake rather than a plan: `SYS` does
    // not cascade deactivation, so an assignment made into one would sit there
    // looking deliberate until somebody reopened the shop.
    sec.shutBranch(homs);
    expect(refusalOf(await assign({ kind: 'branches', branches: [homs], locations: [] }))).toBe(
      'sec.branch-inactive',
    );
  });

  it('refuses an assignment that reaches further than the administrator making it', async () => {
    const staffer = taken(
      await sec.admin.roles.define(owner, {
        name: 'branch staffer',
        rights: [
          SEC_PERMISSIONS.assignment.create,
          SEC_PERMISSIONS.assignment.withdraw,
          SYS_PERMISSIONS.register.view,
        ],
      }),
    );
    const user = await sec.hire('person-8');
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: staffer.id,
        confinement: { kind: 'branches', branches: [aleppo], locations: [] },
      }),
    );

    const them = sec.as(user);
    const till = taken(
      await sec.admin.roles.define(owner, {
        name: 'till',
        rights: [SYS_PERMISSIONS.register.view],
      }),
    );

    // Their own shop: ordinary work.
    taken(
      await sec.admin.assignments.assign(them, {
        user: await sec.hire('person-9'),
        role: till.id,
        confinement: { kind: 'branches', branches: [aleppo], locations: [] },
      }),
    );

    // The group, and the shop next door: not theirs to give.
    expect(
      refusalOf(
        await sec.admin.assignments.assign(them, {
          user: await sec.hire('person-10'),
          role: till.id,
          confinement: TENANT_WIDE,
        }),
      ),
    ).toBe('sec.confinement-exceeds-own');
    expect(
      refusalOf(
        await sec.admin.assignments.assign(them, {
          user: await sec.hire('person-11'),
          role: till.id,
          confinement: { kind: 'branches', branches: [homs], locations: [] },
        }),
      ),
    ).toBe('sec.confinement-exceeds-own');
  });

  it('refuses to hand on a right the administrator holds only in their own branch', async () => {
    const staffer = taken(
      await sec.admin.roles.define(owner, {
        name: 'branch staffer',
        rights: [SEC_PERMISSIONS.assignment.create, SYS_PERMISSIONS.register.view],
      }),
    );
    const user = await sec.hire('person-12');
    taken(
      await sec.admin.assignments.assign(owner, {
        user,
        role: staffer.id,
        confinement: { kind: 'branches', branches: [aleppo], locations: [] },
      }),
    );

    const richer = taken(
      await sec.admin.roles.define(owner, {
        name: 'richer',
        rights: [SYS_PERMISSIONS.register.view, SYS_PERMISSIONS.branch.edit],
      }),
    );

    // They may staff Aleppo, and the role they are handing out holds a right
    // they do not have anywhere. Checked right by right rather than as a whole,
    // because a role is a set and it takes one member to escalate.
    expect(
      refusalOf(
        await sec.admin.assignments.assign(sec.as(user), {
          user: await sec.hire('person-13'),
          role: richer.id,
          confinement: { kind: 'branches', branches: [aleppo], locations: [] },
        }),
      ),
    ).toBe('sec.right-not-held');
  });
});
