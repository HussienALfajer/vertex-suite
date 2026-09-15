import type { BranchId, UserId } from '@vertex/contracts';
import { SYS_PERMISSIONS } from '@vertex/sys/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { SEC_PERMISSIONS, TENANT_WIDE, type Role } from './contract.js';
import {
  aSecondShopWithAnOwner,
  aShopWithAnOwner,
  installSec,
  refusalOf,
  taken,
  type Installed,
} from './edition.fixture.js';

let sec: Installed;
let owner: ReturnType<Installed['as']>;
let theOwner: UserId;

beforeEach(async () => {
  sec = installSec();
  theOwner = await aShopWithAnOwner(sec);
  owner = sec.as(theOwner);
});

async function seeded(role: string): Promise<Role> {
  const found = (await sec.directory.roles(owner)).find((one) => one.seeded === role);
  if (found === undefined) throw new Error(`No ${role} role.`);
  return found;
}

/** Somebody in the cashier role, over one branch, the way a shop hires one. */
async function aCashier(
  handle: string,
  password: string,
): Promise<{ user: UserId; branch: BranchId }> {
  const branch = sec.openBranch('Aleppo');
  const cashier = await seeded('cashier');
  const hired = taken(await sec.users.enrol(owner, { handle, name: 'أحمد', password }));
  taken(
    await sec.admin.assignments.assign(owner, {
      user: hired.id,
      role: cashier.id,
      confinement: { kind: 'branches', branches: [branch], locations: [] },
    }),
  );
  return { user: hired.id, branch };
}

