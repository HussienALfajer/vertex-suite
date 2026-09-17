import type { BranchId, DeviceId, RegisterId, UserId } from '@vertex/contracts';
import { instant, manualClock, newId, orThrow, type Id, type ManualClock } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  contractKey,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  defineModule,
  provideContract,
  systemContext,
  type AuthorisationScope,
  type Authoriser,
  type CommandContext,
  type MemorySession,
  type MemoryStore,
  type Registry,
} from '@vertex/platform';
import { DEFAULT_TIME_ZONE, Organisation, type Branch, type Register } from '@vertex/sys/contract';

import {
  Currencies,
  CurrencyAdministration,
  ExchangeRates,
  RateAdministration,
} from './contract.js';
import { fxModule } from './index.js';

/**
 * `FX` installed the way a store node installs it, over `SYS`'s **contract**.
 *
 * The real edition composition, the real registry and the real transactor over
 * the memory store the platform ships — so a test that passes is a statement
 * about the module as an edition hosts it. The build excludes `*.fixture.ts`,
 * so none of this ships.
 *
 * `SYS` is stood in for, as `SEC`'s suite stands it in: `modules.md` §4.1 lets
 * `FX` rely on the published interface and nothing more, and a test composing
 * the real `SYS` would be asserting things `FX` is not allowed to know. The
 * stand-in answers the two questions `FX` asks — a branch, and the registers of
 * a branch — and raises on any other, so that a change which started asking
 * `SYS` something new fails here instead of widening the coupling unremarked.
 */
export interface Installed {
  readonly registry: Registry<MemorySession>;
  readonly store: MemoryStore;
  readonly read: Currencies;
  readonly admin: CurrencyAdministration;
  readonly rates: ExchangeRates;
  readonly rateAdmin: RateAdministration;
  /**
   * The shop's time, and the one thing about it a test may choose. It starts at
   * noon in Damascus on 17 September 2026, which is 09:00 UTC.
   */
  readonly clock: ManualClock;
  readonly tenant: Id<'tenant'>;
  /** A person acting in the tenant. What they may do is whatever `answers` says. */
  readonly by: CommandContext;
  /** The system: first-run installation, a migration, a sync. It has nobody to ask about. */
  readonly system: CommandContext;
  /** A second tenant on the same store node, which is the normal case. */
  readonly otherTenant: Id<'tenant'>;
  readonly byOther: CommandContext;
  /** A person standing at a machine — a register, if one is assigned to it. */
  at(device: DeviceId, actor?: UserId): CommandContext;
  /**
   * What the stand-in authority answers, for a test that came to prove a guard
   * is live rather than to exercise the command behind it.
   *
   * Everything, by default: a fixture that refused by default would make every
   * test of this module a test of permissions.
   */
  answers(decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean): void;

  /** A branch of the tenant, as far as `FX` can see one. */
  openBranch(options?: { readonly timeZone?: string; readonly tenant?: Id<'tenant'> }): BranchId;
  shutBranch(branch: BranchId): void;
  /** `SYS`'s `branches.rezone`, as `FX` sees the result of it: the branch's day moves. */
  rezoneBranch(branch: BranchId, timeZone: string): void;
  /** A till in a branch, with a machine standing at it. */
  openRegister(branch: BranchId): { readonly register: RegisterId; readonly device: DeviceId };
}

/** 12:00 in Damascus, which keeps UTC+3 all year. */
export const NOON_IN_DAMASCUS = instant(Date.UTC(2026, 8, 17, 9, 0, 0));

/** A day, in milliseconds. */
export const DAY = 86_400_000;

/**
 * `SEC`'s answer, stood in for.
 *
 * `FX` asks through `ModuleContext.authorise` and never learns who answers. The
 * edition hosts a module under the code `SEC` answering that one question,
 * under the key the real one publishes. `apps/back-office`'s composition test
 * is where the real `SEC` answers for `FX`.
 */
const StandInAuthority = contractKey<Authoriser>('sec.authorisation');

function authorityStandIn(
  decide: () => (by: CommandContext, right: string, where?: AuthorisationScope) => boolean,
) {
  return defineModule<MemorySession>({
    code: 'SEC',
    labelKey: 'module.sec',
    provides: [
      provideContract(StandInAuthority, () => ({
        may: (by: CommandContext, right: string, where?: AuthorisationScope) =>
          Promise.resolve(decide()(by, right, where)),
      })),
    ],
  });
}

