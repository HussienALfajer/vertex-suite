import { isErr, isOk, newId, orThrow, type Id, type Refusal, type Result } from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TIME_ZONE, SYS_PERMISSIONS, type Branch, type Company } from './contract.js';
import { installSys, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  return orThrow(result, (refusal) => new Error(`refused: ${refusal.code}`));
}

function refusalOf<T>(result: Result<T, Refusal>): string {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error.code;
}

let sys: Installed;

beforeEach(() => {
  sys = installSys();
});

async function aCompany(): Promise<Company> {
  return taken(await sys.admin.companies.register(sys.by, { name: 'Vertex Retail' }));
}

async function aBranch(): Promise<Branch> {
  const company = await aCompany();
  return taken(await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }));
}

describe('Organisation structure — SYS-09', () => {
  it('adds a branch, a location and a register with no vendor involvement and no code change', async () => {
    // Nothing exists at install. Whatever appears below appeared because an
    // administrator asked for it at run time, not because the edition was
    // rebuilt with it in — which is the whole of the acceptance criterion.
    expect(await sys.read.branches(sys.by)).toEqual([]);
    const before = sys.registry.migrationPlan('store-node');

    const company = await aCompany();
    const branch = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }),
    );
    const location = taken(
      await sys.admin.locations.open(sys.by, {
        branch: branch.id,
        name: 'Shop floor',
        kind: 'shop-floor',
      }),
    );
    const register = taken(
      await sys.admin.registers.open(sys.by, { branch: branch.id, name: 'Till 1', prefix: 'AL1' }),
    );

    expect((await sys.read.branch(sys.by, branch.id))?.name).toBe('Aleppo');
    expect(await sys.read.locations(sys.by, branch.id)).toEqual([location]);
    expect(await sys.read.registers(sys.by, branch.id)).toEqual([register]);

    // No schema moved and no module was redefined: the same installation that
    // knew nothing about Aleppo a moment ago is serving it now.
    expect(sys.registry.migrationPlan('store-node')).toEqual(before);
  });

  it('grants the right to do it to the tenant, so no vendor account is involved', () => {
    // The administrator's authority is an ordinary tenant permission that SEC-01
    // can seed into a role. There is no other door into these commands — no
    // licence flag, no vendor actor, no build-time list of branches.
    const declared = sys.registry.permissions.map((one) => one.id);
    expect(declared).toContain(SYS_PERMISSIONS.branch.create);
    expect(declared).toContain(SYS_PERMISSIONS.location.create);
    expect(declared).toContain(SYS_PERMISSIONS.register.create);
    expect(declared.every((id) => id.startsWith('sys.'))).toBe(true);
  });

  it('keeps a deactivated location resolvable and reportable, with its record intact', async () => {
    const branch = await aBranch();
    const location = taken(
      await sys.admin.locations.open(sys.by, {
        branch: branch.id,
        name: 'Store room',
        kind: 'store-room',
      }),
    );
    const committedWhileActive = sys.store.committed().size;

    const withdrawn = taken(await sys.admin.locations.deactivate(sys.by, location.id));
    expect(withdrawn.active).toBe(false);

    // Still there, and still itself: every movement ever recorded against it
    // names this id, and a report that cannot resolve the id prints a blank.
    expect(await sys.read.location(sys.by, location.id)).toEqual(withdrawn);
    expect(await sys.read.locations(sys.by, branch.id, { including: 'all' })).toEqual([withdrawn]);
    expect(await sys.read.locations(sys.by, branch.id)).toEqual([]);
    expect(sys.store.committed().size).toBe(committedWhileActive);
  });

  it('asks whether the caller may, and refuses the command rather than running it', async () => {
    const company = await aCompany();

    // Somebody who holds nothing. Every command below declares a right, and
    // before this guard existed every one of them ran for whoever called it:
    // the rights were on the role editor and on nothing else.
    sys.answers(() => false);

    const refused = await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' });
    expect(refusalOf(refused)).toBe('sys.not-permitted');
    // The right is named in the refusal, so a screen can say which one is
    // missing rather than showing a failure it cannot explain.
    expect(refused.ok ? null : refused.error.values['right']).toBe(SYS_PERMISSIONS.branch.create);

    // Refused rather than half-done: the guard runs before the transaction, so
    // there is nothing written for a later reader to find.
    sys.answers(() => true);
    expect(await sys.read.branches(sys.by)).toEqual([]);
  });

  it('guards every command it offers, with the right it declares and the place it acts in', async () => {
    // One command's guard was tested and the rest were trusted. Removing any of
    // them, or asking for the wrong right, failed nothing. So every command is
    // run by somebody who holds nothing, and what each one asked is recorded.
    const company = await aCompany();
    const branch = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }),
    );
    const location = taken(
      await sys.admin.locations.open(sys.by, {
        branch: branch.id,
        name: 'Store room',
        kind: 'store-room',
      }),
    );
    const register = taken(
      await sys.admin.registers.open(sys.by, { branch: branch.id, name: 'Till', prefix: 'AL1' }),
    );
    const here = { branch: branch.id };
    const inLocation = { branch: branch.id, location: location.id };
    const point = { lat: '36.2', lng: '37.1' };
    const scope = {
      documentType: 'pur.invoice',
      branch: branch.id,
      register: null,
      fiscalYear: '2026',
    };

    const { company: c, branch: b, location: l, register: r } = SYS_PERMISSIONS;
    const commands: readonly [
      string,
      () => Promise<Result<unknown, Refusal>>,
      string,
      object | undefined,
    ][] = [
      [
        'companies.register',
        () => sys.admin.companies.register(sys.by, { name: 'X' }),
        c.create,
        undefined,
      ],
      [
        'companies.rename',
        () => sys.admin.companies.rename(sys.by, company.id, 'X'),
        c.edit,
        undefined,
      ],
      [
        'companies.deactivate',
        () => sys.admin.companies.deactivate(sys.by, company.id),
        c.withdraw,
        undefined,
      ],
      [
        'companies.reactivate',
        () => sys.admin.companies.reactivate(sys.by, company.id),
        c.withdraw,
        undefined,
      ],
      [
        'branches.open',
        () => sys.admin.branches.open(sys.by, { company: company.id, name: 'X' }),
        b.create,
        undefined,
      ],
      ['branches.rename', () => sys.admin.branches.rename(sys.by, branch.id, 'X'), b.edit, here],
      [
        'branches.readdress',
        () => sys.admin.branches.readdress(sys.by, branch.id, 'X'),
        b.edit,
        here,
      ],
      ['branches.locate', () => sys.admin.branches.locate(sys.by, branch.id, point), b.edit, here],
      [
        'branches.rezone',
        () => sys.admin.branches.rezone(sys.by, branch.id, 'Europe/Istanbul'),
        b.rezone,
        here,
      ],
      [
        'branches.deactivate',
        () => sys.admin.branches.deactivate(sys.by, branch.id),
        b.withdraw,
        here,
      ],
      [
        'branches.reactivate',
        () => sys.admin.branches.reactivate(sys.by, branch.id),
        b.withdraw,
        here,
      ],
      [
        'locations.open',
        () =>
          sys.admin.locations.open(sys.by, { branch: branch.id, name: 'X', kind: 'shop-floor' }),
        l.create,
        here,
      ],
      [
        'locations.rename',
        () => sys.admin.locations.rename(sys.by, location.id, 'X'),
        l.edit,
        inLocation,
      ],
      [
        'locations.readdress',
        () => sys.admin.locations.readdress(sys.by, location.id, 'X'),
        l.edit,
        inLocation,
      ],
      [
        'locations.locate',
        () => sys.admin.locations.locate(sys.by, location.id, point),
        l.edit,
        inLocation,
      ],
      [
        'locations.deactivate',
        () => sys.admin.locations.deactivate(sys.by, location.id),
        l.withdraw,
        inLocation,
      ],
      [
        'locations.reactivate',
        () => sys.admin.locations.reactivate(sys.by, location.id),
        l.withdraw,
        inLocation,
      ],
      [
        'registers.open',
        () => sys.admin.registers.open(sys.by, { branch: branch.id, name: 'X', prefix: 'X1' }),
        r.create,
        here,
      ],
      [
        'registers.rename',
        () => sys.admin.registers.rename(sys.by, register.id, 'X'),
        r.edit,
        here,
      ],
      [
        'registers.deactivate',
        () => sys.admin.registers.deactivate(sys.by, register.id),
        r.withdraw,
        here,
      ],
      [
        'registers.reactivate',
        () => sys.admin.registers.reactivate(sys.by, register.id),
        r.withdraw,
        here,
      ],
      [
        'registers.assignDevice',
        () => sys.admin.registers.assignDevice(sys.by, register.id, newId<'device'>()),
        r.edit,
        here,
      ],
      [
        'profile.revise',
        () => sys.admin.profile.revise(sys.by, company.id, { phone: '0' }),
        SYS_PERMISSIONS.businessProfile.edit,
        undefined,
      ],
      [
        'numbering.define',
        () => sys.admin.numbering.define(sys.by, scope, '{year}-{sequence}'),
        SYS_PERMISSIONS.numberingSeries.edit,
        here,
      ],
      [
        'settings.forBranch',
        () => sys.admin.settings.forBranch(sys.by, branch.id, 'k', 'v'),
        SYS_PERMISSIONS.branchSetting.edit,
        here,
      ],
      [
        'settings.forTenant',
        () => sys.admin.settings.forTenant(sys.by, 'k', 'v'),
        SYS_PERMISSIONS.branchSetting.edit,
        undefined,
      ],
    ];

    for (const [name, run, right, where] of commands) {
      const asked: { right: string; where: object | undefined }[] = [];
      sys.answers((_by, one, place) => {
        asked.push({ right: one, where: place });
        return false;
      });
      const refused = await run();
      expect(refusalOf(refused), name).toBe('sys.not-permitted');
      expect(asked, name).toEqual([{ right, where }]);
    }
  });

  it('refuses a location or a till below a live branch of a company taken out of use', async () => {
    // Opening a branch under a withdrawn company was refused; one level further
    // down, the company's shops went on growing.
    const company = await aCompany();
    const branch = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }),
    );
    taken(await sys.admin.companies.deactivate(sys.by, company.id));

    expect(
      refusalOf(
        await sys.admin.locations.open(sys.by, {
          branch: branch.id,
          name: 'Room',
          kind: 'store-room',
        }),
      ),
    ).toBe('sys.company-inactive');
    expect(
      refusalOf(
        await sys.admin.registers.open(sys.by, { branch: branch.id, name: 'Till', prefix: 'AL1' }),
      ),
    ).toBe('sys.company-inactive');
  });

  it('will not put a location or a till back into use below a live branch of a withdrawn company', async () => {
    // Opening one there is refused above; putting one back is the same growth
    // by another door, and it was the door left open.
    const company = await aCompany();
    const branch = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }),
    );
    const location = taken(
      await sys.admin.locations.open(sys.by, {
        branch: branch.id,
        name: 'Room',
        kind: 'store-room',
      }),
    );
    const register = taken(
      await sys.admin.registers.open(sys.by, { branch: branch.id, name: 'Till', prefix: 'AL1' }),
    );
    taken(await sys.admin.locations.deactivate(sys.by, location.id));
    taken(await sys.admin.registers.deactivate(sys.by, register.id));
    taken(await sys.admin.companies.deactivate(sys.by, company.id));

    expect(refusalOf(await sys.admin.locations.reactivate(sys.by, location.id))).toBe(
      'sys.company-inactive',
    );
    expect(refusalOf(await sys.admin.registers.reactivate(sys.by, register.id))).toBe(
      'sys.company-inactive',
    );

    // Nothing moved: both are exactly as withdrawn as they were.
    expect((await sys.read.location(sys.by, location.id))?.active).toBe(false);
    expect((await sys.read.register(sys.by, register.id))?.active).toBe(false);

    // And the company coming back is what lets them come back.
    taken(await sys.admin.companies.reactivate(sys.by, company.id));
    expect(taken(await sys.admin.locations.reactivate(sys.by, location.id)).active).toBe(true);
    expect(taken(await sys.admin.registers.reactivate(sys.by, register.id)).active).toBe(true);
  });

  it('refuses a stock location of a kind it does not know', async () => {
    // A kind arrives from outside, where the type does not reach, and a van
    // spelled differently got round the rule that a van has no fixed place.
    const branch = taken(
      await sys.admin.branches.open(sys.by, { company: (await aCompany()).id, name: 'Aleppo' }),
    );
    const refused = await sys.admin.locations.open(sys.by, {
      branch: branch.id,
      name: 'Van',
      kind: 'Vehicle' as 'vehicle',
      point: { lat: '36.2', lng: '37.1' },
    });
    expect(refusalOf(refused)).toBe('sys.location-kind-unknown');
  });

  it('judges the caller against the branch the thing is actually in', async () => {
    const company = await aCompany();
    const aleppo = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }),
    );
    const homs = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Homs' }),
    );
    const inHoms = taken(
      await sys.admin.locations.open(sys.by, {
        branch: homs.id,
        name: 'Store room',
        kind: 'store-room',
      }),
    );

    // A manager of Aleppo and of nowhere else (`SEC-04`). The place has to
    // reach the decision for that to mean anything — a guard that asked
    // without saying where would give them Homs as well.
    sys.answers((_by, _right, where) => where?.branch === aleppo.id);

    expect(
      refusalOf(
        await sys.admin.locations.open(sys.by, {
          branch: homs.id,
          name: 'Second room',
          kind: 'store-room',
        }),
      ),
    ).toBe('sys.not-permitted');
    expect(refusalOf(await sys.admin.locations.rename(sys.by, inHoms.id, 'Cellar'))).toBe(
      'sys.not-permitted',
    );

    taken(
      await sys.admin.locations.open(sys.by, {
        branch: aleppo.id,
        name: 'Shop floor',
        kind: 'shop-floor',
      }),
    );
    expect(await sys.read.locations(sys.by, aleppo.id)).toHaveLength(1);
    expect((await sys.read.location(sys.by, inHoms.id))?.name).toBe('Store room');
  });

  it('lets the system act, because a migration and a sync have nobody to be', async () => {
    // No actor is not a weaker caller, it is no caller: `POS-19` has a store
    // node take up the trading of a shop that was offline, and the register
    // that did the work is where it was authorised.
    sys.answers(() => false);

    const company = taken(await sys.admin.companies.register(sys.system, { name: 'Vertex' }));
    expect(company.name).toBe('Vertex');
  });

  it('refuses two of anything under one name in the list a person reads', async () => {
    const company = await aCompany();
    const aleppo = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'الفرع الرئيسي' }),
    );

    // The same name again, and the same name with the spacing a second typist
    // would use: a picker showing it twice is a transfer sent to the wrong shop.
    expect(
      refusalOf(
        await sys.admin.branches.open(sys.by, { company: company.id, name: '  الفرع الرئيسي  ' }),
      ),
    ).toBe('sys.name-taken');
    expect(refusalOf(await sys.admin.companies.register(sys.by, { name: 'vertex retail' }))).toBe(
      'sys.name-taken',
    );

    const homs = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Homs' }),
    );
    expect(refusalOf(await sys.admin.branches.rename(sys.by, homs.id, 'الفرع الرئيسي'))).toBe(
      'sys.name-taken',
    );
    // Renaming something to the name it already has is not a collision with
    // itself, and `SYN-02` replays commands, so it has to stay possible.
    taken(await sys.admin.branches.rename(sys.by, aleppo.id, 'الفرع الرئيسي'));

    // Locations are told apart within their own branch, so one name may be used
    // once in each — two branches both have a store room, and always will.
    taken(
      await sys.admin.locations.open(sys.by, {
        branch: aleppo.id,
        name: 'المستودع',
        kind: 'store-room',
      }),
    );
    taken(
      await sys.admin.locations.open(sys.by, {
        branch: homs.id,
        name: 'المستودع',
        kind: 'store-room',
      }),
    );
    expect(
      refusalOf(
        await sys.admin.locations.open(sys.by, {
          branch: homs.id,
          name: 'المستودع',
          kind: 'shop-floor',
        }),
      ),
    ).toBe('sys.name-taken');
  });

  it('reads two names as one when nothing on screen tells them apart', async () => {
    // A right-to-left mark, a zero-width joiner, a tatweel, a doubled or a
    // non-breaking space: all invisible, all common in pasted Arabic.
    const company = await aCompany();
    taken(await sys.admin.branches.open(sys.by, { company: company.id, name: 'الفرع الرئيسي' }));

    for (const lookalike of [
      'الفرع الرئيسي\u200f',
      'الفرع\u200c الرئيسي',
      'الفـرع الرئيسي',
      'الفرع  الرئيسي',
      'الفرع\u00a0الرئيسي',
    ]) {
      expect(
        refusalOf(await sys.admin.branches.open(sys.by, { company: company.id, name: lookalike })),
        JSON.stringify(lookalike),
      ).toBe('sys.name-taken');
    }
  });

  it('frees a name when the thing carrying it closes, and defends it on the way back', async () => {
    const company = await aCompany();
    const first = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }),
    );

    // A closed shop keeps its name on every document it ever issued, but the
    // name is not spent: refusing it years later would be this module deciding
    // something `SYS-09` never said.
    taken(await sys.admin.branches.deactivate(sys.by, first.id));
    taken(await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }));

    // And reopening the old one would put two live shops under one name without
    // anybody typing it, which is the one outcome this rule is about.
    expect(refusalOf(await sys.admin.branches.reactivate(sys.by, first.id))).toBe('sys.name-taken');
  });

  it('offers no way to delete a structural entity', () => {
    const forbidden = ['delete', 'remove', 'destroy', 'purge', 'drop'];
    for (const group of [
      sys.admin.companies,
      sys.admin.branches,
      sys.admin.locations,
      sys.admin.registers,
    ]) {
      const offered = Object.keys(group);
      expect(offered).toContain('deactivate');
      for (const name of forbidden) expect(offered).not.toContain(name);
    }
  });

  it('refuses a location under a branch that has been taken out of use', async () => {
    const branch = await aBranch();
    taken(await sys.admin.branches.deactivate(sys.by, branch.id));

    const refused = await sys.admin.locations.open(sys.by, {
      branch: branch.id,
      name: 'Store room',
      kind: 'store-room',
    });
    expect(refusalOf(refused)).toBe('sys.branch-inactive');
  });

  it('refuses a second register carrying a prefix another register already has', async () => {
    const branch = await aBranch();
    taken(await sys.admin.registers.open(sys.by, { branch: branch.id, name: '1', prefix: 'AL1' }));

    // SYS-02: the prefix is part of every number the register issues, so two
    // registers sharing one would file two different sales under one number.
    const refused = await sys.admin.registers.open(sys.by, {
      branch: branch.id,
      name: '2',
      prefix: 'AL1',
    });
    expect(refusalOf(refused)).toBe('sys.register-prefix-taken');
  });

  it('refuses a machine identifier this system could not have issued', async () => {
    const branch = await aBranch();
    const register = taken(
      await sys.admin.registers.open(sys.by, { branch: branch.id, name: '1', prefix: 'AL1' }),
    );

    // The brand on `DeviceId` is a compile-time claim and nothing at run time,
    // and the value always comes from outside: typed by an administrator
    // pairing a till, or carried in a command `SYN-02` replayed. A machine
    // stored under an identity it will never report for itself would look new
    // on every reconnection, and each of those spends a generation that cannot
    // be given back (`SYS-02`).
    for (const claimed of ['till-one', '', '550e8400-e29b-41d4-a716-446655440000']) {
      expect(
        refusalOf(
          await sys.admin.registers.assignDevice(sys.by, register.id, claimed as Id<'device'>),
        ),
      ).toBe('sys.device-identifier-invalid');
    }

    const untouched = await sys.read.register(sys.by, register.id);
    expect(untouched?.generation).toBe(0);
    expect(untouched?.heldBy).toBeNull();

    // The same machine written in upper case is the same machine: a UUID is
    // case-insensitive by specification, so naming it twice must not cost a
    // second generation.
    const device = newId<'device'>();
    expect(
      taken(await sys.admin.registers.assignDevice(sys.by, register.id, device)).generation,
    ).toBe(1);
    const again = taken(
      await sys.admin.registers.assignDevice(
        sys.by,
        register.id,
        device.toUpperCase() as Id<'device'>,
      ),
    );
    expect(again.generation).toBe(1);
  });

  it('refuses a prefix that punctuation could make ambiguous in a printed number', async () => {
    const branch = await aBranch();

    expect(
      refusalOf(
        await sys.admin.registers.open(sys.by, { branch: branch.id, name: '1', prefix: 'AL/1' }),
      ),
    ).toBe('sys.register-prefix-invalid');
  });

  it('refuses a branch under a company that has been taken out of use', async () => {
    const company = await aCompany();
    taken(await sys.admin.companies.deactivate(sys.by, company.id));

    expect(
      refusalOf(await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' })),
    ).toBe('sys.company-inactive');
  });

  it('will not put a location back into use while its branch is out of use', async () => {
    const branch = await aBranch();
    const location = taken(
      await sys.admin.locations.open(sys.by, {
        branch: branch.id,
        name: 'Shop floor',
        kind: 'shop-floor',
      }),
    );
    taken(await sys.admin.locations.deactivate(sys.by, location.id));
    taken(await sys.admin.branches.deactivate(sys.by, branch.id));

    // Deactivation does not cascade, so the two states are independent — but
    // restoring a location into a branch that is shut would leave a place stock
    // could be booked to in a shop that is not trading.
    expect(refusalOf(await sys.admin.locations.reactivate(sys.by, location.id))).toBe(
      'sys.branch-inactive',
    );
  });

  it('writes nothing when a command refuses', async () => {
    const branch = await aBranch();
    const before = new Map(sys.store.committed());

    expect(
      isErr(
        await sys.admin.locations.open(sys.by, {
          branch: branch.id,
          name: '  ',
          kind: 'shop-floor',
        }),
      ),
    ).toBe(true);

    expect(sys.store.committed()).toEqual(before);
  });

  it('treats a repeated deactivation as already done, so a replayed command cannot fail', async () => {
    const branch = await aBranch();

    const first = taken(await sys.admin.branches.deactivate(sys.by, branch.id));
    // SYN-02 replays a command that may already have been applied. A refusal
    // here would turn a successful sync into a failed one.
    const again = taken(await sys.admin.branches.deactivate(sys.by, branch.id));

    expect(again).toEqual(first);
    expect(again.active).toBe(false);
  });

  it('puts back what it took out of use, without the vendor', async () => {
    const branch = await aBranch();
    taken(await sys.admin.branches.deactivate(sys.by, branch.id));

    expect(taken(await sys.admin.branches.reactivate(sys.by, branch.id)).active).toBe(true);
    expect(await sys.read.branches(sys.by)).toHaveLength(1);
  });

  it('never shows one tenant the structure of another', async () => {
    const branch = await aBranch();

    expect(await sys.read.branch(sys.byOther, branch.id)).toBeNull();
    expect(await sys.read.branches(sys.byOther)).toEqual([]);
    expect(refusalOf(await sys.admin.branches.rename(sys.byOther, branch.id, 'Theirs'))).toBe(
      'sys.branch-not-found',
    );
  });

  it('carries a setting per branch, falling back to the tenant value', async () => {
    const branch = await aBranch();

    expect(await sys.read.setting(sys.by, branch.id, 'sys.branch.address')).toBeNull();

    taken(await sys.admin.settings.forTenant(sys.by, 'sys.branch.address', 'Head office'));
    expect(await sys.read.setting(sys.by, branch.id, 'sys.branch.address')).toBe('Head office');

    taken(await sys.admin.settings.forBranch(sys.by, branch.id, 'sys.branch.address', 'Aleppo'));
    expect(await sys.read.setting(sys.by, branch.id, 'sys.branch.address')).toBe('Aleppo');

    // Clearing the override returns the branch to the tenant's value rather
    // than to nothing, and does so without deleting a row.
    taken(await sys.admin.settings.forBranch(sys.by, branch.id, 'sys.branch.address', null));
    expect(await sys.read.setting(sys.by, branch.id, 'sys.branch.address')).toBe('Head office');
  });
});

