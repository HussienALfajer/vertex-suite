import { describe, expect, it } from 'vitest';
import { Catalogue, type Item, type ItemId } from '@vertex/cat/contract';
import type { BranchId, TenantId } from '@vertex/contracts';
import {
  Currencies,
  PriceConversion,
  type ConvertedPrice,
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
  type MemorySession,
} from '@vertex/platform';
import { DEFAULT_TIME_ZONE, Organisation, type Branch } from '@vertex/sys/contract';
import {
  DisplayPrices,
  PRC_PERMISSIONS,
  prcModule,
  PriceListAdministration,
  UsdPrices,
  type DisplayPriceTarget,
  type PriceSubject,
} from './index.js';

const value = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));

const AT = instant(1_780_000_000_000);
const TODAY = localDateFrom(2026, 5, 28);

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
function installed() {
  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();
  const permitted = new Set<string>([
    ...Object.values(PRC_PERMISSIONS.list),
    ...Object.values(PRC_PERMISSIONS.price),
    ...Object.values(PRC_PERMISSIONS.display),
    'cat.item.view',
  ]);
  /** A branch a person is confined away from: every right asked there is refused. */
  const barred = new Set<string>();
  const asked: { right: string; where: AuthorisationScope | undefined }[] = [];
  const items = new Map<string, Item>();
  const branches = new Map<BranchId, Branch>();
  const rates = new Map<BranchId, Rate>();
  let conversions = 0;
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
        provideContract(PriceConversion, (): PriceConversion => ({
          convert: async (by, id, amount, into): Promise<Result<ConvertedPrice, RateRefusal>> => {
            conversions += 1;
            const during = meanwhile;
            meanwhile = null;
            if (during !== null) await during();
            const branch = branches.get(id);
            if (branch?.tenant !== by.tenant) return refuse('fx.branch-not-found', { branch: id });
            if (!branch.active) return refuse('fx.branch-inactive', { branch: id });
            const rate = rates.get(id);
            if (rate === undefined)
              return refuse('fx.rate-missing', { branch: id, currency: into, day: '2026-05-28' });
            const exact = amount.amount.times(new Dec(rate.buy));
            const settled = exact.dividedBy(10).toDecimalPlaces(0, Dec.ROUND_HALF_UP).times(10);
            return ok({
              amount: money(settled, into),
              exact: money(exact, into),
              residual: {
                account: 'fx.rounding',
                point: 'settlement',
                amount: money(exact.minus(settled), into),
              },
              rate: {
                currency: into,
                functional: 'USD',
                side: 'buy',
                rate: rate.buy,
                revision: rate.revision,
                sequence: rate.sequence,
                day: TODAY,
                recordedAt: AT,
              },
              rounding: { increment: '10', mode: 'half-up' },
            });
          },
        })),
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
            }) as unknown as Catalogue,
        ),
      ],
    }),
    prcModule<MemorySession>(),
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

type Harness = ReturnType<typeof installed>;

