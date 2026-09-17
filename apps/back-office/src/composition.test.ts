import {
  Currencies,
  CurrencyAdministration,
  ExchangeRates,
  FX_PERMISSIONS,
  fxModule,
  RateAdministration,
  type RateQuote,
} from '@vertex/fx';
import { newId, orThrow, systemClock, type Refusal, type Result } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  systemContext,
  type MemorySession,
} from '@vertex/platform';
import {
  Authorisation,
  Credentials,
  RoleAdministration,
  secModule,
  SEC_PERMISSIONS,
  TENANT_WIDE,
  UserAdministration,
  type Role,
} from '@vertex/sec';
import { Organisation, OrganisationAdministration, sysModule, SYS_PERMISSIONS } from '@vertex/sys';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The real `SYS`, the real `SEC` and the real `FX`, in one edition.
 *
 * **Nothing else in this repository can run this test, and that is why it is
 * here.** `modules.md` §4 lets a module see another module's contract and
 * nothing more, so each module's own suite stands the others in — each proves
 * its half against an interface. An **app** is the one thing allowed to name
 * them all, which makes the first app the first place the halves have ever met.
 *
 * What it pins down is the wiring the screens are about to be built on: that
 * the edition composes, that `SEC` answers the authorisation the platform asks
 * on behalf of `SYS` and `FX`, that it seeds the rights they declare, and that
 * `SEC-04` confinement survives the trip across the boundary. It also pins the
 * one behaviour the browser stand-in of `dev-system.ts` reproduces — one refusal
 * for an unknown handle and for a wrong password — so that the stand-in cannot
 * quietly teach the screen a lie.
 */

function install() {
  const catalogue = [
    sysModule<MemorySession>(),
    secModule<MemorySession>(),
    fxModule<MemorySession>(),
  ];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC', 'FX'] }),
    (refusal) => new Error(`The edition would not compose: ${refusal.code}`),
  );

  const store = createMemoryStore();
  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw new Error(`A subscriber failed: ${String(failure.cause)}`);
    },
  });
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock: systemClock,
    onEffectFailure: (failure) => {
      throw new Error(`An effect failed: ${String(failure.cause)}`);
    },
  });

  // The wiring a real deployment uses: `SEC` is what answers "may they" for
  // every module, named by the host because the host is the one thing allowed
  // to name a module.
  const registry = createRegistry({
    catalogue,
    plan,
    bus,
    transactor,
    clock: systemClock,
    authorisedBy: Authorisation,
  });

  const tenant = newId<'tenant'>();
  return {
    tenant,
    system: systemContext(tenant),
    as: (user: ReturnType<typeof newId<'user'>>) => commandContext({ tenant, actor: user }),
    read: registry.require(Organisation),
    admin: registry.require(OrganisationAdministration),
    roles: registry.require(RoleAdministration),
    users: registry.require(UserAdministration),
    credentials: registry.require(Credentials),
    currencies: registry.require(Currencies),
    currencyAdmin: registry.require(CurrencyAdministration),
    rates: registry.require(ExchangeRates),
    rateAdmin: registry.require(RateAdministration),
  };
}

function taken<T>(result: Result<T, Refusal>): T {
  return orThrow(result, (refusal) => new Error(`refused: ${refusal.code}`));
}

function refusalOf<T>(result: Result<T, Refusal>): string {
  if (result.ok) throw new Error('Expected a refusal; the command succeeded.');
  return result.error.code;
}

function seededAs(roles: readonly Role[], seeded: string): Role {
  const role = roles.find((one) => one.seeded === seeded);
  if (role === undefined) throw new Error(`Seeding produced no ${seeded}.`);
  return role;
}

let shop: ReturnType<typeof install>;

beforeEach(() => {
  shop = install();
});

/** A shop on its first run: the seven roles, and an owner standing in it. */
async function aShopWithAnOwner(): Promise<{
  owner: ReturnType<typeof shop.as>;
  roles: readonly Role[];
}> {
  const roles = taken(await shop.roles.roles.seed(shop.system));
  const person = taken(
    await shop.users.enrol(shop.system, {
      handle: 'owner',
      name: 'المالكة',
      password: 'till-morning-1',
    }),
  );
  taken(
    await shop.roles.assignments.assign(shop.system, {
      user: person.id,
      role: seededAs(roles, 'owner').id,
      confinement: TENANT_WIDE,
    }),
  );
  return { owner: shop.as(person.id), roles };
}

