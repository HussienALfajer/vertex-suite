import { isErr, isOk, orThrow, type Refusal, type Result } from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import { SYS_PERMISSIONS, type Branch, type Company } from './contract.js';
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