async function priced(h: Harness, subject: PriceSubject, amount: string, expectedRevision = 0) {
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
async function freeze(h: Harness, target: DisplayPriceTarget, reason = 'Shelf price') {
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

async function aPricedItem(h: Harness) {
  const lists = value(await h.admin.seed(h.system));
  const item = h.item(h.by.tenant, 2);
  const subject: PriceSubject = { list: lists[0]!.id, item: item.id, unit: item.units[0]!.id };
  const branch = h.openBranch();
  await priced(h, subject, '1.25');
  return { lists, item, subject, branch, target: { branch, subject } };
}

describe('PRC-02 PRC-03 a frozen SYP display price derived from the USD price', () => {
  it('previews the exact SYP figure at the branch buy rate, settled once, and writes nothing', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');

    const preview = value(await h.display.preview(h.by, target));

    // 1.25 × 13,100 = 16,375, settled half-up onto the ten-pound note.
    expect(preview).toMatchObject({
      ...target,
      currency: 'SYP',
      proposed: '16380',
      current: null,
      basis: {
        usdAmount: '1.25',
        usdRevision: 1,
        exact: '16375',
        residual: '-5',
        rounding: { increment: '10', mode: 'half-up' },
        rate: { side: 'buy', rate: '13100', revision, sequence: 1, day: '2026-05-28' },
      },
    });
    expect(value(await h.display.get(h.by, target))).toMatchObject({
      price: null,
      status: 'not-frozen',
    });
    expect(value(await h.display.history(h.by, { item: target.subject.item })).entries).toEqual([]);
  });

  it('freezes the approved figure with one complete audit entry', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');

    const frozen = await freeze(h, target, 'First shelf price');

    expect(frozen).toMatchObject({
      tenant: h.by.tenant,
      ...target,
      amount: '16380',
      currency: 'SYP',
      revision: 1,
      approvedBy: h.by.actor,
      approvedAt: AT,
      reason: 'First shelf price',
      basis: { usdAmount: '1.25', usdRevision: 1, rate: { revision } },
    });
    expect(value(await h.display.get(h.by, target))).toMatchObject({
      price: frozen,
      usd: { amount: '1.25', revision: 1 },
      status: 'frozen',
    });
    const history = value(await h.display.history(h.by, { branch: target.branch }));
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toEqual({
      tenant: h.by.tenant,
      ...target,
      operation: expect.any(String) as string,
      actor: h.by.actor,
      at: AT,
      currency: 'SYP',
      oldAmount: null,
      oldBasis: null,
      newAmount: '16380',
      basis: frozen.basis,
      reason: 'First shelf price',
      revision: 1,
      sequence: 1,
    });
  });

  it('PRC-03 keeps the frozen figure when today’s rate changes, and reads it without asking FX', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);

    h.rate(target.branch, '15000');
    const before = h.conversions();
    const state = value(await h.display.get(h.by, target));
    const listed = value(await h.display.forItem(h.by, target.branch, target.subject.item));
    value(await h.display.history(h.by, { item: target.subject.item }));

    expect(h.conversions()).toBe(before);
    expect(state.price).toEqual(frozen);
    expect(state.status).toBe('frozen');
    expect(listed.find((one) => one.subject.unit === target.subject.unit)?.price).toEqual(frozen);
  });

  it('PRC-03 PRC-11 recalculates only when a person approves it, as a new revision beside the old', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const first = h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);
    const second = h.rate(target.branch, '15000');

    const preview = value(await h.display.preview(h.by, target));
    expect(preview.current).toEqual(frozen);
    expect(preview.proposed).toBe('18750');
    const recalculated = await freeze(h, target, 'Rate moved');

    expect(recalculated).toMatchObject({
      amount: '18750',
      revision: 2,
      basis: { rate: { revision: second } },
    });
    const history = value(await h.display.history(h.by, { item: target.subject.item }));
    expect(history.entries.map((one) => one.revision)).toEqual([2, 1]);
    expect(history.entries[0]).toMatchObject({
      oldAmount: '16380',
      oldBasis: { rate: { revision: first } },
      newAmount: '18750',
      basis: { rate: { revision: second } },
      reason: 'Rate moved',
    });
    // The first entry is exactly as it was written.
    expect(history.entries[1]).toMatchObject({ newAmount: '16380', oldAmount: null });
  });

  it('PRC-02 keeps the frozen figure when the USD price changes, and says it was frozen from an older one', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);

    await priced(h, target.subject, '2.00', 1);

    const state = value(await h.display.get(h.by, target));
    expect(state.price).toEqual(frozen);
    expect(state.usd).toMatchObject({ amount: '2', revision: 2 });
    expect(state.status).toBe('usd-changed');
    expect(state.price?.basis).toMatchObject({ usdAmount: '1.25', usdRevision: 1 });
    expect(value(await h.display.preview(h.by, target)).basis).toMatchObject({
      usdAmount: '2',
      usdRevision: 2,
    });
  });

  it('keeps two branches, two units and two lists apart', async () => {
    const h = installed();
    const { lists, item, subject, branch } = await aPricedItem(h);
    const damascus = h.openBranch();
    const carton = { ...subject, unit: item.units[1]!.id };
    const wholesale = { ...subject, list: lists[2]!.id };
    await priced(h, carton, '15.00');
    await priced(h, wholesale, '1.10');
    h.rate(branch, '13100');
    h.rate(damascus, '13300');

    const aleppoPiece = await freeze(h, { branch, subject });
    const damascusPiece = await freeze(h, { branch: damascus, subject });

    expect(aleppoPiece.amount).toBe('16380');
    expect(damascusPiece.amount).toBe('16630');
    for (const other of [carton, wholesale]) {
      expect(value(await h.display.get(h.by, { branch, subject: other }))).toMatchObject({
        price: null,
        status: 'not-frozen',
      });
    }
    expect(value(await h.display.get(h.by, { branch: damascus, subject })).price).toEqual(
      damascusPiece,
    );
    expect(
      value(await h.display.forItem(h.by, branch, item.id)).filter((one) => one.price !== null),
    ).toEqual([expect.objectContaining({ subject, price: aleppoPiece })]);
    expect(
      value(await h.display.history(h.by, { branch: damascus })).entries.map((one) => one.branch),
    ).toEqual([damascus]);
  });
});

