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
  TENANT_WIDE,
  UserAdministration,
  type Role,
} from '@vertex/sec';
import { Organisation, OrganisationAdministration, sysModule, SYS_PERMISSIONS } from '@vertex/sys';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The real `SYS` and the real `SEC`, in one edition.
 *
 * **Nothing else in this repository can run this test, and that is why it is
 * here.** `modules.md` §4 lets a module see another module's contract and
 * nothing more, so `SEC`'s own suite stands `SYS` in and `SYS`'s stands `SEC`
 * in — each proves its half against an interface. An **app** is the one thing
 * allowed to name both, which makes the first app the first place the two
 * halves have ever met.
 *
 * What it pins down is the wiring the screens are about to be built on: that
 * the edition composes, that `SEC` answers the authorisation the platform asks
 * on `SYS`'s behalf, and that `SEC-04` confinement survives the trip across the
 * boundary. It also pins the one behaviour the browser stand-in of
 * `dev-system.ts` reproduces — one refusal for an unknown handle and for a
 * wrong password — so that the stand-in cannot quietly teach the screen a lie.
 */

function install() {
  const catalogue = [sysModule<MemorySession>(), secModule<MemorySession>()];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC'] }),
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
