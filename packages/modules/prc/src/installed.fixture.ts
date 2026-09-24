/**
 * `PRC` installed over stand-ins for `SYS`, `SEC`, `FX` and `CAT` — shared by
 * the display-price and rate-review suites, which ask the same questions of
 * the same neighbours.
 */
import { Catalogue, type Item, type ItemId } from '@vertex/cat/contract';
import type { BranchId, TenantId } from '@vertex/contracts';
import {
  Currencies,
  PriceConversion,
  type ConvertedPrice,
  type PriceRate,
  type RateRefusal,
  type RateRevisionId,
} from '@vertex/fx/contract';
import {
  Dec,
  instant,
  localDateFrom,
  manualClock,
  money,
  newId,
  ok,
  orThrow,
  refuse,
  type Money,
  type Result,
} from '@vertex/kernel';
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
  type DomainEvent,
  type MemorySession,
} from '@vertex/platform';
import { DEFAULT_TIME_ZONE, Organisation, type Branch } from '@vertex/sys/contract';
import {
  DisplayPrices,
  PRC_PERMISSIONS,
  prcModule,
  PriceListAdministration,
  RateReviewMonitor,
  RateReviewPublished,
  RateReviewRaised,
  RateReviews,
  UsdPrices,
  type DisplayPrice,
  type DisplayPriceTarget,
  type PriceList,
  type PriceSubject,
  type UsdPrice,
} from './index.js';

export const value = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));

export const AT = instant(1_780_000_000_000);
export const TODAY = localDateFrom(2026, 5, 28);

/** One branch's rate for today, as `FX` would read it: a revision and its buy side. */
interface Rate {
  readonly buy: string;
  readonly revision: RateRevisionId;
  readonly sequence: number;
}

/**
 * `PRC` installed over stand-ins for `SYS`, `FX` and `CAT`, which is all
 * `modules.md` §4.1 lets it see.
 *
 * The `FX` stand-in answers `PriceConversion` from a table of today's buy rates
 * and settles onto the seeded ten-pound note. It proves what `PRC` does with an
 * answer, not the arithmetic: that is `FX`'s, and `fx/src/pricing.test.ts`
 * proves it against the real module. It counts every conversion, so a read that
 * reached for today's rate would be caught here.
 */
export interface InstallOptions {
  /** Prices per step of a review scan or batch; small here so steps can be counted. */
  readonly chunk?: number;
}