describe('PRC-02 PRC-03 refusals leave the last frozen price and its history as they were', () => {
  it('refuses a missing rate for today, and never reaches back to the last one', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);
    h.noRate(target.branch);

    expect(await h.display.preview(h.by, target)).toMatchObject({
      ok: false,
      error: {
        code: 'prc.rate-missing',
        values: { branch: target.branch, currency: 'SYP', day: '2026-05-28' },
      },
    });
    expect(
      await h.display.approve(h.by, {
        ...target,
        expectedRevision: 1,
        proposed: '16380',
        usdRevision: 1,
        rateRevision: frozen.basis.rate.revision,
        reason: 'Retry',
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.rate-missing' } });
    expect(value(await h.display.get(h.by, target)).price).toEqual(frozen);
    expect(value(await h.display.history(h.by, {})).entries).toHaveLength(1);
  });

  it('refuses an unpriced subject rather than deriving from zero or another unit', async () => {
    const h = installed();
    const { item, subject, branch } = await aPricedItem(h);
    h.rate(branch, '13100');
    const carton = { branch, subject: { ...subject, unit: item.units[1]!.id } };

    expect(await h.display.preview(h.by, carton)).toMatchObject({
      ok: false,
      error: { code: 'prc.usd-price-missing' },
    });
    expect(value(await h.display.get(h.by, carton))).toMatchObject({
      usd: null,
      price: null,
      status: 'unpriced',
    });
  });

  it('refuses an unknown, withdrawn or foreign branch, and a foreign subject', async () => {
    const h = installed();
    const { subject, branch, target } = await aPricedItem(h);
    h.rate(branch, '13100');
    const frozen = await freeze(h, target);
    const theirs = h.openBranch(h.other.tenant);

    for (const elsewhere of [newId<'branch'>(), theirs])
      expect(await h.display.preview(h.by, { branch: elsewhere, subject })).toMatchObject({
        ok: false,
        error: { code: 'prc.branch-not-found' },
      });
    expect(await h.display.get(h.by, { branch: theirs, subject })).toMatchObject({
      ok: false,
      error: { code: 'prc.branch-not-found' },
    });
    value(await h.admin.seed(h.otherSystem));
    expect(await h.display.get(h.other, { branch: theirs, subject })).toMatchObject({
      ok: false,
      error: { code: 'prc.list-not-found' },
    });
    expect(value(await h.display.history(h.other, {})).entries).toEqual([]);

    h.shutBranch(branch);
    const before = h.conversions();
    expect(await h.display.preview(h.by, target)).toMatchObject({
      ok: false,
      error: { code: 'prc.branch-inactive' },
    });
    // Refused through SYS before FX is asked for a rate at a branch that sets no prices.
    expect(h.conversions()).toBe(before);
    // A withdrawn branch's frozen prices are its history, and stay readable.
    expect(value(await h.display.get(h.by, target)).price).toEqual(frozen);
  });

  it('refuses to preview on a withdrawn list, whose frozen price stays readable', async () => {
    const h = installed();
    const { target, subject } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);
    value(await h.admin.deactivate(h.by, subject.list));
    const before = h.conversions();

    expect(await h.display.preview(h.by, target)).toMatchObject({
      ok: false,
      error: { code: 'prc.list-inactive' },
    });
    expect(h.conversions()).toBe(before);
    expect(value(await h.display.get(h.by, target)).price).toEqual(frozen);
  });

  it('refuses malformed commands before anything is read', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');
    const base = {
      ...target,
      expectedRevision: 0,
      proposed: '16380',
      usdRevision: 1,
      rateRevision: revision,
      reason: 'Shelf price',
      operation: newId<'price-operation'>(),
    };
    const refusedWith = async (command: unknown, code: string): Promise<void> => {
      expect(
        await h.display.approve(h.by, command as Parameters<typeof h.display.approve>[1]),
      ).toMatchObject({ ok: false, error: { code } });
    };
    await refusedWith({ ...base, reason: '   ' }, 'prc.reason-required');
    await refusedWith({ ...base, operation: 'nope' }, 'prc.operation-invalid');
    await refusedWith({ ...base, expectedRevision: -1 }, 'prc.revision-stale');
    await refusedWith({ ...base, branch: 7 }, 'prc.branch-not-found');
    await refusedWith({ ...base, subject: null }, 'prc.subject-invalid');
    await refusedWith({ ...base, proposed: '1e3' }, 'prc.amount-invalid');
    await refusedWith(null, 'prc.subject-invalid');
    expect(value(await h.display.get(h.by, target)).price).toBeNull();
  });
});

