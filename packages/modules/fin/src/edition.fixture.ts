import type { TenantId } from '@vertex/contracts';
import type { CurrencyCode } from '@vertex/kernel';
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
  type AccountRoleDeclaration,
  type AuthorisationScope,
  type Authoriser,
  type CommandContext,
  type MemorySession,
  type MemoryStore,
  type ModuleDefinition,
  type Registry,
  type SessionDriver,
} from '@vertex/platform';
import {
  Currencies,
  CurrencyDefined,
  ROUNDING_ACCOUNT,
  type TenantCurrency,
} from '@vertex/fx/contract';

import { ChartAdministration, ChartOfAccounts } from './contract.js';
import { finModule } from './index.js';

/**
 * `FIN` installed the way a store node installs it, over the **contracts** of
 * the modules beneath it.
 *
 * The real edition composition, the real registry and the real transactor over
 * the memory store the platform ships — so a test that passes is a statement
 * about the module as an edition hosts it. The build excludes `*.fixture.ts`,
 * so none of this ships.
 *
 * `SYS`, `SEC` and `FX` are stood in for, as `FX`'s suite stands `SYS` in:
 * `modules.md` §4.1 lets `FIN` rely on their published interfaces and nothing
 * more, and a test composing the real ones would be asserting things `FIN` is
 * not allowed to know. Each stand-in answers the questions `FIN` actually asks
 * and raises on any other, so that a change which started asking something new
 * fails here instead of widening the coupling unremarked. `SYS` is asked
 * nothing yet; the branch and its day, and the document number, arrive with
 * the posting engine.
 *
 * The modules that will one day post — `STK`, `CSH`, `SAL` — are stood in for
 * by their **declarations** alone: a role each, reserved or not, so that the
 * mapping of `FIN-01` has something to map. `FIN` never learns what any of them
 * does, which is the point of a role.
 */
export interface Installed {
  readonly registry: Registry<MemorySession>;
  readonly store: MemoryStore;
  readonly chart: ChartOfAccounts;
  readonly admin: ChartAdministration;
  /** The shop's time. Noon in Damascus on 20 September 2026, which is 09:00 UTC. */
  readonly clock: ManualClock;
  readonly tenant: Id<'tenant'>;
  /** A person acting in the tenant. What they may do is whatever `answers` says. */
  readonly by: CommandContext;
  /** The system: first-run installation, a migration, a sync. It has nobody to ask about. */
  readonly system: CommandContext;
  /** A second tenant on the same store node, which is the normal case. */
  readonly otherTenant: Id<'tenant'>;
  readonly byOther: CommandContext;
  /**
   * What the stand-in authority answers, for a test that came to prove a guard
   * is live rather than to exercise the command behind it. Everything, by
   * default: a fixture that refused by default would make every test of this
   * module a test of permissions.
   */
  answers(decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean): void;
  /** The currencies `FX` would report for a tenant, as this fixture has them. */
  currencies(tenant?: Id<'tenant'>): readonly TenantCurrency[];
  /**
   * `FX`'s `define` or `seed`, as `FIN` sees it: a currency exists, and the
   * event that says so is delivered after the commit, exactly as the real
   * module delivers it through the unit of work.
   *
   * `raced` makes the command that hears the event lose a race, once: another
   * command commits a change to the store between the subscriber's transaction
   * beginning and its commit, which is what a chart seed running on the same
   * first morning does — and what the serialising store then refuses.
   */
  defineCurrency(
    code: CurrencyCode,
    options?: { readonly tenant?: Id<'tenant'>; readonly raced?: boolean },
  ): Promise<void>;
  /** `FX`'s `disable`, as `FIN` sees it: the currency is still there, and no longer taken. */
  withdrawCurrency(code: CurrencyCode): void;
  /** `FX` for a tenant that has no currencies at all. */
  forgetCurrencies(tenant?: Id<'tenant'>): void;
}

/** 12:00 in Damascus, which keeps UTC+3 all year. */
export const NOON_IN_DAMASCUS = instant(Date.UTC(2026, 8, 20, 9, 0, 0));