// The harness is whatever this builds; writing its type out beside it would be
// a second copy for the two suites to drift from.
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
function install(options: InstallOptions = {}) {
  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();
  const permitted = new Set<string>([
    ...Object.values(PRC_PERMISSIONS.list),
    ...Object.values(PRC_PERMISSIONS.price),
    ...Object.values(PRC_PERMISSIONS.display),
    ...Object.values(PRC_PERMISSIONS.review),
    'cat.item.view',
  ]);
  /** A branch a person is confined away from: every right asked there is refused. */
  const barred = new Set<string>();
  const asked: { right: string; where: AuthorisationScope | undefined }[] = [];
  const items = new Map<string, Item>();
  const branches = new Map<BranchId, Branch>();
  const rates = new Map<BranchId, Rate>();
  let conversions = 0;
  /** Every question put to FX, of any kind: a normal read asks none. */
  let fxCalls = 0;
  /** The note prices settle onto: the owner may revise it (`FX-07`). */
  let step = '10';
  let meanwhileBulk: (() => Promise<unknown>) | null = null;
  /** Something that happens while FX is working out a price, once. */
  let meanwhile: (() => Promise<unknown>) | null = null;
  const Authority = contractKey<Authoriser>('sec.authorisation');
  const modules = [
    defineModule<MemorySession>({
      code: 'SYS',
      labelKey: 'module.sys',
      provides: [
        provideContract(
          Organisation,
          () =>
            ({
              branch: (by: CommandContext, id: BranchId) => {
                const found = branches.get(id);
                return Promise.resolve(found?.tenant === by.tenant ? found : null);
              },
              branches: (by: CommandContext) =>
                Promise.resolve([...branches.values()].filter((one) => one.tenant === by.tenant)),
            }) as unknown as Organisation,
        ),
      ],
    }),
    defineModule<MemorySession>({
      code: 'SEC',
      labelKey: 'module.sec',
      provides: [
        provideContract(Authority, () => ({
          may: (_by, right, where) => {
            asked.push({ right, where });
            return Promise.resolve(
              permitted.has(right) && !(where?.branch !== undefined && barred.has(where.branch)),
            );
          },
        })),
      ],
    }),
    defineModule<MemorySession>({
      code: 'FX',
      labelKey: 'module.fx',
      provides: [
        provideContract(Currencies, (): Currencies => {
          const usd = (by: CommandContext) => ({
            tenant: by.tenant,
            code: 'USD',
            symbol: '$',
            decimals: 2,
            roundingIncrement: '0.01',
            roundingMode: 'half-up' as const,
            enabled: true,
          });
          return {
            currency: (by, code) => Promise.resolve(code === 'USD' ? usd(by) : null),
            currencies: (by) => Promise.resolve([usd(by)]),
            functional: (by) => Promise.resolve(usd(by)),
          };
        }),
        provideContract(PriceConversion, (): PriceConversion => {
          /** Today's rate at a branch, refused as FX refuses it. */
          const rateAt = (
            by: CommandContext,
            id: BranchId,
            into: string,
          ): Result<PriceRate, RateRefusal> => {
            const branch = branches.get(id);
            if (branch?.tenant !== by.tenant) return refuse('fx.branch-not-found', { branch: id });
            if (!branch.active) return refuse('fx.branch-inactive', { branch: id });
            const rate = rates.get(id);
            if (rate === undefined)
              return refuse('fx.rate-missing', { branch: id, currency: into, day: '2026-05-28' });
            return ok({
              currency: into,
              functional: 'USD',
              side: 'buy',
              rate: rate.buy,
              revision: rate.revision,
              sequence: rate.sequence,
              day: TODAY,
              recordedAt: AT,
            });
          };
          const settle = (amount: Money, rate: PriceRate): ConvertedPrice => {
            const exact = amount.amount.times(new Dec(rate.rate));
            const settled = exact.dividedBy(step).toDecimalPlaces(0, Dec.ROUND_HALF_UP).times(step);
            return {
              amount: money(settled, rate.currency),
              exact: money(exact, rate.currency),
              residual: {
                account: 'fx.rounding',
                point: 'settlement',
                amount: money(exact.minus(settled), rate.currency),
              },
              rate,
              rounding: { increment: step, mode: 'half-up' },
            };
          };
          return {
            convert: async (by, id, amount, into): Promise<Result<ConvertedPrice, RateRefusal>> => {
              conversions += 1;
              fxCalls += 1;
              const during = meanwhile;
              meanwhile = null;
              if (during !== null) await during();
              const rate = rateAt(by, id, into);
              return rate.ok ? ok(settle(amount, rate.value)) : rate;
            },
            convertAll: async (by, id, amounts, into) => {
              fxCalls += 1;
              const during = meanwhileBulk;
              meanwhileBulk = null;
              if (during !== null) await during();
              const rate = rateAt(by, id, into);
              return rate.ok ? ok(amounts.map((amount) => settle(amount, rate.value))) : rate;
            },
            rate: (by, id, into) => {
              fxCalls += 1;
              return Promise.resolve(rateAt(by, id, into));
            },
          };
        }),
      ],
    }),
    defineModule<MemorySession>({
      code: 'CAT',
      labelKey: 'module.cat',
      dependsOn: ['SYS', 'SEC', 'FX'],
      provides: [
        provideContract(
          Catalogue,
          () =>
            ({
              item: (by: CommandContext, id: ItemId) =>
                Promise.resolve(items.get(`${by.tenant}/${id}`) ?? null),
              items: (by: CommandContext) =>
                Promise.resolve([...items.values()].filter((one) => one.tenant === by.tenant)),
            }) as unknown as Catalogue,
        ),
      ],
    }),
    prcModule<MemorySession>(options.chunk === undefined ? {} : { chunk: options.chunk }),
  ];
  const plan = value(composeEdition(modules, { modules: ['SYS', 'SEC', 'FX', 'CAT', 'PRC'] }));
  const bus = createEventBus({
    onHandlerFailure: ({ cause }) => {
      throw cause;
    },
  });
  const store = createMemoryStore();
  let failNextCommit = false;
  const wrote = new WeakSet<MemorySession>();
  const driver = {
    ...store.driver,
    begin: async (context: CommandContext): Promise<MemorySession> => {
      const session = await store.driver.begin(context);
      const put = session.put.bind(session);
      return Object.assign(session, {
        put: (key: string, record: unknown) => {
          wrote.add(session);
          put(key, record);
        },
      });
    },
    // A storage failure at the moment a write commits: the write is rolled back
    // and the command fails, as a PostgreSQL commit that errors would. A read
    // commits too, and is let through.
    commit: async (session: MemorySession): Promise<void> => {
      if (!failNextCommit || !wrote.has(session)) return store.driver.commit(session);
      failNextCommit = false;
      await store.driver.rollback(session);
      throw new Error('The disk refused the commit.');
    },
  };
  const clock = manualClock(AT);
  const transactor = createTransactor({
    driver,
    bus,
    clock,
    onEffectFailure: ({ cause }) => {
      throw cause;
    },
  });
  /** Events as they were dispatched, in order: what a subscriber would have heard. */
  const heard: DomainEvent[] = [];
  bus.subscribe(RateReviewRaised.name, 'SYS', (event) => {
    heard.push(event);
    return Promise.resolve();
  });
  bus.subscribe(RateReviewPublished.name, 'SYS', (event) => {
    heard.push(event);
    return Promise.resolve();
  });
  /**
   * A process over the same store: what a restart composes. Nothing held in
   * memory by the one before — no event, no cursor — reaches it.
   */
  const compose = () =>
    createRegistry({
      catalogue: modules,
      plan,
      bus: createEventBus({
        onHandlerFailure: ({ cause }) => {
          throw cause;
        },
      }),
      transactor,
      clock,
      authorisedBy: Authority,
    });
  const registry = createRegistry({
    catalogue: modules,
    plan,
    bus,
    transactor,
    clock,
    authorisedBy: Authority,
  });
  const openBranch = (forTenant: TenantId = tenant): BranchId => {
    const branch: Branch = {
      id: newId<'branch'>(),
      tenant: forTenant,
      company: newId<'company'>(),
      name: 'Aleppo',
      address: '',
      point: null,
      timeZone: DEFAULT_TIME_ZONE,
      active: true,
    };
    branches.set(branch.id, branch);
    return branch.id;
  };
  return {
    display: registry.require(DisplayPrices),
    usd: registry.require(UsdPrices),
    admin: registry.require(PriceListAdministration),
    clock,
    store,
    by: commandContext({ tenant, actor: newId<'user'>() }),
    other: commandContext({ tenant: otherTenant, actor: newId<'user'>() }),
    system: systemContext(tenant),
    otherSystem: systemContext(otherTenant),
    openBranch,
    shutBranch: (id: BranchId) => {
      const branch = branches.get(id);
      if (branch) branches.set(id, { ...branch, active: false });
    },
    /** Records or corrects today's buy rate at a branch. */
    rate: (branch: BranchId, buy: string): RateRevisionId => {
      const revision = newId<'rate-revision'>();
      rates.set(branch, { buy, revision, sequence: (rates.get(branch)?.sequence ?? 0) + 1 });
      return revision;
    },
    /** The branch's day turns over with nothing recorded yet. */
    noRate: (branch: BranchId) => rates.delete(branch),
    conversions: () => conversions,
    fxCalls: () => fxCalls,
    /** The owner revises the pound's settlement step. */
    settleTo: (increment: string) => {
      step = increment;
    },
    /** Something that happens while FX restates a batch, once. */
    whileConvertingAll: (work: () => Promise<unknown>) => {
      meanwhileBulk = work;
    },
    /** The catalogue no longer has this item. */
    forget: (item: ItemId, forTenant: TenantId = tenant) => items.delete(`${forTenant}/${item}`),
    get reviews(): RateReviews {
      return registry.require(RateReviews);
    },
    get monitor(): RateReviewMonitor {
      return registry.require(RateReviewMonitor);
    },
    /** Drives the monitor until it has nothing left, and says how many steps it took. */
    settle: async (forTenant: TenantId = tenant) => {
      const monitor = registry.require(RateReviewMonitor);
      for (let steps = 1; steps < 10_000; steps += 1)
        if (!(await monitor.drive(systemContext(forTenant))).more) return steps;
      throw new Error('The monitor never settled.');
    },
    tenant,
    registry,
    heard,
    /** The same store, composed again, as a process started after a crash would find it. */
    restart: () => {
      const again = compose();
      return {
        reviews: again.require(RateReviews),
        monitor: again.require(RateReviewMonitor),
        display: again.require(DisplayPrices),
      };
    },
    /** A write straight to the store, for states no command can reach. */
    write: (work: (session: MemorySession) => void) =>
      transactor.run(systemContext(tenant), (uow) => {
        work(uow.session);
        return Promise.resolve();
      }),
    whileConverting: (work: () => Promise<unknown>) => {
      meanwhile = work;
    },
    asked,
    failNextCommit: () => {
      failNextCommit = true;
    },
    withhold: (right: string) => permitted.delete(right),
    bar: (branch: BranchId) => barred.add(branch),
    item: (forTenant: TenantId = tenant, units = 1): Item => {
      const id = newId<'item'>();
      const item: Item = {
        tenant: forTenant,
        id,
        name: 'Item',
        code: null,
        category: newId<'category'>(),
        kind: 'standard',
        baseUnit: { code: 'pc', kind: 'count', decimals: 0 },
        units: Array.from({ length: units }, (_, index) => ({
          id: newId<'item-unit'>(),
          item: id,
          unit: { code: index === 0 ? 'pc' : 'carton', kind: 'count' as const, decimals: 0 },
          basePerUnit: index === 0 ? '1' : '12',
        })),
        barcodes: [],
        status: 'active',
        statusReason: null,
        statusHistory: [],
      };
      items.set(`${forTenant}/${id}`, item);
      return item;
    },
  };
}

