import type { BranchId, UserId } from '@vertex/contracts';
import { instant, manualClock } from '@vertex/kernel';
import { SYS_PERMISSIONS } from '@vertex/sys/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { SEC_PERMISSIONS, TENANT_WIDE, type Confinement, type Role } from './contract.js';
import {
  aSecondShopWithAnOwner,
  aShopWithAnOwner,
  installSec,
  refusalOf,
  taken,
  type Installed,
} from './edition.fixture.js';

/**
 * The ways round the rules, each one taken and each one refused.
 *
 * Every test here began as a sequence of ordinary, individually permitted
 * commands that ended with somebody holding what nobody gave them, or with a
 * shop that could no longer administer itself. They are written as that
 * sequence rather than as the one guard that now stops it, because the guard is
 * not the claim — the claim is that the sequence no longer arrives, whichever
 * step a future change happens to loosen.
 */

let sec: Installed;
let owner: ReturnType<Installed['as']>;
let theOwner: UserId;
let aleppo: BranchId;

const inAleppo = (): Confinement => ({ kind: 'branches', branches: [aleppo], locations: [] });

async function seeded(role: string): Promise<Role> {
  const found = (await sec.directory.roles(owner)).find((one) => one.seeded === role);
  if (found === undefined) throw new Error(`No ${role} role.`);
  return found;
}

async function hiredInto(handle: string, role: Role, confinement: Confinement): Promise<UserId> {
  const user = await sec.hire(handle);
  taken(await sec.admin.assignments.assign(owner, { user, role: role.id, confinement }));
  return user;
}

beforeEach(async () => {
  sec = installSec();
  theOwner = await aShopWithAnOwner(sec);
  owner = sec.as(theOwner);
  aleppo = sec.openBranch('Aleppo');
});

