import type { BranchId, CompanyId, LocationId, SeededRole, UserId } from '@vertex/contracts';
import {
  newId,
  orThrow,
  systemClock,
  type Clock,
  type Id,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  defineModule,
  provideContract,
  systemContext,
  type CommandContext,
  type MemorySession,
  type MemoryStore,
  type ModuleCode,
  type ModuleDefinition,
  type Registry,
} from '@vertex/platform';
import {
  Organisation,
  SYS_PERMISSION_SEEDS,
  type Branch,
  type Location,
  type LocationKind,
} from '@vertex/sys/contract';

import {
  Authorisation,
  Credentials,
  RoleAdministration,
  RoleDirectory,
  TENANT_WIDE,
  UserAdministration,
  UserDirectory,
} from './contract.js';
import { secModule } from './index.js';
import { identityIn, writeIdentity } from './records.js';

/**
 * `SEC` installed over `SYS`'s **contract** rather than over `SYS`.
 *
 * `modules.md` §4.1 lets a module import another's contract and nothing else,
 * and `check:boundaries` holds the workspace to it — so a test in this package
 * cannot reach for `sysModule()` any more than the module can. That is the rule
 * working rather than the rule being awkward: what `SEC` is entitled to rely on
 * is the published interface, and a test that composed the real `SYS` beside it
 * would be quietly asserting things about `SYS`'s behaviour that `SEC` is not
 * allowed to know.
 *
 * So the edition here hosts a module under the code `SYS` that declares `SYS`'s
 * own rights — the seeds of `SEC-01` are part of what `SYS` publishes — and
 * answers the two questions `SEC` actually asks of it. Every other method of
 * the contract raises, which keeps the dependency honest: a change that started
 * asking `SYS` something new fails here, loudly, instead of widening the
 * coupling unremarked.
 *
 * The build excludes `*.fixture.ts`, so none of this ships.
 */
export interface Installed {
  readonly registry: Registry<MemorySession>;
  readonly store: MemoryStore;
  readonly auth: Authorisation;
  readonly admin: RoleAdministration;
  readonly directory: RoleDirectory;
  readonly users: UserAdministration;
  readonly people: UserDirectory;
  readonly credentials: Credentials;
  readonly tenant: Id<'tenant'>;
  /**
   * The system: a migration, a scheduled job, a sync applying somebody else's
   * work. It is how a shop gets its first role and its first owner, because at
   * that moment there is nobody to have authorised it.
   */
  readonly system: CommandContext;
  /** A second tenant on the same store node, which is the normal case. */
  readonly otherTenant: Id<'tenant'>;
  readonly otherSystem: CommandContext;
  as(user: UserId): CommandContext;
  /**
   * Somebody who actually works here.
   *
   * There is no such thing as a user identifier with nobody behind it any more:
   * `SEC-09` made a person a record, and the decision reads it, so an assignment
   * naming a stranger grants nothing. A test that wants somebody with rights
   * has to hire them, exactly as a shop does.
   */
  hire(handle: string, password?: string): Promise<UserId>;
  /** The same, in the second shop group on this store node. */
  hireIn(tenant: Id<'tenant'>, handle: string, password?: string): Promise<UserId>;
  asIn(tenant: Id<'tenant'>, user: UserId): CommandContext;

  /** The organisation `SEC` is asking about, as far as `SEC` can see it. */
  openBranch(name: string, tenant?: Id<'tenant'>): BranchId;
  openLocation(branch: BranchId, name: string, kind?: LocationKind): LocationId;
  shutBranch(branch: BranchId): void;

  /**
   * Writes a credential the way an older build would have written it.
   *
   * The one thing a test cannot produce by asking the module for it: a stored
   * form whose parameters are not today's, which is what a raised cost and a
   * replayed row from another device both look like.
   */
  ageCredential(user: UserId, stored: string): Promise<void>;
  storedCredential(user: UserId): Promise<string | null>;

  /**
   * The same shop, its data untouched, running an edition that has since grown
   * a module (`modules.md` §4.4: a customer upgrading an edition runs the new
   * module's migrations against live data).
   *
   * It is the one thing a single composition cannot show, and the case that
   * decides whether seeding is a thing done once or a reconciliation.
   */
  afterBuying(code: ModuleCode, rights: readonly SeededRight[]): Installed;
}

/** A right a later module declares, and who it says should start out with it. */
export interface SeededRight {
  readonly id: string;
  readonly seededFor?: readonly SeededRole[] | undefined;
}