export type Harness = ReturnType<typeof install>;

export const installed: (options?: InstallOptions) => Harness = install;

function first<T>(all: readonly T[]): T {
  const [one] = all;
  if (one === undefined) throw new Error('Expected at least one.');
  return one;
}

export async function priced(
  h: Harness,
  subject: PriceSubject,
  amount: string,
  expectedRevision = 0,
): Promise<UsdPrice> {
  return value(
    await h.usd.set(h.by, {
      subject,
      amount: { amount, currency: 'USD' },
      expectedRevision,
      reason: 'Dollar price',
      operation: newId<'price-operation'>(),
    }),
  );
}

/** Previews, then approves exactly what was previewed. */
export async function freeze(
  h: Harness,
  target: DisplayPriceTarget,
  reason = 'Shelf price',
): Promise<DisplayPrice> {
  const preview = value(await h.display.preview(h.by, target));
  return value(
    await h.display.approve(h.by, {
      ...target,
      expectedRevision: preview.current?.revision ?? 0,
      proposed: preview.proposed,
      usdRevision: preview.basis.usdRevision,
      rateRevision: preview.basis.rate.revision,
      reason,
      operation: newId<'price-operation'>(),
    }),
  );
}

export interface PricedItem {
  readonly lists: readonly PriceList[];
  readonly item: Item;
  readonly subject: PriceSubject;
  readonly branch: BranchId;
  readonly target: DisplayPriceTarget;
}

export async function aPricedItem(h: Harness): Promise<PricedItem> {
  const lists = value(await h.admin.seed(h.system));
  const item = h.item(h.by.tenant, 2);
  const subject: PriceSubject = {
    list: first(lists).id,
    item: item.id,
    unit: first(item.units).id,
  };
  const branch = h.openBranch();
  await priced(h, subject, '1.25');
  return { lists, item, subject, branch, target: { branch, subject } };
}