describe('Staffing cannot be turned into ownership — SEC-04, SEC-09', () => {
  it('refuses to narrow an assignment its caller could not have withdrawn', async () => {
    // An administrator of Aleppo may not stand down a tenant-wide cashier, and
    // re-assigning the cashier to Aleppo is the same act by another name.
    const cashier = await seeded('cashier');
    const manager = await seeded('manager');
    const staffer = sec.as(await hiredInto('aleppo-manager', manager, inAleppo()));
    const till = await hiredInto('cashier', cashier, TENANT_WIDE);

    expect(refusalOf(await sec.admin.assignments.withdraw(staffer, till, cashier.id))).toBe(
      'sec.confinement-exceeds-own',
    );
    expect(
      refusalOf(
        await sec.admin.assignments.assign(staffer, {
          user: till,
          role: cashier.id,
          confinement: inAleppo(),
        }),
      ),
    ).toBe('sec.confinement-exceeds-own');
  });

  it('refuses an owner of one branch narrowing the real owner to that branch', async () => {
    // Afterwards nobody would hold role editing anywhere it can be used, and
    // the real owner could not put themselves back.
    const ownerRole = await seeded('owner');
    const branchOwner = sec.as(await hiredInto('aleppo-owner', ownerRole, inAleppo()));

    expect(
      refusalOf(
        await sec.admin.assignments.assign(branchOwner, {
          user: theOwner,
          role: ownerRole.id,
          confinement: inAleppo(),
        }),
      ),
    ).toBe('sec.confinement-exceeds-own');
    expect(await sec.auth.may(owner, SEC_PERMISSIONS.role.edit)).toBe(true);
  });

  it('refuses the last tenant-wide owner narrowing themselves out of the tenant', async () => {
    const ownerRole = await seeded('owner');
    expect(
      refusalOf(
        await sec.admin.assignments.assign(owner, {
          user: theOwner,
          role: ownerRole.id,
          confinement: inAleppo(),
        }),
      ),
    ).toBe('sec.last-owner');
  });

  it('refuses a manager withdrawing a co-owner, then resetting what is left', async () => {
    // With seeded rights alone: a manager may withdraw assignments and reset
    // passwords. Withdraw the co-owner's role, reset the password of an account
    // that now holds nothing, and wait for the owner to put the role back.
    const ownerRole = await seeded('owner');
    const manager = sec.as(await hiredInto('manager', await seeded('manager'), TENANT_WIDE));
    const coOwner = await hiredInto('co-owner', ownerRole, TENANT_WIDE);

    expect(refusalOf(await sec.admin.assignments.withdraw(manager, coOwner, ownerRole.id))).toBe(
      'sec.right-not-held',
    );

    // And if the owner withdraws it themselves, the account that appears to
    // hold nothing is still measured by what it could be given back.
    taken(await sec.admin.assignments.withdraw(owner, coOwner, ownerRole.id));
    expect(refusalOf(await sec.users.resetPassword(manager, coOwner, 'mine-now-thanks'))).toBe(
      'sec.right-not-held',
    );
  });

  it('measures a person by a withdrawn role as well as by a withdrawn assignment', async () => {
    const manager = sec.as(await hiredInto('manager', await seeded('manager'), TENANT_WIDE));
    const vault = taken(
      await sec.admin.roles.define(owner, {
        name: 'خزنة',
        rights: [SYS_PERMISSIONS.company.create],
      }),
    );
    const keeper = await hiredInto('keeper', vault, TENANT_WIDE);
    taken(await sec.admin.roles.withdraw(owner, vault.id));

    expect(refusalOf(await sec.users.resetPassword(manager, keeper, 'mine-now-thanks'))).toBe(
      'sec.right-not-held',
    );
  });

  it('refuses two owners withdrawing each other at the same moment', async () => {
    // Each withdrawal alone leaves somebody who can put the other back; both
    // together leave nobody. The second to commit decided on a state that no
    // longer holds, and is refused rather than written.
    const ownerRole = await seeded('owner');
    const coOwner = await hiredInto('co-owner', ownerRole, TENANT_WIDE);

    const outcomes = await Promise.allSettled([
      sec.admin.assignments.withdraw(owner, coOwner, ownerRole.id),
      sec.admin.assignments.withdraw(sec.as(coOwner), theOwner, ownerRole.id),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled' && one.value.ok)).toHaveLength(1);
    const standing = [
      await sec.auth.may(owner, SEC_PERMISSIONS.role.edit),
      await sec.auth.may(sec.as(coOwner), SEC_PERMISSIONS.role.edit),
    ];
    expect(standing.filter(Boolean)).toHaveLength(1);
  });

  it('refuses an assignment to somebody who does not work here', async () => {
    const stranger = sec.as(await sec.hireIn(sec.otherTenant, 'elsewhere')).actor;
    if (stranger === null) throw new Error('A hired person has an identifier.');
    expect(
      refusalOf(
        await sec.admin.assignments.assign(owner, {
          user: stranger,
          role: (await seeded('cashier')).id,
          confinement: TENANT_WIDE,
        }),
      ),
    ).toBe('sec.user-not-found');
  });
});

describe('Editing roles cannot strip the people who hold them — SEC-01, SEC-02', () => {
  it('refuses somebody trusted with role editing taking rights off the owner', async () => {
    // Afterwards the owner could neither take them back — granting needs them
    // held — nor put themselves into the editor's role.
    const ownerRole = await seeded('owner');
    const editor = taken(
      await sec.admin.roles.define(owner, { name: 'محرر', rights: [SEC_PERMISSIONS.role.edit] }),
    );
    const trusted = sec.as(await hiredInto('editor', editor, TENANT_WIDE));

    for (const right of [SEC_PERMISSIONS.role.edit, SYS_PERMISSIONS.company.create]) {
      expect(refusalOf(await sec.admin.roles.revoke(trusted, ownerRole.id, [right])), right).toBe(
        'sec.right-not-held',
      );
    }
    expect(await sec.auth.may(owner, SYS_PERMISSIONS.company.create)).toBe(true);
  });

  it('refuses the removal of the last tenant-wide holding of any right, not only role editing', async () => {
    // Alone in the shop, the owner unticks "assign roles" on their own role.
    // Nobody could ever grant it again, define a role with it, or staff anyone.
    const ownerRole = await seeded('owner');
    const revoked = await sec.admin.roles.revoke(owner, ownerRole.id, [
      SEC_PERMISSIONS.assignment.create,
    ]);
    expect(refusalOf(revoked)).toBe('sec.last-holder');
    if (!revoked.ok) {
      expect(revoked.error.values['right']).toBe(SEC_PERMISSIONS.assignment.create);
    }

    // Held tenant-wide by somebody else, it is an ordinary edit again.
    const deputy = taken(
      await sec.admin.roles.define(owner, {
        name: 'نائب',
        rights: [SEC_PERMISSIONS.assignment.create],
      }),
    );
    await hiredInto('deputy', deputy, TENANT_WIDE);
    taken(await sec.admin.roles.revoke(owner, ownerRole.id, [SEC_PERMISSIONS.assignment.create]));
  });

  it('does not count an owner confined to one branch as the way back', async () => {
    // Every role and user command is guarded tenant-wide, so a confined owner
    // can put nobody back — and was once counted as if they could.
    const ownerRole = await seeded('owner');
    await hiredInto('aleppo-owner', ownerRole, inAleppo());

    expect(refusalOf(await sec.admin.assignments.withdraw(owner, theOwner, ownerRole.id))).toBe(
      'sec.last-owner',
    );
    expect(refusalOf(await sec.users.deactivate(owner, theOwner))).toBe('sec.last-owner');
  });

  it('refuses restoring a role by somebody who does not hold what it grants', async () => {
    // The owner withdrew the role to take those rights away; an administrator
    // still assigned to it may not simply switch it back on.
    const vault = taken(
      await sec.admin.roles.define(owner, {
        name: 'خزنة',
        rights: [SYS_PERMISSIONS.company.create],
      }),
    );
    const restorer = taken(
      await sec.admin.roles.define(owner, {
        name: 'مُعيد',
        rights: [SEC_PERMISSIONS.role.withdraw],
      }),
    );
    const who = await hiredInto('restorer', restorer, TENANT_WIDE);
    taken(
      await sec.admin.assignments.assign(owner, {
        user: who,
        role: vault.id,
        confinement: TENANT_WIDE,
      }),
    );
    taken(await sec.admin.roles.withdraw(owner, vault.id));

    expect(refusalOf(await sec.admin.roles.restore(sec.as(who), vault.id))).toBe(
      'sec.right-not-held',
    );
    expect(await sec.auth.may(sec.as(who), SYS_PERMISSIONS.company.create)).toBe(false);
  });
});

describe('Passwords and recoveries — SEC-09', () => {
  it('refuses an administrator resetting their own password without the current one', async () => {
    expect(refusalOf(await sec.users.resetPassword(owner, theOwner, 'a-new-password-1'))).toBe(
      'sec.own-password',
    );
    expect(refusalOf(await sec.credentials.recovery.open(owner, theOwner))).toBe(
      'sec.own-password',
    );
  });

  it('voids the sessions of an account whose password an administrator reset', async () => {
    const cashier = await hiredInto('cashier', await seeded('cashier'), TENANT_WIDE);
    const reset = taken(await sec.users.resetPassword(owner, cashier, 'a-new-password-1'));
    expect(reset.sessionsVoidBefore).not.toBeNull();
  });

  it('refuses a recovery completed by somebody who could not have opened it', async () => {
    const theirOwner = await aSecondShopWithAnOwner(sec);
    const ownerRole = await seeded('owner');
    const coOwner = await hiredInto('co-owner', ownerRole, TENANT_WIDE);
    taken(
      await sec.users.admit(sec.otherSystem, { user: coOwner, handle: 'co-owner', name: 'شريك' }),
    );
    const manager = sec.as(await hiredInto('manager', await seeded('manager'), TENANT_WIDE));

    const recovery = taken(await sec.credentials.recovery.open(owner, coOwner));
    taken(await sec.credentials.recovery.approve(theirOwner, recovery.id));

    // The manager was refused opening and approving; completing chooses the password.
    expect(
      refusalOf(await sec.credentials.recovery.complete(manager, recovery.id, 'mine-now-thanks')),
    ).toBe('sec.right-not-held');
    taken(await sec.credentials.recovery.complete(owner, recovery.id, 'the-real-new-one'));
  });

  it('says a recovery is incomplete without saying how many shops are still to answer', async () => {
    await aSecondShopWithAnOwner(sec);
    const cashier = await hiredInto('cashier', await seeded('cashier'), TENANT_WIDE);
    taken(
      await sec.users.admit(sec.otherSystem, { user: cashier, handle: 'cashier', name: 'أحمد' }),
    );
    const recovery = taken(await sec.credentials.recovery.open(owner, cashier));

    const incomplete = await sec.credentials.recovery.complete(owner, recovery.id, 'forgot-it-1');
    expect(refusalOf(incomplete)).toBe('sec.recovery-incomplete');
    if (!incomplete.ok) expect(incomplete.error.values).toEqual({});
  });

  it('lets a recovery lapse rather than be completed on approvals given for somebody else', async () => {
    const clock = manualClock(instant(Date.UTC(2026, 8, 1)));
    sec = installSec({ clock });
    theOwner = await aShopWithAnOwner(sec);
    owner = sec.as(theOwner);
    const cashier = await hiredInto('cashier', await seeded('cashier'), TENANT_WIDE);

    const recovery = taken(await sec.credentials.recovery.open(owner, cashier));
    clock.advance(8 * 24 * 60 * 60 * 1000);
    expect(
      refusalOf(await sec.credentials.recovery.complete(owner, recovery.id, 'too-late-now-1')),
    ).toBe('sec.recovery-expired');
  });

  it('counts a password in characters as a person counts them, with a ceiling', async () => {
    // Eight UTF-16 units, four letters once composed.
    const composed = 'é'.repeat(4);
    expect(
      refusalOf(await sec.users.enrol(owner, { handle: 'a', name: 'a', password: composed })),
    ).toBe('sec.password-too-short');
    expect(
      refusalOf(
        await sec.users.enrol(owner, { handle: 'b', name: 'b', password: 'x'.repeat(1025) }),
      ),
    ).toBe('sec.password-too-long');
  });

  it('refuses a stored credential that asks for unbounded work, without doing the work', async () => {
    // One synced row could otherwise pin a thread for most of an hour per attempt.
    const cashier = await hiredInto('cashier', await seeded('cashier'), TENANT_WIDE);
    const salt = Buffer.alloc(16).toString('base64url');
    const key = Buffer.alloc(64).toString('base64url');
    await sec.ageCredential(cashier, `scrypt$32768$8$32766$${salt}$${key}`);

    expect(
      refusalOf(
        await sec.credentials.authenticate(sec.system, 'cashier', 'a-long-enough-password'),
      ),
    ).toBe('sec.password-wrong');
  });

  it('admits the same sign-in twice when a command is replayed', async () => {
    const cashier = await hiredInto('cashier', await seeded('cashier'), TENANT_WIDE);
    const admission = { user: cashier, handle: 'cashier', name: 'أحمد' };
    taken(await sec.users.admit(sec.otherSystem, admission));
    taken(await sec.users.admit(sec.otherSystem, admission));
  });
});