describe('A branch keeps the time zone its days are counted in — SYS-09', () => {
  it('opens a branch in the zone it is given, spelt the one way the runtime spells it', async () => {
    const company = await aCompany();

    const istanbul = taken(
      await sys.admin.branches.open(sys.by, {
        company: company.id,
        name: 'Gaziantep',
        timeZone: 'europe/istanbul',
      }),
    );

    expect(istanbul.timeZone).toBe('Europe/Istanbul');
    expect((await sys.read.branch(sys.by, istanbul.id))?.timeZone).toBe('Europe/Istanbul');
  });

  it('opens a branch nobody gave a zone to in the default one, so no branch is ever without a day', async () => {
    const branch = await aBranch();

    expect(branch.timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  it('refuses a zone it does not know, when opening and when rezoning, and writes nothing', async () => {
    const company = await aCompany();
    const branch = taken(
      await sys.admin.branches.open(sys.by, { company: company.id, name: 'Aleppo' }),
    );
    const before = new Map(sys.store.committed());

    for (const timeZone of ['Mars/Olympus', '', ' Asia/Damascus', 'GMT+3 Syria']) {
      const opened = await sys.admin.branches.open(sys.by, {
        company: company.id,
        name: 'Homs',
        timeZone,
      });
      expect(refusalOf(opened), JSON.stringify(timeZone)).toBe('sys.time-zone-unknown');
      expect(opened.ok ? null : opened.error.values).toEqual({ timeZone });
      expect(refusalOf(await sys.admin.branches.rezone(sys.by, branch.id, timeZone))).toBe(
        'sys.time-zone-unknown',
      );
    }

    expect(sys.store.committed()).toEqual(before);
  });

  it('rezones a branch without touching anything else about it', async () => {
    const branch = await aBranch();

    const rezoned = taken(await sys.admin.branches.rezone(sys.by, branch.id, 'Europe/Istanbul'));

    expect(rezoned).toEqual({ ...branch, timeZone: 'Europe/Istanbul' });
    expect(await sys.read.branch(sys.by, branch.id)).toEqual(rezoned);
  });

  it('rezones a withdrawn branch, as it readdresses one', async () => {
    const branch = await aBranch();
    taken(await sys.admin.branches.deactivate(sys.by, branch.id));

    const rezoned = taken(await sys.admin.branches.rezone(sys.by, branch.id, 'UTC'));

    expect(rezoned).toMatchObject({ timeZone: 'UTC', active: false });
  });

  it('keeps the zone behind a right of its own, which nobody but the owner is seeded', () => {
    // A branch's zone decides which day it is trading on, and every "today" in
    // the product is a branch's today. Under `branch.edit` it travelled with
    // renaming and readdressing — so the manager seeded to run a shop could
    // move the shop's calendar, and `FX-04`'s "two rates per day for that
    // branch" became two rates for whichever day the manager chose.
    const declared = sys.registry.permissions;

    expect(SYS_PERMISSIONS.branch.rezone).not.toBe(SYS_PERMISSIONS.branch.edit);
    expect(declared.find((one) => one.id === SYS_PERMISSIONS.branch.rezone)?.seededFor).toEqual([]);
    // The right it was split out of still reaches the manager: this took the
    // calendar away from them and left them the shop.
    expect(declared.find((one) => one.id === SYS_PERMISSIONS.branch.edit)?.seededFor).toContain(
      'manager',
    );
  });

  it('refuses a rezone to somebody who may edit the branch but not its zone', async () => {
    const branch = await aBranch();
    // A branch manager exactly as `SEC-01` seeds one: everything over this
    // branch except the one right that was split out.
    sys.answers((_by, right) => right !== SYS_PERMISSIONS.branch.rezone);

    const refused = await sys.admin.branches.rezone(sys.by, branch.id, 'Europe/Istanbul');

    expect(refusalOf(refused)).toBe('sys.not-permitted');
    expect(refused.ok ? null : refused.error.values['right']).toBe(SYS_PERMISSIONS.branch.rezone);
    expect((await sys.read.branch(sys.by, branch.id))?.timeZone).toBe(DEFAULT_TIME_ZONE);
    // Renaming it is still theirs, which is what says the split is a split and
    // not a lock on the branch.
    expect(taken(await sys.admin.branches.rename(sys.by, branch.id, 'Homs')).name).toBe('Homs');
  });

  it('refuses to rezone a branch of another tenant', async () => {
    const branch = await aBranch();

    expect(refusalOf(await sys.admin.branches.rezone(sys.byOther, branch.id, 'UTC'))).toBe(
      'sys.branch-not-found',
    );
    expect((await sys.read.branch(sys.by, branch.id))?.timeZone).toBe(DEFAULT_TIME_ZONE);
  });
});
