import { describe, expect, it } from 'vitest';
import { Catalogue, type Item, type ItemId } from '@vertex/cat/contract';
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
import { prcModule, PriceLists, PriceListAdministration, PRC_PERMISSIONS } from './index.js';

const value = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));

function installed() {
  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();
  const permitted = new Set<string>(Object.values(PRC_PERMISSIONS.list));
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
    defineModule<MemorySession>({ code: 'FX', labelKey: 'module.fx' }),
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