describe('PRC-03 PRC-11 approvals under concurrency, retry and failure', () => {
  it('refuses a stale revision, and lets only one of two concurrent approvals win', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const first = value(await h.display.preview(h.by, target));
    const approval = (reason: string) =>
      h.display.approve(h.by, {
        ...target,
        expectedRevision: 0,
        proposed: first.proposed,
        usdRevision: 1,
        rateRevision: first.basis.rate.revision,
        reason,
        operation: newId<'price-operation'>(),
      });

    const raced = await Promise.all([approval('Mine'), approval('Theirs')]);

    expect(raced.filter((one) => one.ok)).toHaveLength(1);
    expect(raced.find((one) => !one.ok)).toMatchObject({
      error: { code: 'prc.revision-stale', values: { currentRevision: 1 } },
    });
    expect(await approval('Late')).toMatchObject({
      ok: false,
      error: { code: 'prc.revision-stale' },
    });
    expect(value(await h.display.history(h.by, {})).entries).toHaveLength(1);
  });

  it('answers an identical retry with the first result, and refuses the same operation reused', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');
    const command = {
      ...target,
      expectedRevision: 0,
      proposed: '16380',
      usdRevision: 1,
      rateRevision: revision,
      reason: 'Shelf price',
      operation: newId<'price-operation'>(),
    };

    const first = value(await h.display.approve(h.by, command));
    // Even after the rate moved: a retry is the same approval, not a new one.
    h.rate(target.branch, '15000');
    expect(value(await h.display.approve(h.by, command))).toEqual(first);
    expect(await h.display.approve(h.by, { ...command, reason: 'Other' })).toMatchObject({
      ok: false,
      error: { code: 'prc.operation-reused' },
    });
    expect(value(await h.display.history(h.by, {})).entries).toHaveLength(1);
  });

  it('refuses to freeze a figure nobody reviewed when the rate or the dollar price moved after preview', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const reviewed = value(await h.display.preview(h.by, target));
    const approve = () =>
      h.display.approve(h.by, {
        ...target,
        expectedRevision: 0,
        proposed: reviewed.proposed,
        usdRevision: reviewed.basis.usdRevision,
        rateRevision: reviewed.basis.rate.revision,
        reason: 'Reviewed',
        operation: newId<'price-operation'>(),
      });

    h.rate(target.branch, '13200');
    expect(await approve()).toMatchObject({
      ok: false,
      error: { code: 'prc.display-basis-changed' },
    });
    h.rate(target.branch, '13100');
    await priced(h, target.subject, '1.30', 1);
    expect(await approve()).toMatchObject({
      ok: false,
      error: { code: 'prc.display-basis-changed' },
    });
    expect(value(await h.display.get(h.by, target)).price).toBeNull();
  });

  it('refuses a dollar price edited between the calculation and the commit', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');
    // The dollar price moves while FX is still restating the one read a moment
    // earlier: the figure being frozen was derived from a dollar price that is
    // no longer current, and only the approving transaction can see that.
    h.whileConverting(() => priced(h, target.subject, '1.30', 1));

    expect(
      await h.display.approve(h.by, {
        ...target,
        expectedRevision: 0,
        proposed: '16380',
        usdRevision: 1,
        rateRevision: revision,
        reason: 'Raced',
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.display-basis-changed' } });
    expect(value(await h.display.get(h.by, target))).toMatchObject({
      price: null,
      usd: { revision: 2 },
    });
  });

  it('commits the price and its audit entry together, or neither', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);
    h.rate(target.branch, '15000');

    h.failNextCommit();
    await expect(freeze(h, target, 'Lost to the disk')).rejects.toThrow('disk');

    expect(value(await h.display.get(h.by, target)).price).toEqual(frozen);
    expect(value(await h.display.history(h.by, {})).entries).toHaveLength(1);
    expect(await freeze(h, target, 'Second attempt')).toMatchObject({ revision: 2 });
  });
});