/**
 * `SEC`'s answer, stood in for.
 *
 * `FIN` asks through `ModuleContext.authorise` and never learns who answers. The
 * edition hosts a module under the code `SEC` answering that one question,
 * under the key the real one publishes.
 */
const StandInAuthority = contractKey<Authoriser>('sec.authorisation');

function authorityStandIn(
  decide: () => (by: CommandContext, right: string, where?: AuthorisationScope) => boolean,
): ModuleDefinition<MemorySession> {
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

function unasked(module: string, method: string): never {
  throw new Error(
    `FIN asked ${module} for ${method}, which it has never needed. If that is now a real ` +
      `dependency, say so deliberately — it widens what FIN knows about ${module}.`,
  );
}

/** Nothing yet: the branch, its day and the document number arrive with the posting engine. */
function organisationStandIn(): ModuleDefinition<MemorySession> {
  return defineModule<MemorySession>({ code: 'SYS', labelKey: 'module.sys' });
}

/**
 * A currency as `FX` would define it: the kernel's shape, with rules that do
 * not matter to a chart — only the code does, and the tenant it belongs to.
 */
function currencyNamed(tenant: TenantId, code: CurrencyCode): TenantCurrency {
  return {
    tenant,
    code,
    symbol: code,
    decimals: 2,
    roundingIncrement: '0.01',
    roundingMode: 'half-up',
    enabled: true,
  };
}

/**
 * `FX`, stood in for: the currencies of each tenant, the announcement of a new
 * one, and the one account role the real module declares.
 *
 * Declares the event the real module declares, under its real name, because
 * the registry refuses a subscription to an event no module in the catalogue
 * publishes — which is how `FIN`'s subscription is held to the name `FX`
 * actually uses. And declares the rounding role under the real module's name
 * for it, so that what is proved here about `FX-07`'s residual reaching a
 * reserved account is proved about the role `FX` actually posts to.
 */
function currenciesStandIn(held: Map<TenantId, TenantCurrency[]>): ModuleDefinition<MemorySession> {
  return defineModule<MemorySession>({
    code: 'FX',
    labelKey: 'module.fx',
    accounts: [
      {
        role: ROUNDING_ACCOUNT,
        labelKey: `account-role.${ROUNDING_ACCOUNT}`,
        normalBalance: 'credit',
        reserved: 'rounding',
      },
    ],
    publishes: [{ type: CurrencyDefined, labelKey: `event.${CurrencyDefined.name}` }],
    provides: [
      provideContract(Currencies, () => ({
        // In code order, as the real module lists them.
        currencies: (by, listing) =>
          Promise.resolve(
            (held.get(by.tenant) ?? [])
              .filter((one) => listing?.including === 'all' || one.enabled)
              .sort((one, other) => (one.code < other.code ? -1 : 1)),
          ),
        currency: () => unasked('FX', 'one currency'),
        functional: () => unasked('FX', 'the functional currency'),
      })),
    ],
  });
}

/**
 * Whoever will post, reduced to what `FIN-01` needs from them: the roles they
 * declare. Real module codes, because the platform refuses any other, and the
 * roles they would genuinely declare, so that what is proved here is the
 * resolution those modules will rely on.
 */
function declaring(
  code: 'STK' | 'CSH' | 'SAL',
  accounts: readonly AccountRoleDeclaration[],
): ModuleDefinition<MemorySession> {
  return defineModule<MemorySession>({ code, labelKey: `module.${code.toLowerCase()}`, accounts });
}

/** A role reserved for a purpose, as a module declares one. */
export const INVENTORY_ROLE = 'stk.inventory';
export const COGS_ROLE = 'stk.cost-of-goods-sold';
export const CASH_ROLE = 'csh.cash';
/** Roles nobody reserves, which the accountant maps by hand. */
export const EXPENSE_ROLE = 'csh.expense';
export const REVENUE_ROLE = 'sal.revenue';
/** A role no module in this edition declares. */
export const UNDECLARED_ROLE = 'pur.landed-cost';

export function installFin(): Installed {
  let decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean = () =>
    true;

  const held = new Map<TenantId, TenantCurrency[]>();
  const catalogue = [
    organisationStandIn(),
    authorityStandIn(() => decide),
    currenciesStandIn(held),
    finModule<MemorySession>(),
    declaring('STK', [
      {
        role: INVENTORY_ROLE,
        labelKey: `account-role.${INVENTORY_ROLE}`,
        normalBalance: 'debit',
        reserved: 'inventory',
      },
      {
        role: COGS_ROLE,
        labelKey: `account-role.${COGS_ROLE}`,
        normalBalance: 'debit',
        reserved: 'cogs',
      },
    ]),
    declaring('CSH', [
      {
        role: CASH_ROLE,
        labelKey: `account-role.${CASH_ROLE}`,
        normalBalance: 'debit',
        reserved: 'cash',
      },
      { role: EXPENSE_ROLE, labelKey: `account-role.${EXPENSE_ROLE}`, normalBalance: 'debit' },
    ]),
    declaring('SAL', [
      { role: REVENUE_ROLE, labelKey: `account-role.${REVENUE_ROLE}`, normalBalance: 'credit' },
    ]),
  ];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC', 'FX', 'FIN', 'STK', 'CSH', 'SAL'] }),
    (refusal) => new Error(`The edition would not compose: ${refusal.code}`),
  );

  const clock = manualClock(NOON_IN_DAMASCUS);
  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw new Error(`A subscriber failed: ${String(failure.cause)}`);
    },
  });
  const store = createMemoryStore();

  // How many of the transactions that begin next are made to lose: another
  // transaction commits a fresh key between their `begin` and their commit,
  // so a transaction that scans the store is refused at its commit.
  let racesToLose = 0;
  const driver: SessionDriver<MemorySession> = {
    async begin(context) {
      const session = await store.driver.begin(context);
      if (racesToLose > 0) {
        racesToLose -= 1;
        const other = await store.driver.begin(context);
        other.put(`fixture/race/${String(racesToLose)}`, { lost: true });
        await store.driver.commit(other);
      }
      return session;
    },
    commit: (session) => store.driver.commit(session),
    rollback: (session) => store.driver.rollback(session),
  };
  const transactor = createTransactor({
    driver,
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
  held.set(
    tenant,
    ['EUR', 'SYP', 'TRY', 'USD'].map((code) => currencyNamed(tenant, code)),
  );
  held.set(otherTenant, [currencyNamed(otherTenant, 'USD')]);

  return {
    registry,
    store,
    chart: registry.require(ChartOfAccounts),
    admin: registry.require(ChartAdministration),
    clock,
    tenant,
    by: commandContext({ tenant, actor: newId<'user'>() }),
    system: systemContext(tenant),
    otherTenant,
    byOther: commandContext({ tenant: otherTenant, actor: newId<'user'>() }),
    answers(
      next: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean,
    ): void {
      decide = next;
    },
    currencies: (of: Id<'tenant'> = tenant) => [...(held.get(of) ?? [])],
    withdrawCurrency(code) {
      held.set(
        tenant,
        (held.get(tenant) ?? []).map((one) =>
          one.code === code ? { ...one, enabled: false } : one,
        ),
      );
    },
    forgetCurrencies(of = tenant) {
      held.set(of, []);
    },
    async defineCurrency(code, options = {}) {
      const of = options.tenant ?? tenant;
      const currency = currencyNamed(of, code);
      held.set(of, [...(held.get(of) ?? []), currency]);
      // Through the transactor, as the real `FX` publishes: the event is
      // delivered once this command has committed, and `FIN`'s handler runs a
      // command of its own after it.
      await transactor.run(systemContext(of), (uow) => {
        uow.publish(CurrencyDefined, { currency });
        // Armed inside this transaction, so that the next one to begin — the
        // subscriber's, after this commit — is the one that loses.
        if (options.raced === true) racesToLose = 1;
        return Promise.resolve();
      });
    },
  };
}