describe('User management — SEC-09', () => {
  it('adds a cashier who is then working at a register, with no vendor and nothing asked of anywhere', async () => {
    // The acceptance criterion, in the order a shop does it. What it has to
    // show is an absence: no vendor actor, no licence, no second door, and
    // nothing in the whole sequence that could want a connection.
    const before = sec.registry.migrationPlan('store-node');
    const branch = sec.openBranch('Aleppo');
    const cashier = await seeded('cashier');

    const hired = taken(
      await sec.users.enrol(owner, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' }),
    );
    taken(
      await sec.admin.assignments.assign(owner, {
        user: hired.id,
        role: cashier.id,
        confinement: { kind: 'branches', branches: [branch], locations: [] },
      }),
    );

    // The register, at the start of a shift, with no connection to anything.
    const signedIn = taken(
      await sec.credentials.authenticate(sec.system, 'ahmad', 'till-morning-1'),
    );
    expect(signedIn.user).toBe(hired.id);
    expect(signedIn.tenant).toBe(sec.tenant);

    const them = sec.as(signedIn.user);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.register.view, { branch })).toBe(true);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.businessProfile.view, { branch })).toBe(true);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.register.edit, { branch })).toBe(false);

    // No schema moved and no module was added: the edition that had never heard
    // of this person an hour ago is the one serving them.
    expect(sec.registry.migrationPlan('store-node')).toEqual(before);
    expect(sec.registry.modules.map((one) => one.code)).toEqual(['SYS', 'SEC']);
  });

  it('accepts the handle however the keyboard composed it', async () => {
    taken(
      await sec.users.enrol(owner, {
        handle: ' Ahmad ',
        name: 'أحمد',
        password: 'till-morning-1',
      }),
    );

    // Trimmed, folded, and composed the same way on both sides. A cashier whose
    // name looks identical on two screens and matches on neither is a shift that
    // does not start, with nothing on the screen to explain it.
    expect(
      taken(await sec.credentials.authenticate(sec.system, 'ahmad', 'till-morning-1')).tenant,
    ).toBe(sec.tenant);
    expect(
      taken(await sec.credentials.authenticate(sec.system, 'AHMAD  ', 'till-morning-1')).user,
    ).toBeDefined();
  });

  it('deactivates rather than deletes, so old transactions stay attributable', async () => {
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');

    taken(await sec.users.deactivate(owner, cashier));

    // Gone from the list of people who work here, and still resolvable — which
    // is the whole of it: every sale they ever rang up names this identifier.
    expect(await sec.people.users(owner)).not.toContainEqual(
      expect.objectContaining({ id: cashier }),
    );
    const still = await sec.people.user(owner, cashier);
    expect(still).toEqual(expect.objectContaining({ id: cashier, name: 'أحمد', active: false }));

    taken(await sec.users.reactivate(owner, cashier));
    expect(await sec.people.user(owner, cashier)).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  it('takes every right away the moment somebody is stood down', async () => {
    const { user: cashier, branch } = await aCashier('ahmad', 'till-morning-1');
    const them = sec.as(cashier);
    expect(await sec.auth.may(them, SYS_PERMISSIONS.register.view, { branch })).toBe(true);

    taken(await sec.users.deactivate(owner, cashier));

    // A deactivation that left the rights behind would be a sacking that still
    // opens the till. The assignment is untouched and holds nothing.
    expect(await sec.auth.may(them, SYS_PERMISSIONS.register.view, { branch })).toBe(false);
    expect(await sec.directory.assignmentsOf(owner, cashier)).toHaveLength(1);

    // And they learn that they no longer work here only after proving it is
    // them: a sign-in screen that said so earlier would answer, for anybody
    // guessing, which names are real.
    expect(refusalOf(await sec.credentials.authenticate(sec.system, 'ahmad', 'wrong'))).toBe(
      'sec.password-wrong',
    );
    expect(
      refusalOf(await sec.credentials.authenticate(sec.system, 'ahmad', 'till-morning-1')),
    ).toBe('sec.user-inactive');
  });

  it('refuses a handle this shop already uses, and does not care what another shop uses', async () => {
    await aCashier('ahmad', 'till-morning-1');

    expect(
      refusalOf(
        await sec.users.enrol(owner, { handle: 'AHMAD', name: 'آخر', password: 'till-morning-2' }),
      ),
    ).toBe('sec.handle-taken');

    // Unique within the tenant and no further. A refusal that meant "taken
    // somewhere in the world" would answer, for anybody who can type, the
    // question of who works at the shop down the road.
    const theirs = await sec.hireIn(sec.otherTenant, 'ahmad');
    expect(theirs).not.toBe('');
  });

  it('refuses a password shorter than the floor, wherever it is set', async () => {
    expect(
      refusalOf(await sec.users.enrol(owner, { handle: 'short', name: 'x', password: 'abc' })),
    ).toBe('sec.password-too-short');

    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');
    expect(refusalOf(await sec.users.resetPassword(owner, cashier, 'abc'))).toBe(
      'sec.password-too-short',
    );
  });

  it('answers an unknown handle exactly as it answers a wrong password', async () => {
    await aCashier('ahmad', 'till-morning-1');

    // The same refusal for both, because the difference is a list of everybody
    // who works here, readable by anybody who can reach a till.
    expect(refusalOf(await sec.credentials.authenticate(sec.system, 'ahmad', 'wrong'))).toBe(
      'sec.password-wrong',
    );
    expect(refusalOf(await sec.credentials.authenticate(sec.system, 'nobody', 'wrong'))).toBe(
      'sec.password-wrong',
    );
    expect(
      refusalOf(await sec.credentials.authenticate(sec.system, 'ahmad', 'till-morning-2')),
    ).toBe('sec.password-wrong');
  });

  it('resets the password of a sign-in this shop alone relies on', async () => {
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');

    taken(await sec.users.resetPassword(owner, cashier, 'new-one-tomorrow'));

    expect(
      refusalOf(await sec.credentials.authenticate(sec.system, 'ahmad', 'till-morning-1')),
    ).toBe('sec.password-wrong');
    expect(
      taken(await sec.credentials.authenticate(sec.system, 'ahmad', 'new-one-tomorrow')).user,
    ).toBe(cashier);
  });

  it('refuses to reset the password of a sign-in another shop also relies on', async () => {
    const theirOwner = await aSecondShopWithAnOwner(sec);
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');

    // The same person, working two jobs. Sharing is composed where a deployment
    // is composed, and never from inside one of the tenants that benefits.
    taken(await sec.users.admit(sec.otherSystem, { user: cashier, handle: 'ahmad', name: 'أحمد' }));

    expect(refusalOf(await sec.users.resetPassword(owner, cashier, 'new-one-tomorrow'))).toBe(
      'sec.identity-shared',
    );
    expect(await sec.people.user(owner, cashier)).toEqual(
      expect.objectContaining({ shared: true }),
    );

    // Withdrawing them from **this** shop is still this shop's business, and
    // leaves the other one exactly as it was.
    taken(await sec.users.deactivate(owner, cashier));
    expect(await sec.people.user(theirOwner, cashier)).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(
      taken(await sec.credentials.authenticate(sec.otherSystem, 'ahmad', 'till-morning-1')).tenant,
    ).toBe(sec.otherTenant);
  });

  it('never tells one shop which other shop a sign-in belongs to', async () => {
    await aSecondShopWithAnOwner(sec);
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');
    taken(await sec.users.admit(sec.otherSystem, { user: cashier, handle: 'ahmad', name: 'أحمد' }));

    // That the answer to a reset is different is something an administrator has
    // to be told. Where else this person works is not theirs to know, and a
    // screen built to be helpful is exactly how it would leak.
    const seen = await sec.people.user(owner, cashier);
    expect(seen).not.toBeNull();
    expect(Object.keys(seen ?? {}).sort()).toEqual(
      ['active', 'handle', 'id', 'name', 'sessionsVoidBefore', 'shared', 'tenant'].sort(),
    );
    expect(JSON.stringify(seen)).not.toContain(sec.otherTenant);
  });

  it('lets somebody change their own password with the one they already have', async () => {
    const theirOwner = await aSecondShopWithAnOwner(sec);
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');
    taken(await sec.users.admit(sec.otherSystem, { user: cashier, handle: 'ahmad', name: 'أحمد' }));

    // The way a shared password is allowed to change, and it needs no right at
    // all: the subject of the command is the caller.
    expect(
      refusalOf(await sec.credentials.changeOwnPassword(sec.as(cashier), 'guessed', 'brand-new-1')),
    ).toBe('sec.password-wrong');
    taken(
      await sec.credentials.changeOwnPassword(sec.as(cashier), 'till-morning-1', 'brand-new-one'),
    );

    // One sign-in: it changed in both shops, because it was never two.
    expect(
      taken(await sec.credentials.authenticate(sec.system, 'ahmad', 'brand-new-one')).user,
    ).toBe(cashier);
    expect(
      taken(await sec.credentials.authenticate(sec.otherSystem, 'ahmad', 'brand-new-one')).tenant,
    ).toBe(sec.otherTenant);
    expect(theirOwner.tenant).toBe(sec.otherTenant);
  });

  it('changes a shared password only once every shop it belongs to has approved', async () => {
    const theirOwner = await aSecondShopWithAnOwner(sec);
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');
    taken(await sec.users.admit(sec.otherSystem, { user: cashier, handle: 'ahmad', name: 'أحمد' }));

    const recovery = taken(await sec.credentials.recovery.open(owner, cashier));
    expect(recovery.approvedBy).toEqual([sec.tenant]);

    // One shop asking is not enough, and neither is one shop asking twice.
    expect(
      refusalOf(await sec.credentials.recovery.complete(owner, recovery.id, 'forgotten-again')),
    ).toBe('sec.recovery-incomplete');

    taken(await sec.credentials.recovery.approve(theirOwner, recovery.id));
    taken(await sec.credentials.recovery.complete(owner, recovery.id, 'forgotten-again'));

    expect(
      taken(await sec.credentials.authenticate(sec.system, 'ahmad', 'forgotten-again')).user,
    ).toBe(cashier);

    // Settled once. A recovery that could be completed twice is a password that
    // can be set again by whoever kept the identifier.
    expect(
      refusalOf(await sec.credentials.recovery.complete(owner, recovery.id, 'third-attempt-x')),
    ).toBe('sec.recovery-settled');
  });

  it('refuses a shop that has never employed this person any say in their recovery', async () => {
    const theirOwner = await aSecondShopWithAnOwner(sec);
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');
    const recovery = taken(await sec.credentials.recovery.open(owner, cashier));

    // The sign-in is this tenant's alone. The other shop has nothing to weigh
    // and no standing to say yes, and an approval it could give would be an
    // approval anybody could arrange by opening a shop.
    expect(refusalOf(await sec.credentials.recovery.approve(theirOwner, recovery.id))).toBe(
      'sec.user-not-found',
    );
  });

  it('refuses to reset the password of somebody who holds more than the administrator does', async () => {
    const manager = await seeded('manager');
    taken(await sec.admin.roles.grant(owner, manager.id, [SEC_PERMISSIONS.user.resetPassword]));
    const who = await sec.hire('manager-person');
    taken(
      await sec.admin.assignments.assign(owner, {
        user: who,
        role: manager.id,
        confinement: TENANT_WIDE,
      }),
    );

    const theirs = sec.as(who);
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');
    // Their own shop's cashier: ordinary work.
    taken(await sec.users.resetPassword(theirs, cashier, 'new-one-tomorrow'));

    // The owner: resetting a password is signing in as that person, so this is
    // the same escalation as granting yourself the role, arrived at sideways.
    expect(refusalOf(await sec.users.resetPassword(theirs, theOwner, 'not-today-thanks'))).toBe(
      'sec.right-not-held',
    );

    // And not by standing them down first, either: a withdrawn account appears
    // to hold nothing, and putting it back is the other half of the trick.
    expect(refusalOf(await sec.users.deactivate(theirs, theOwner))).toBe('sec.right-not-held');
  });

  it('records a forced sign-out as a moment, and only in the shop that asked', async () => {
    const theirOwner = await aSecondShopWithAnOwner(sec);
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');
    taken(await sec.users.admit(sec.otherSystem, { user: cashier, handle: 'ahmad', name: 'أحمد' }));

    const stamped = taken(await sec.users.forceSignOut(owner, cashier));
    expect(stamped.sessionsVoidBefore).toBeTypeOf('number');

    // Nothing here can reach a register that is offline. What it can do is say
    // which sessions are over — and say it about this shop's tills only.
    expect(await sec.people.user(theirOwner, cashier)).toEqual(
      expect.objectContaining({ sessionsVoidBefore: null }),
    );
  });

  it('refuses a tenant administrator who tries to pull another shop sign-in into theirs', async () => {
    await aSecondShopWithAnOwner(sec);
    const theirs = await sec.hireIn(sec.otherTenant, 'their-cashier');

    // The attack the rest of this feature exists to prevent, arrived at from
    // the other side: attach somebody else's sign-in, give it a role, and wait
    // for them to use the password their own shop set.
    expect(
      refusalOf(await sec.users.admit(owner, { user: theirs, handle: 'ours', name: 'x' })),
    ).toBe('sec.not-permitted');
    expect(await sec.people.user(owner, theirs)).toBeNull();
  });

  it('refuses to stand down the last person who can put anybody back', async () => {
    // The same rule as the last owner's role and the last owner's assignment, at
    // the level of the person. A shop that has done this has no way back that
    // does not involve the vendor, which SEC-09 rules out in its own sentence.
    expect(refusalOf(await sec.users.deactivate(owner, theOwner))).toBe('sec.last-owner');

    const second = await sec.hire('second-owner');
    const ownerRole = await seeded('owner');
    taken(
      await sec.admin.assignments.assign(owner, {
        user: second,
        role: ownerRole.id,
        confinement: TENANT_WIDE,
      }),
    );
    taken(await sec.users.deactivate(owner, theOwner));
    expect(await sec.auth.may(sec.as(second), SYS_PERMISSIONS.company.create)).toBe(true);
  });

  it('refuses the commands of this module to anybody not permitted to run them', async () => {
    const { user: cashier } = await aCashier('ahmad', 'till-morning-1');
    const them = sec.as(cashier);

    expect(
      refusalOf(await sec.users.enrol(them, { handle: 'x', name: 'x', password: 'long-enough-1' })),
    ).toBe('sec.not-permitted');
    expect(refusalOf(await sec.users.resetPassword(them, cashier, 'long-enough-1'))).toBe(
      'sec.not-permitted',
    );
    expect(refusalOf(await sec.users.forceSignOut(them, cashier))).toBe('sec.not-permitted');
    expect(refusalOf(await sec.users.deactivate(them, cashier))).toBe('sec.not-permitted');
  });
});