describe('PRC-02 PRC-03 PRC-11 who may read and approve a display price, and where', () => {
  it('asks each right at the branch, and refuses a person confined elsewhere', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    await freeze(h, target);
    h.asked.length = 0;

    value(await h.display.get(h.by, target));
    expect(h.asked).toContainEqual({
      right: PRC_PERMISSIONS.display.view,
      where: { branch: target.branch },
    });

    h.bar(target.branch);
    for (const refused of [
      await h.display.get(h.by, target),
      await h.display.forItem(h.by, target.branch, target.subject.item),
      await h.display.preview(h.by, target),
      await h.display.history(h.by, { branch: target.branch }),
    ])
      expect(refused).toMatchObject({ ok: false, error: { code: 'prc.not-permitted' } });
  });

  it('PRC-11 pages the audit newest first without repeating or skipping an entry', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    for (const buy of ['13100', '13200', '13300']) {
      h.rate(target.branch, buy);
      await freeze(h, target, `At ${buy}`);
    }

    const first = value(await h.display.history(h.by, { branch: target.branch, limit: 2 }));
    expect(first.entries.map((one) => one.revision)).toEqual([3, 2]);
    expect(first.next).toBe(2);
    const second = value(
      await h.display.history(h.by, { branch: target.branch, limit: 2, before: first.next! }),
    );
    expect(second).toMatchObject({ entries: [{ revision: 1, reason: 'At 13100' }], next: null });
    expect(await h.display.history(h.by, { limit: 101 })).toMatchObject({
      ok: false,
      error: { code: 'prc.history-query-invalid' },
    });
    expect(
      await h.display.history(h.by, { branch: 'nope' } as unknown as { branch: never }),
    ).toMatchObject({ ok: false, error: { code: 'prc.history-query-invalid' } });
  });

  it('asks a history of one branch at that branch, and one of every branch at the tenant-wide place', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.asked.length = 0;

    value(await h.display.history(h.by, { branch: target.branch }));
    value(await h.display.history(h.by, {}));

    // SEC admits a question with no branch only for a tenant-wide grant, so a
    // person confined to branches reads their branches' history by naming one.
    expect(h.asked).toContainEqual({
      right: PRC_PERMISSIONS.price.history,
      where: { branch: target.branch },
    });
    expect(h.asked).toContainEqual({ right: PRC_PERMISSIONS.price.history, where: undefined });
  });

  it('refuses each operation without its right, and a system context with no person to approve', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const preview = value(await h.display.preview(h.by, target));
    expect(
      await h.display.approve(h.system, {
        ...target,
        expectedRevision: 0,
        proposed: preview.proposed,
        usdRevision: 1,
        rateRevision: preview.basis.rate.revision,
        reason: 'Nobody',
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.not-permitted' } });

    h.withhold(PRC_PERMISSIONS.display.edit);
    expect(await h.display.preview(h.by, target)).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
    h.withhold(PRC_PERMISSIONS.price.history);
    expect(await h.display.history(h.by, {})).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
    h.withhold(PRC_PERMISSIONS.display.view);
    expect(await h.display.get(h.by, target)).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
  });
});