describe('A shop runs itself, with SEC answering for SYS — SYS-09', () => {
  it('composes the two modules and lets the owner open their own shop', async () => {
    const { owner } = await aShopWithAnOwner();

    const company = taken(await shop.admin.companies.register(owner, { name: 'فيرتكس' }));
    const branch = taken(
      await shop.admin.branches.open(owner, { company: company.id, name: 'حلب' }),
    );

    expect((await shop.read.branch(owner, branch.id))?.name).toBe('حلب');
  });

  it('refuses a cashier the commands a cashier does not hold', async () => {
    const { owner, roles } = await aShopWithAnOwner();
    const company = taken(await shop.admin.companies.register(owner, { name: 'فيرتكس' }));
    const branch = taken(
      await shop.admin.branches.open(owner, { company: company.id, name: 'حلب' }),
    );

    const person = taken(
      await shop.users.enrol(owner, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' }),
    );
    taken(
      await shop.roles.assignments.assign(owner, {
        user: person.id,
        role: seededAs(roles, 'cashier').id,
        confinement: { kind: 'branches', branches: [branch.id], locations: [] },
      }),
    );

    // The right is `SYS`'s, the answer is `SEC`'s, and neither module imports
    // the other. Before the platform's seam existed this command ran for
    // whoever called it.
    expect(
      refusalOf(
        await shop.admin.registers.open(shop.as(person.id), {
          branch: branch.id,
          name: 'صندوق 1',
          prefix: 'AL1',
        }),
      ),
    ).toBe('sys.not-permitted');
  });
});

describe('A confinement survives the trip between the two modules — SEC-04', () => {
  it('lets a manager work their own branch and refuses them the one next door', async () => {
    const { owner, roles } = await aShopWithAnOwner();
    const company = taken(await shop.admin.companies.register(owner, { name: 'فيرتكس' }));
    const aleppo = taken(
      await shop.admin.branches.open(owner, { company: company.id, name: 'حلب' }),
    );
    const homs = taken(await shop.admin.branches.open(owner, { company: company.id, name: 'حمص' }));

    const person = taken(
      await shop.users.enrol(owner, {
        handle: 'manager',
        name: 'مدير',
        password: 'till-morning-1',
      }),
    );
    taken(
      await shop.roles.assignments.assign(owner, {
        user: person.id,
        role: seededAs(roles, 'manager').id,
        confinement: { kind: 'branches', branches: [aleppo.id], locations: [] },
      }),
    );
    const manager = shop.as(person.id);

    taken(
      await shop.admin.locations.open(manager, {
        branch: aleppo.id,
        name: 'صالة البيع',
        kind: 'shop-floor',
      }),
    );
    expect(
      refusalOf(
        await shop.admin.locations.open(manager, {
          branch: homs.id,
          name: 'صالة البيع',
          kind: 'shop-floor',
        }),
      ),
    ).toBe('sys.not-permitted');

    // The business profile is on every receipt the whole group prints, so it is
    // the tenant-wide place — which a branch-confined grant does not reach.
    expect(refusalOf(await shop.admin.profile.revise(manager, company.id, { phone: '011' }))).toBe(
      'sys.not-permitted',
    );
    expect(await shop.read.branches(owner)).toHaveLength(2);
    expect(SYS_PERMISSIONS.location.create.startsWith('sys.')).toBe(true);
  });
});

describe('SEC answers for FX as it answers for SYS — FX-02', () => {
  it('lets the owner alone choose the currency the books are kept in', async () => {
    const { owner, roles } = await aShopWithAnOwner();
    taken(await shop.currencyAdmin.seed(shop.system));

    const person = taken(
      await shop.users.enrol(owner, {
        handle: 'manager',
        name: 'مدير',
        password: 'till-morning-1',
      }),
    );
    taken(
      await shop.roles.assignments.assign(owner, {
        user: person.id,
        role: seededAs(roles, 'manager').id,
        confinement: TENANT_WIDE,
      }),
    );
    const manager = shop.as(person.id);

    // Unconfined, and still refused: every figure in the books is written in
    // this currency, `FX` seeds the right to nobody but the owner, and `SEC` is
    // what says so — neither module importing the other.
    expect(refusalOf(await shop.currencyAdmin.makeFunctional(manager, 'EUR'))).toBe(
      'fx.not-permitted',
    );
    expect((await shop.currencies.functional(manager))?.code).toBe('USD');

    taken(await shop.currencyAdmin.makeFunctional(owner, 'EUR'));
    expect((await shop.currencies.functional(manager))?.code).toBe('EUR');
  });
});

describe('SEC seeds the rights FX declares into the seven roles — SEC-01', () => {
  it('lets every role read the currencies, and leaves their rules to the owner', async () => {
    const { roles } = await aShopWithAnOwner();
    const { currency, functionalCurrency } = FX_PERMISSIONS;

    expect(roles).toHaveLength(7);
    for (const role of roles) {
      const name = role.seeded ?? role.id;
      const owner = role.seeded === 'owner';
      expect(role.rights.includes(currency.view), name).toBe(true);
      expect(role.rights.includes(currency.edit), name).toBe(owner);
      expect(role.rights.includes(functionalCurrency.edit), name).toBe(owner);
    }
  });

  it('gives the manager a branch’s rates, the owner the suggestions, and the floor the last-known confirmation', async () => {
    const { roles } = await aShopWithAnOwner();
    const { rate, suggestedRate, lastKnownRate } = FX_PERMISSIONS;
    const holding = (right: string): readonly (string | null)[] =>
      roles.filter((role) => role.rights.some((one) => one === right)).map((role) => role.seeded);

    expect(holding(rate.view)).toHaveLength(7);
    expect(holding(rate.record)).toEqual(['owner', 'manager']);
    expect(holding(suggestedRate.suggest)).toEqual(['owner']);
    expect(holding(lastKnownRate.confirm)).toEqual(['owner', 'manager', 'floor-supervisor']);
  });
});

describe('SEC confines who enters a branch’s daily rates — FX-04', () => {
  const POUNDS: RateQuote = { form: 'units-per-functional', buy: '13100', sell: '12900' };
  const EUROS: RateQuote = { form: 'functional-per-unit', buy: '1.07', sell: '1.09' };

  it('lets a manager enter and adopt the rates of their own branch, and refuses them the branch next door', async () => {
    const { owner, roles } = await aShopWithAnOwner();
    taken(await shop.currencyAdmin.seed(shop.system));
    const company = taken(await shop.admin.companies.register(owner, { name: 'فيرتكس' }));
    const aleppo = taken(
      await shop.admin.branches.open(owner, { company: company.id, name: 'حلب' }),
    );
    const homs = taken(await shop.admin.branches.open(owner, { company: company.id, name: 'حمص' }));

    const person = taken(
      await shop.users.enrol(owner, {
        handle: 'manager',
        name: 'مدير',
        password: 'till-morning-1',
      }),
    );
    taken(
      await shop.roles.assignments.assign(owner, {
        user: person.id,
        role: seededAs(roles, 'manager').id,
        confinement: { kind: 'branches', branches: [aleppo.id], locations: [] },
      }),
    );
    const manager = shop.as(person.id);

    const recorded = taken(await shop.rateAdmin.record(manager, aleppo.id, 'SYP', POUNDS));
    expect(refusalOf(await shop.rateAdmin.record(manager, homs.id, 'SYP', POUNDS))).toBe(
      'fx.not-permitted',
    );

    // A suggestion speaks for the whole group, so it is the owner's; adopting one
    // is a branch's rate, so it is judged at the branch like entering one.
    expect(refusalOf(await shop.rateAdmin.suggest(manager, 'EUR', EUROS))).toBe('fx.not-permitted');
    taken(await shop.rateAdmin.suggest(owner, 'EUR', EUROS));
    expect(taken(await shop.rateAdmin.adopt(manager, aleppo.id))).toHaveLength(1);
    expect(refusalOf(await shop.rateAdmin.adopt(manager, homs.id))).toBe('fx.not-permitted');

    // Filed under the day of the branch `SYS` opened, in the zone `SYS` gave it.
    const board = taken(await shop.rates.board(manager, aleppo.id));
    expect(aleppo.timeZone).toBe('Asia/Damascus');
    expect(recorded.day).toBe(board.day);
    expect(board.lines.find((line) => line.currency.code === 'SYP')?.revision).toEqual(recorded);
  });

  it('refuses a cashier the rates, and lets them read the rate a sale is taken at', async () => {
    const { owner, roles } = await aShopWithAnOwner();
    taken(await shop.currencyAdmin.seed(shop.system));
    const company = taken(await shop.admin.companies.register(owner, { name: 'فيرتكس' }));
    const aleppo = taken(
      await shop.admin.branches.open(owner, { company: company.id, name: 'حلب' }),
    );
    const person = taken(
      await shop.users.enrol(owner, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' }),
    );
    taken(
      await shop.roles.assignments.assign(owner, {
        user: person.id,
        role: seededAs(roles, 'cashier').id,
        confinement: TENANT_WIDE,
      }),
    );
    const cashier = shop.as(person.id);
    const recorded = taken(await shop.rateAdmin.record(owner, aleppo.id, 'SYP', POUNDS));

    expect(refusalOf(await shop.rateAdmin.record(cashier, aleppo.id, 'SYP', POUNDS))).toBe(
      'fx.not-permitted',
    );
    expect(taken(await shop.rates.current(cashier, aleppo.id, 'SYP')).revision).toEqual(recorded);
  });
});

describe('What the browser stand-in is allowed to claim — SEC-09', () => {
  it('answers an unknown handle exactly as it answers a wrong password', async () => {
    await aShopWithAnOwner();

    // `dev-system.ts` reproduces this and nothing else about `SEC`. Pinned on
    // the real module, in the one place it can run, so the stand-in cannot
    // drift into teaching the sign-in screen a rule `SEC` does not keep.
    const wrongPassword = await shop.credentials.authenticate(
      shop.system,
      'owner',
      'not-the-password',
    );
    const unknownHandle = await shop.credentials.authenticate(
      shop.system,
      'nobody-by-that-name',
      'not-the-password',
    );

    expect(refusalOf(wrongPassword)).toBe('sec.password-wrong');
    expect(refusalOf(unknownHandle)).toBe('sec.password-wrong');
  });

  it('lets somebody withdrawn prove who they are and still refuses them the shop', async () => {
    const { owner } = await aShopWithAnOwner();
    const person = taken(
      await shop.users.enrol(owner, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' }),
    );
    taken(await shop.users.deactivate(owner, person.id));

    expect(
      refusalOf(await shop.credentials.authenticate(shop.system, 'ahmad', 'till-morning-1')),
    ).toBe('sec.user-inactive');
  });
});

/**
 * `dev-system.ts` grew a hand-rolled role editor and a hand-rolled
 * `changeOwnPassword` alongside its sign-in stand-in, once the screens that
 * needed them arrived (`SEC-01`, `SEC-02`). Pinned here the same way: on the
 * real module, in the one place it can run.
 */
describe('What the browser stand-in also claims — SEC-01, SEC-02, SEC-09', () => {
  it('refuses to revoke the last role’s hold on editing roles', async () => {
    const { owner, roles } = await aShopWithAnOwner();
    const ownerRole = seededAs(roles, 'owner');

    // A freshly seeded shop has exactly one role assigned to anybody, and it
    // is this one — so taking `sec.role.edit` out of it leaves nobody who
    // could ever put it back.
    expect(
      refusalOf(await shop.roles.roles.revoke(owner, ownerRole.id, [SEC_PERMISSIONS.role.edit])),
    ).toBe('sec.last-owner');
  });

  it('lets a role keep editing roles once another one holds it too', async () => {
    const { owner, roles } = await aShopWithAnOwner();
    const ownerRole = seededAs(roles, 'owner');
    const managerRole = seededAs(roles, 'manager');

    taken(await shop.roles.roles.grant(owner, managerRole.id, [SEC_PERMISSIONS.role.edit]));
    const person = taken(
      await shop.users.enrol(owner, { handle: 'sara', name: 'سارة', password: 'till-morning-1' }),
    );
    taken(
      await shop.roles.assignments.assign(owner, {
        user: person.id,
        role: managerRole.id,
        confinement: TENANT_WIDE,
      }),
    );

    const revoked = taken(
      await shop.roles.roles.revoke(owner, ownerRole.id, [SEC_PERMISSIONS.role.edit]),
    );
    expect(revoked.rights.includes(SEC_PERMISSIONS.role.edit)).toBe(false);
  });

  it('treats withdrawing an assignment already withdrawn as done, not as missing', async () => {
    // The stand-in refused the second press of a withdraw button with
    // "assignment not found"; the module it stands in for answers it as done.
    const { owner, roles } = await aShopWithAnOwner();
    const cashierRole = seededAs(roles, 'cashier');
    const person = taken(
      await shop.users.enrol(owner, { handle: 'sami', name: 'سامي', password: 'till-morning-1' }),
    );
    taken(
      await shop.roles.assignments.assign(owner, {
        user: person.id,
        role: cashierRole.id,
        confinement: TENANT_WIDE,
      }),
    );

    taken(await shop.roles.assignments.withdraw(owner, person.id, cashierRole.id));
    const again = taken(await shop.roles.assignments.withdraw(owner, person.id, cashierRole.id));
    expect(again.active).toBe(false);
  });

  it('answers a wrong current password and a new one that is too short, from changeOwnPassword', async () => {
    const { owner } = await aShopWithAnOwner();

    expect(
      refusalOf(
        await shop.credentials.changeOwnPassword(owner, 'not-the-password', 'brand-new-one'),
      ),
    ).toBe('sec.password-wrong');
    expect(
      refusalOf(await shop.credentials.changeOwnPassword(owner, 'till-morning-1', 'short')),
    ).toBe('sec.password-too-short');
  });
});