/** What `FX` is entitled to know about a shop's structure. */
interface Places {
  readonly branches: Map<BranchId, Branch>;
  readonly registers: Map<RegisterId, Register>;
}

function unasked(method: string): never {
  throw new Error(
    `FX asked SYS for ${method}, which it has never needed. If that is now a real ` +
      'dependency, say so deliberately — it widens what FX knows about the structure of a shop.',
  );
}

function organisationStandIn(places: Places) {
  return defineModule<MemorySession>({
    code: 'SYS',
    labelKey: 'module.sys',
    provides: [
      provideContract(Organisation, () => {
        // Answered in the caller's tenant and nowhere else: a branch of another
        // shop group must be as absent to `FX` as one that was never opened.
        const mine = <T extends { readonly tenant: Id<'tenant'> }>(
          record: T | undefined,
          by: CommandContext,
        ): T | null => (record?.tenant === by.tenant ? record : null);

        return {
          branch: (by, id) => Promise.resolve(mine(places.branches.get(id), by)),
          registers: (by, branch, listing) =>
            Promise.resolve(
              [...places.registers.values()].filter(
                (one) =>
                  one.tenant === by.tenant &&
                  one.branch === branch &&
                  (listing?.including === 'all' || one.active),
              ),
            ),
          company: () => unasked('a company'),
          location: () => unasked('a location'),
          register: () => unasked('a register'),
          companies: () => unasked('every company'),
          branches: () => unasked('every branch'),
          locations: () => unasked('the locations of a branch'),
          profile: () => unasked('a business profile'),
          setting: () => unasked('a setting'),
        } satisfies Organisation;
      }),
    ],
  });
}

export function installFx(): Installed {
  let decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean = () =>
    true;

  const places: Places = { branches: new Map(), registers: new Map() };
  const catalogue = [
    organisationStandIn(places),
    authorityStandIn(() => decide),
    fxModule<MemorySession>(),
  ];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC', 'FX'] }),
    (refusal) => new Error(`The edition would not compose: ${refusal.code}`),
  );

  const clock = manualClock(NOON_IN_DAMASCUS);
  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw new Error(`A subscriber failed: ${String(failure.cause)}`);
    },
  });
  const store = createMemoryStore();
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock,
    onEffectFailure: (failure) => {
      throw new Error(`An effect failed: ${String(failure.cause)}`);
    },
  });
  const registry = createRegistry({
    catalogue,
    plan,
    bus,
    transactor,
    clock,
    authorisedBy: StandInAuthority,
  });

  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();

  return {
    registry,
    store,
    read: registry.require(Currencies),
    admin: registry.require(CurrencyAdministration),
    rates: registry.require(ExchangeRates),
    rateAdmin: registry.require(RateAdministration),
    clock,
    tenant,
    by: commandContext({ tenant, actor: newId<'user'>() }),
    system: systemContext(tenant),
    otherTenant,
    byOther: commandContext({ tenant: otherTenant, actor: newId<'user'>() }),
    at: (device: DeviceId, actor: UserId = newId<'user'>()) =>
      commandContext({ tenant, actor, device }),
    answers(
      next: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean,
    ): void {
      decide = next;
    },

    openBranch(options = {}): BranchId {
      const branch: Branch = {
        id: newId<'branch'>(),
        tenant: options.tenant ?? tenant,
        company: newId<'company'>(),
        name: 'Aleppo',
        address: '',
        point: null,
        timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
        active: true,
      };
      places.branches.set(branch.id, branch);
      return branch.id;
    },
    shutBranch(id: BranchId): void {
      const branch = places.branches.get(id);
      if (branch === undefined) throw new Error('That branch was never opened.');
      places.branches.set(id, { ...branch, active: false });
    },
    rezoneBranch(id: BranchId, timeZone: string): void {
      const branch = places.branches.get(id);
      if (branch === undefined) throw new Error('That branch was never opened.');
      places.branches.set(id, { ...branch, timeZone });
    },
    openRegister(branch: BranchId) {
      const of = places.branches.get(branch);
      if (of === undefined) throw new Error('That branch was never opened.');
      const device = newId<'device'>();
      const register: Register = {
        id: newId<'register'>(),
        tenant: of.tenant,
        branch,
        name: 'Till',
        prefix: 'T1',
        active: true,
        generation: 1,
        heldBy: device,
      };
      places.registers.set(register.id, register);
      return { register: register.id, device };
    },
  };
}