/** What `SEC` is entitled to know about a place: that it is there, and whose. */
interface Places {
  readonly branches: Map<BranchId, Branch>;
  readonly locations: Map<LocationId, Location>;
}

function unasked(method: string): never {
  throw new Error(
    `SEC asked SYS for ${method}, which it has never needed. If that is now a real ` +
      'dependency, say so deliberately — it widens what an edition without SYS would lose.',
  );
}

function organisationStandIn(places: Places): ModuleDefinition<MemorySession> {
  return defineModule<MemorySession>({
    code: 'SYS',
    labelKey: 'module.sys',
    permissions: SYS_PERMISSION_SEEDS.map(({ id, seededFor }) => ({
      id,
      labelKey: `permission.${id}`,
      seededFor,
    })),
    provides: [
      provideContract(Organisation, () => {
        // Every read is answered in the caller's tenant and nowhere else, which
        // is the one behaviour of `SYS` that `SEC`'s own correctness rests on:
        // a branch of another shop group must be as absent as one that was
        // never opened.
        const mine = <T extends { readonly tenant: Id<'tenant'> }>(
          record: T | undefined,
          by: CommandContext,
        ): T | null => (record?.tenant === by.tenant ? record : null);

        return {
          branch: (by, id) => Promise.resolve(mine(places.branches.get(id), by)),
          location: (by, id) => Promise.resolve(mine(places.locations.get(id), by)),
          company: () => unasked('a company'),
          register: () => unasked('a register'),
          companies: () => unasked('every company'),
          branches: () => unasked('every branch'),
          locations: () => unasked('the locations of a branch'),
          registers: () => unasked('the registers of a branch'),
          profile: () => unasked('a business profile'),
          setting: () => unasked('a setting'),
        } satisfies Organisation;
      }),
    ],
  });
}

/**
 * `clock` is the one thing a test may choose: a recovery lapses, and a suite
 * that waited a week to prove it would not be run.
 */
export function installSec(options: { readonly clock?: Clock } = {}): Installed {
  const places: Places = { branches: new Map(), locations: new Map() };
  const store = createMemoryStore();
  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();
  const company = newId<'company'>();

  return bring(places, store, tenant, otherTenant, company, [], options.clock ?? systemClock);
}

