import { describe, expect, it } from 'vitest';
import { Catalogue, type Item, type ItemId } from '@vertex/cat/contract';
import { Currencies } from '@vertex/fx/contract';
import type { TenantId } from '@vertex/contracts';
import { instant, newId, orThrow, type Result } from '@vertex/kernel';
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
  type Authoriser,
  type CommandContext,
  type MemorySession,
} from '@vertex/platform';
import {
  prcModule,
  PriceLists,
  PriceListAdministration,
  PRC_PERMISSIONS,
  UsdPrices,
} from './index.js';

const value = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));

function installed() {
  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();
  const permitted = new Set<string>([
    ...Object.values(PRC_PERMISSIONS.list),
    ...Object.values(PRC_PERMISSIONS.price),
  ]);
  permitted.add('cat.item.view');
  const items = new Map<string, Item>();
  const Authority = contractKey<Authoriser>('sec.authorisation');
  const modules = [
    defineModule<MemorySession>({ code: 'SYS', labelKey: 'module.sys' }),
    defineModule<MemorySession>({
      code: 'SEC',
      labelKey: 'module.sec',
      provides: [
        provideContract(Authority, () => ({
          may: (_by, right) => Promise.resolve(permitted.has(right)),
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
  const clock = { now: () => instant(1_780_000_000_000) };
  const transactor = createTransactor({
    driver: store.driver,
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
  return {
    read: registry.require(PriceLists),
    prices: registry.require(UsdPrices),
    admin: registry.require(PriceListAdministration),
    registerItem: (forTenant: TenantId): Item => {
      const id = newId<'item'>();
      const item: Item = {
        tenant: forTenant,
        id,
        name: 'Item',
        code: null,
        category: newId<'category'>(),
        kind: 'standard',
        baseUnit: { code: 'pc', kind: 'count', decimals: 0 },
        units: [
          {
            id: id as unknown as Item['units'][number]['id'],
            item: id,
            unit: { code: 'pc', kind: 'count', decimals: 0 },
            basePerUnit: '1',
          },
        ],
        barcodes: [],
        status: 'active',
        statusReason: null,
        statusHistory: [],
      };
      items.set(`${forTenant}/${id}`, item);
      return item;
    },
    registerCarton: (item: Item): Item => {
      const carton = newId<'item-unit'>();
      const revised = {
        ...item,
        units: [
          ...item.units,
          {
            id: carton,
            item: item.id,
            unit: { code: 'carton', kind: 'count' as const, decimals: 0 },
            basePerUnit: '12',
          },
        ],
      };
      items.set(`${item.tenant}/${item.id}`, revised);
      return revised;
    },
    primeExistingTenant: () =>
      transactor.run(systemContext(tenant), (uow) => {
        uow.session.put(`sys/existing/${tenant}`, { active: true });
        return Promise.resolve();
      }),
    by: commandContext({ tenant, actor: newId<'user'>() }),
    other: commandContext({ tenant: otherTenant, actor: newId<'user'>() }),
    system: systemContext(tenant),
    otherSystem: systemContext(otherTenant),
    withhold: (right: string) => permitted.delete(right),
  };
}

describe('PRC-01 price lists and price subject foundation', () => {
  it('seeds exactly three stable list identities per tenant, including after rerun', async () => {
    const h = installed();
    await h.primeExistingTenant();
    const first = value(await h.admin.seed(h.system));
    expect(first.map((list) => list.code)).toEqual(['retail', 'half-wholesale', 'wholesale']);
    expect(value(await h.admin.seed(h.system))).toEqual(first);
    expect(await h.read.list(h.by)).toEqual(first);
    const other = value(await h.admin.seed(h.otherSystem));
    expect(other).toHaveLength(3);
    expect(other.map((one) => one.id)).not.toEqual(first.map((one) => one.id));
    expect(await h.read.list(h.other)).toEqual(other);
  });

  it('creates a fourth list and immediately reads it, then preserves identity across rename and deactivation', async () => {
    const h = installed();
    value(await h.admin.seed(h.system));
    const created = value(await h.admin.create(h.by, 'شركاء'));
    expect((await h.read.list(h.by)).map((one) => one.id)).toContain(created.id);
    const renamed = value(await h.admin.rename(h.by, created.id, 'شركاء مميزون'));
    expect(renamed.id).toBe(created.id);
    const inactive = value(await h.admin.deactivate(h.by, created.id));
    expect(inactive.active).toBe(false);
    expect((await h.read.list(h.by)).find((one) => one.id === created.id)).toEqual(inactive);
    expect(await h.read.get(h.by, created.id)).toEqual(inactive);
    expect(await h.admin.create(h.by, 'شركاء مميزون')).toMatchObject({
      ok: false,
      error: { code: 'prc.name-taken' },
    });
    const standard = (await h.read.list(h.by)).find((one) => one.code === 'retail');
    if (standard === undefined) throw new Error('Retail seed missing.');
    value(await h.admin.rename(h.by, standard.id, 'بيع مفرد'));
    expect(value(await h.admin.seed(h.system)).find((one) => one.code === 'retail')).toMatchObject({
      id: standard.id,
      name: 'بيع مفرد',
    });
  });

  it('refuses invalid names and concurrent duplicate creation', async () => {
    const h = installed();
    expect(await h.admin.create(h.by, '  ')).toMatchObject({
      ok: false,
      error: { code: 'prc.name-required' },
    });
    expect(await h.admin.create(h.by, null as unknown as string)).toMatchObject({
      ok: false,
      error: { code: 'prc.name-invalid' },
    });
    value(await h.admin.create(h.by, 'شركاء'));
    expect(await h.admin.create(h.by, ' شركاء ')).toMatchObject({
      ok: false,
      error: { code: 'prc.name-taken' },
    });
    const concurrent = await Promise.all([
      h.admin.create(h.by, 'موزعون'),
      h.admin.create(h.by, 'موزعون'),
    ]);
    expect(concurrent.filter((one) => one.ok)).toHaveLength(1);
    expect(concurrent.filter((one) => !one.ok)).toHaveLength(1);
    expect((await h.read.list(h.by)).filter((one) => one.name === 'موزعون')).toHaveLength(1);
  });

  it('isolates tenants, enforces action rights, and validates the CAT item-unit binding', async () => {
    const h = installed();
    value(await h.admin.seed(h.system));
    const list = value(await h.admin.create(h.by, 'شركاء'));
    expect(await h.read.get(h.other, list.id)).toBeNull();
    expect(await h.admin.rename(h.other, list.id, 'محاولة')).toMatchObject({
      ok: false,
      error: { code: 'prc.list-not-found' },
    });
    const item = h.registerItem(h.by.tenant);
    const second = h.registerItem(h.by.tenant);
    expect(
      await h.read.subject(h.by, { list: list.id, item: item.id, unit: item.units[0]!.id }),
    ).toMatchObject({ ok: true });
    expect(
      await h.read.subject(h.by, { list: list.id, item: item.id, unit: second.units[0]!.id }),
    ).toMatchObject({ ok: false, error: { code: 'prc.unit-not-on-item' } });
    expect(
      await h.read.subject(h.by, null as unknown as Parameters<typeof h.read.subject>[1]),
    ).toMatchObject({ ok: false, error: { code: 'prc.subject-invalid' } });
    expect(
      await h.read.subject(h.other, { list: list.id, item: item.id, unit: item.units[0]!.id }),
    ).toMatchObject({ ok: false });
    h.withhold(PRC_PERMISSIONS.list.create);
    expect(await h.admin.create(h.by, 'ممنوع')).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
  });
});

describe('PRC-01 PRC-02 PRC-11 USD unit pricing and audit', () => {
  it('keeps piece and carton independent in three seeded and a fourth list; absent prices stay null', async () => {
    const h = installed();
    const lists = [
      ...value(await h.admin.seed(h.system)),
      value(await h.admin.create(h.by, 'شركاء')),
    ];
    const item = h.registerCarton(h.registerItem(h.by.tenant));
    for (const [index, list] of lists.entries()) {
      for (const [unitIndex, unit] of item.units.entries()) {
        const subject = { list: list.id, item: item.id, unit: unit.id };
        expect(value(await h.prices.get(h.by, subject))).toBeNull();
        const result = value(
          await h.prices.set(h.by, {
            subject,
            amount: { amount: `${String(index + 1)}${String(unitIndex)}.25`, currency: 'USD' },
            expectedRevision: 0,
            reason: 'Initial',
            operation: newId<'price-operation'>(),
          }),
        );
        expect(result.revision).toBe(1);
      }
    }
    expect(value(await h.prices.forItem(h.by, item.id))).toHaveLength(8);
    expect(
      value(
        await h.prices.get(h.by, { list: lists[0]!.id, item: item.id, unit: item.units[0]!.id }),
      )?.amount,
    ).toBe('10.25');
    expect(
      value(
        await h.prices.get(h.by, { list: lists[0]!.id, item: item.id, unit: item.units[1]!.id }),
      )?.amount,
    ).toBe('11.25');
  });

  it('records immutable ordered revisions, refuses stale updates and deduplicates retries', async () => {
    const h = installed();
    const list = value(await h.admin.seed(h.system))[0]!;
    const item = h.registerItem(h.by.tenant);
    const subject = { list: list.id, item: item.id, unit: item.units[0]!.id };
    const command = {
      subject,
      amount: { amount: '1.25', currency: 'USD' as const },
      expectedRevision: 0,
      reason: 'Initial',
      operation: newId<'price-operation'>(),
    };
    expect(value(await h.prices.set(h.by, command)).revision).toBe(1);
    expect(value(await h.prices.set(h.by, command)).revision).toBe(1);
    expect(await h.prices.set(h.by, { ...command, reason: 'Changed' })).toMatchObject({
      ok: false,
      error: { code: 'prc.operation-reused' },
    });
    const second = {
      ...command,
      amount: { amount: '2.50', currency: 'USD' as const },
      expectedRevision: 1,
      reason: 'Revision',
      operation: newId<'price-operation'>(),
    };
    const third = {
      ...second,
      amount: { amount: '2.25', currency: 'USD' as const },
      reason: 'Correction',
      operation: newId<'price-operation'>(),
    };
    const concurrent = await Promise.all([h.prices.set(h.by, second), h.prices.set(h.by, third)]);
    expect(concurrent.filter((one) => one.ok)).toHaveLength(1);
    expect(concurrent.filter((one) => !one.ok)).toHaveLength(1);
    expect(concurrent.find((one) => !one.ok)).toMatchObject({
      error: { code: 'prc.revision-stale' },
    });
    const winner = concurrent.find((one) => one.ok)!;
    value(
      await h.prices.set(h.by, {
        ...third,
        amount: { amount: '3.00', currency: 'USD' },
        expectedRevision: 2,
        operation: newId<'price-operation'>(),
      }),
    );
    const history = value(await h.prices.history(h.by, { item: item.id, limit: 2 }));
    expect(history.entries).toHaveLength(2);
    expect(history.entries.map((entry) => entry.revision)).toEqual([3, 2]);
    expect(history.entries[0]).toMatchObject({
      actor: h.by.actor,
      at: instant(1_780_000_000_000),
      oldAmount: winner.value.amount,
      newAmount: '3',
      reason: 'Correction',
      sequence: 3,
    });
    expect(history.next).not.toBeNull();
    expect(
      value(
        await h.prices.history(h.by, {
          list: list.id,
          unit: subject.unit,
          from: instant(1_780_000_000_000),
          to: instant(1_780_000_000_000),
          limit: 1,
        }),
      ).entries,
    ).toHaveLength(1);
    expect(
      value(await h.prices.history(h.by, { item: item.id, from: instant(1_780_000_000_001) }))
        .entries,
    ).toHaveLength(0);
    expect(await h.prices.history(h.by, { limit: 101 })).toMatchObject({
      ok: false,
      error: { code: 'prc.history-query-invalid' },
    });
    expect(
      value(await h.prices.history(h.by, { item: item.id, before: history.next!, limit: 2 }))
        .entries,
    ).toMatchObject([
      { revision: 1, oldAmount: null, newAmount: '1.25', reason: 'Initial', sequence: 1 },
    ]);
    expect(value(await h.prices.get(h.by, subject))?.revision).toBe(3);
    expect(winner.value.revision).toBe(2);
  });

  it('refuses invalid values and subjects without partial state, and isolates tenants and rights', async () => {
    const h = installed();
    const list = value(await h.admin.seed(h.system))[0]!;
    const item = h.registerItem(h.by.tenant);
    const other = h.registerItem(h.by.tenant);
    const subject = { list: list.id, item: item.id, unit: item.units[0]!.id };
    const base = {
      subject,
      amount: { amount: '1.00', currency: 'USD' as const },
      expectedRevision: 0,
      reason: 'Initial',
      operation: newId<'price-operation'>(),
    };
    for (const amount of ['0', '-1', '1.234', 'NaN'])
      expect(
        await h.prices.set(h.by, {
          ...base,
          amount: { amount, currency: 'USD' },
          operation: newId<'price-operation'>(),
        }),
      ).toMatchObject({ ok: false, error: { code: 'prc.amount-invalid' } });
    expect(
      await h.prices.set(h.by, { ...base, amount: { amount: '1.00', currency: 'EUR' as 'USD' } }),
    ).toMatchObject({ ok: false, error: { code: 'prc.amount-invalid' } });
    expect(await h.prices.set(h.by, { ...base, reason: '' })).toMatchObject({
      ok: false,
      error: { code: 'prc.reason-required' },
    });
    expect(
      await h.prices.set(h.by, { ...base, subject: { ...subject, unit: other.units[0]!.id } }),
    ).toMatchObject({ ok: false, error: { code: 'prc.unit-not-on-item' } });
    expect(value(await h.prices.get(h.by, subject))).toBeNull();
    expect(value(await h.prices.history(h.by, { item: item.id })).entries).toHaveLength(0);
    value(await h.prices.set(h.by, base));
    expect(await h.prices.get(h.other, subject)).toMatchObject({
      ok: false,
      error: { code: 'prc.list-not-found' },
    });
    expect(value(await h.prices.history(h.other, { item: item.id })).entries).toHaveLength(0);
    expect(
      await h.prices.set(h.other, { ...base, operation: newId<'price-operation'>() }),
    ).toMatchObject({ ok: false, error: { code: 'prc.list-not-found' } });
    value(await h.admin.deactivate(h.by, list.id));
    expect(value(await h.prices.get(h.by, subject))?.amount).toBe('1');
    expect(
      await h.prices.set(h.by, {
        ...base,
        expectedRevision: 1,
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.list-inactive' } });
    h.withhold(PRC_PERMISSIONS.price.edit);
    expect(
      await h.prices.set(h.by, {
        ...base,
        expectedRevision: 1,
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.not-permitted' } });
    h.withhold(PRC_PERMISSIONS.price.view);
    expect(await h.prices.get(h.by, subject)).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
    h.withhold(PRC_PERMISSIONS.price.history);
    expect(await h.prices.history(h.by, { item: item.id })).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
  });
});