/** One edition, brought up over whatever this shop already has in its store. */
function bring(
  places: Places,
  store: MemoryStore,
  tenant: Id<'tenant'>,
  otherTenant: Id<'tenant'>,
  company: CompanyId,
  bought: readonly ModuleDefinition<MemorySession>[],
  clock: Clock,
): Installed {
  const catalogue = [organisationStandIn(places), secModule<MemorySession>(), ...bought];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC', ...bought.map((one) => one.code)] }),
    (refusal) => new Error(`The edition would not compose: ${refusal.code}`),
  );

  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw new Error(`A subscriber failed: ${String(failure.cause)}`);
    },
  });
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock,
    onEffectFailure: (failure) => {
      throw new Error(`An effect failed: ${String(failure.cause)}`);
    },
  });
  // The real wiring: `SEC` is what answers "may they" for every module in the
  // edition, and the host is the one thing allowed to say so. `SEC` guards its
  // own commands with its own decision rather than through this, which is the
  // same answer reached without a round trip through the registry.
  const registry = createRegistry({
    catalogue,
    plan,
    bus,
    transactor,
    clock,
    authorisedBy: Authorisation,
  });

  return {
    registry,
    store,
    auth: registry.require(Authorisation),
    admin: registry.require(RoleAdministration),
    directory: registry.require(RoleDirectory),
    users: registry.require(UserAdministration),
    people: registry.require(UserDirectory),
    credentials: registry.require(Credentials),
    tenant,
    system: systemContext(tenant),
    otherTenant,
    otherSystem: systemContext(otherTenant),
    as: (user: UserId): CommandContext => commandContext({ tenant, actor: user }),
    async hire(handle: string, password = 'a-long-enough-password'): Promise<UserId> {
      const hired = taken(
        await registry
          .require(UserAdministration)
          .enrol(systemContext(tenant), { handle, name: handle, password }),
      );
      return hired.id;
    },
    async hireIn(
      owner: Id<'tenant'>,
      handle: string,
      password = 'a-long-enough-password',
    ): Promise<UserId> {
      const hired = taken(
        await registry
          .require(UserAdministration)
          .enrol(systemContext(owner), { handle, name: handle, password }),
      );
      return hired.id;
    },
    asIn: (owner: Id<'tenant'>, user: UserId): CommandContext =>
      commandContext({ tenant: owner, actor: user }),

    openBranch(name: string, owner: Id<'tenant'> = tenant): BranchId {
      const branch: Branch = {
        id: newId<'branch'>(),
        tenant: owner,
        company,
        name,
        // `SYS-14`'s address and point, unset: nothing `SEC` decides depends on
        // where a branch is, only on which one it is. A fixture that filled
        // them in would be inventing a fact these suites never read.
        address: '',
        point: null,
        active: true,
      };
      places.branches.set(branch.id, branch);
      return branch.id;
    },
    openLocation(branch: BranchId, name: string, kind: LocationKind = 'shop-floor'): LocationId {
      const of = places.branches.get(branch);
      if (of === undefined) throw new Error('That branch was never opened.');
      const location: Location = {
        id: newId<'location'>(),
        tenant: of.tenant,
        branch,
        name,
        kind,
        address: '',
        point: null,
        active: true,
      };
      places.locations.set(location.id, location);
      return location.id;
    },
    shutBranch(branch: BranchId): void {
      const of = places.branches.get(branch);
      if (of === undefined) throw new Error('That branch was never opened.');
      places.branches.set(branch, { ...of, active: false });
    },

    ageCredential(user: UserId, stored: string): Promise<void> {
      return transactor.run(systemContext(tenant), (uow) => {
        const identity = identityIn(uow.session, user);
        if (identity === null) throw new Error('Nobody by that identifier.');
        writeIdentity(uow.session, { ...identity, credential: stored });
        return Promise.resolve();
      });
    },
    storedCredential(user: UserId): Promise<string | null> {
      return transactor.run(systemContext(tenant), (uow) =>
        Promise.resolve(identityIn(uow.session, user)?.credential ?? null),
      );
    },

    afterBuying(code: ModuleCode, rights: readonly SeededRight[]): Installed {
      const bought = defineModule<MemorySession>({
        code,
        labelKey: `module.${code.toLowerCase()}`,
        permissions: rights.map(({ id, seededFor }) => ({
          id,
          labelKey: `permission.${id}`,
          seededFor: seededFor ?? [],
        })),
      });
      return bring(places, store, tenant, otherTenant, company, [bought], clock);
    },
  };
}

/** The value, or a failure naming the refusal — for a step a test is not testing. */
export function taken<T>(result: Result<T, Refusal>): T {
  return orThrow(result, (refusal) => new Error(`refused: ${refusal.code}`));
}

/** The refusal code, for a test that came to assert one. */
export function refusalOf<T>(result: Result<T, Refusal>): string {
  if (result.ok) throw new Error('Expected a refusal; the command succeeded.');
  return result.error.code;
}

/**
 * A second shop group on the same store node, staffed the same way.
 *
 * Every rule about a shared sign-in is a rule about two tenants, and one of
 * them has to be able to answer for itself: a recovery is approved by "an
 * administrator of every tenant it belongs to", and a test that used the system
 * context to stand in for that administrator would be asserting the rule
 * against nobody.
 */
export async function aSecondShopWithAnOwner(sec: Installed): Promise<CommandContext> {
  const roles = taken(await sec.admin.roles.seed(sec.otherSystem));
  const owner = roles.find((role) => role.seeded === 'owner');
  if (owner === undefined) throw new Error('Seeding produced no owner.');

  const user = await sec.hireIn(sec.otherTenant, 'their-owner');
  taken(
    await sec.admin.assignments.assign(sec.otherSystem, {
      user,
      role: owner.id,
      confinement: TENANT_WIDE,
    }),
  );
  return sec.asIn(sec.otherTenant, user);
}

/**
 * A shop with its seven roles and an owner standing in it.
 *
 * Every test that is not about seeding starts here, because every real
 * installation does: the first run seeds the roles and puts the first owner in
 * place, and a test that hand-built a user with rights would be testing a shop
 * that cannot exist.
 */
export async function aShopWithAnOwner(sec: Installed): Promise<UserId> {
  const roles = taken(await sec.admin.roles.seed(sec.system));
  const owner = roles.find((role) => role.seeded === 'owner');
  if (owner === undefined) throw new Error('Seeding produced no owner.');

  const user = await sec.hire('owner');
  taken(
    await sec.admin.assignments.assign(sec.system, {
      user,
      role: owner.id,
      confinement: TENANT_WIDE,
    }),
  );
  return user;
}
