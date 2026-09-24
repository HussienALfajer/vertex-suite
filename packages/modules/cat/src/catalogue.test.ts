import { describe, expect, it } from 'vitest';
import { instant, newId, orThrow, type Result } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  defineModule,
  provideContract,
  contractKey,
} from '@vertex/platform';
import type { Authoriser, MemorySession } from '@vertex/platform';
import { catModule, Catalogue, CatalogueAdministration, CAT_PERMISSIONS } from './index.js';

const unwrap = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));

function installed() {
  let allowed = true;
  const at = instant(1_780_000_000_000);
  const clock = { now: () => at };
  const Authority = contractKey<Authoriser>('sec.authorisation');
  const catalogue = [
    defineModule<MemorySession>({ code: 'SYS', labelKey: 'module.sys' }),
    defineModule<MemorySession>({
      code: 'SEC',
      labelKey: 'module.sec',
      provides: [provideContract(Authority, () => ({ may: () => Promise.resolve(allowed) }))],
    }),
    defineModule<MemorySession>({ code: 'FX', labelKey: 'module.fx' }),
    catModule<MemorySession>(),
  ];
  const plan = unwrap(composeEdition(catalogue, { modules: ['SYS', 'SEC', 'FX', 'CAT'] }));
  const store = createMemoryStore();
  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw failure.cause;
    },
  });
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock,
    onEffectFailure: (failure) => {
      throw failure.cause;
    },
  });
  const registry = createRegistry({
    catalogue,
    plan,
    bus,
    transactor,
    clock,
    authorisedBy: Authority,
  });
  const by = commandContext({ tenant: newId<'tenant'>(), actor: newId<'user'>() });
  const other = commandContext({ tenant: newId<'tenant'>(), actor: newId<'user'>() });
  return {
    read: registry.require(Catalogue),
    admin: registry.require(CatalogueAdministration),
    by,
    other,
    deny: () => {
      allowed = false;
    },
    store,
    registry,
    at,
  };
}

const piece = { code: 'pc', kind: 'count' as const, decimals: 0 };
const kilogram = { code: 'kg', kind: 'weight' as const, decimals: 3 };

describe('CAT-01 category tree and first item', () => {
  it('inherits the nearest base unit at creation, permits an item override, and keeps both snapshots after a category edit', async () => {
    const h = installed();
    const root = unwrap(
      await h.admin.createCategory(h.by, { name: 'غذاء', parent: null, defaultBaseUnit: piece }),
    );
    const child = unwrap(await h.admin.createCategory(h.by, { name: 'معلبات', parent: root.id }));
    const leaf = unwrap(await h.admin.createCategory(h.by, { name: 'فاكهة', parent: child.id }));
    const inherited = unwrap(await h.admin.createItem(h.by, { name: 'تفاح', category: leaf.id }));
    const overridden = unwrap(
      await h.admin.createItem(h.by, { name: 'موز', category: leaf.id, baseUnit: kilogram }),
    );
    expect(inherited.category).toBe(leaf.id);
    expect(inherited.baseUnit).toEqual(piece);
    expect(overridden.baseUnit).toEqual(kilogram);
    unwrap(await h.admin.reviseCategory(h.by, root.id, { defaultBaseUnit: kilogram }));
    expect((await h.read.item(h.by, inherited.id))?.baseUnit).toEqual(piece);
    expect((await h.read.item(h.by, overridden.id))?.baseUnit).toEqual(kilogram);
    expect((await h.read.categories(h.by)).map((c) => c.parent)).toEqual([null, root.id, child.id]);
  });

  it('refuses missing parents, cycles, invalid item categories, missing base units, and another tenant’s identifiers', async () => {
    const h = installed();
    const root = unwrap(
      await h.admin.createCategory(h.by, { name: 'A', parent: null, defaultBaseUnit: piece }),
    );
    const child = unwrap(await h.admin.createCategory(h.by, { name: 'B', parent: root.id }));
    expect((await h.admin.moveCategory(h.by, root.id, child.id)).ok).toBe(false);
    expect(
      (await h.admin.createCategory(h.by, { name: 'bad', parent: newId<'category'>() })).ok,
    ).toBe(false);
    expect(
      (await h.admin.createItem(h.by, { name: 'bad', category: newId<'category'>() })).ok,
    ).toBe(false);
    expect((await h.admin.createItem(h.other, { name: 'bad', category: root.id })).ok).toBe(false);
    expect(await h.read.category(h.other, root.id)).toBeNull();
    expect(await h.read.categories(h.other)).toEqual([]);
    const without = unwrap(await h.admin.createCategory(h.by, { name: 'No unit', parent: null }));
    expect((await h.admin.createItem(h.by, { name: 'bad', category: without.id })).ok).toBe(false);
  });

  it('enforces declared read and write rights in the domain', async () => {
    const h = installed();
    const root = unwrap(
      await h.admin.createCategory(h.by, { name: 'A', parent: null, defaultBaseUnit: piece }),
    );
    h.deny();
    const denied = await h.admin.createItem(h.by, { name: 'B', category: root.id });
    expect(denied.ok ? null : denied.error.code).toBe('cat.not-permitted');
    expect(await h.read.category(h.by, root.id)).toBeNull();
    expect(await h.read.categories(h.by)).toEqual([]);
    expect(CAT_PERMISSIONS.category.view).toBeDefined();
  });
});

describe('CAT-02 item tracking behaviour', () => {
  it('creates the four supported behaviours and rejects serial or an incompatible weighed unit', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Goods', parent: null, defaultBaseUnit: piece }),
    );
    for (const kind of ['standard', 'weighed', 'batch-tracked', 'variant-bearing'] as const) {
      const item = unwrap(
        await h.admin.createItem(h.by, {
          name: kind,
          category: category.id,
          kind,
          ...(kind === 'weighed' ? { baseUnit: kilogram } : {}),
        }),
      );
      expect((await h.read.item(h.by, item.id))?.kind).toBe(kind);
    }
    const incompatible = await h.admin.createItem(h.by, {
      name: 'bad',
      category: category.id,
      kind: 'weighed',
    });
    expect(incompatible.ok ? null : incompatible.error.code).toBe('cat.tracking-unit-incompatible');
    const future = await h.admin.createItem(h.by, {
      name: 'future',
      category: category.id,
      kind: 'serial' as 'standard',
    });
    expect(future.ok ? null : future.error.code).toBe('cat.tracking-unsupported');
    const empty = await h.admin.createItem(h.by, {
      name: 'empty',
      category: category.id,
      kind: null as unknown as 'standard',
    });
    expect(empty.ok ? null : empty.error.code).toBe('cat.tracking-unsupported');
  });
});

describe('CAT-12 item lifecycle status', () => {
  it('reads a U08.1 stored item as active without changing its identity, category or unit', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Legacy', parent: null, defaultBaseUnit: piece }),
    );
    const id = newId<'item'>();
    const session = await h.store.driver.begin(h.by);
    session.put(`cat/item/${encodeURIComponent(h.by.tenant)}/${encodeURIComponent(id)}`, {
      tenant: h.by.tenant,
      id,
      name: 'Earlier',
      category: category.id,
      kind: 'standard',
      baseUnit: piece,
    });
    await h.store.driver.commit(session);
    expect(await h.read.item(h.by, id)).toMatchObject({
      id,
      category: category.id,
      baseUnit: piece,
      status: 'active',
      statusHistory: [],
    });
    expect(
      unwrap(await h.admin.changeItemStatus(h.by, id, 'suspended', 'Review')).statusHistory,
    ).toHaveLength(1);
  });

  it('retains actor, reason and history; suspension bars both trades and discontinuation bars new purchases', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Goods', parent: null, defaultBaseUnit: piece }),
    );
    const item = unwrap(await h.admin.createItem(h.by, { name: 'Old', category: category.id }));
    expect(item.status).toBe('active');
    expect((await h.read.eligibility(h.by, item.id, 'sale')).ok).toBe(true);
    const suspended = unwrap(await h.admin.changeItemStatus(h.by, item.id, 'suspended', 'Damaged'));
    expect(suspended.status).toBe('suspended');
    for (const trade of ['purchase', 'sale'] as const) {
      const result = await h.read.eligibility(h.by, item.id, trade);
      expect(result.ok ? null : result.error.code).toBe('cat.item-suspended');
    }
    expect((await h.read.item(h.by, item.id))?.status).toBe('suspended');
    unwrap(await h.admin.changeItemStatus(h.by, item.id, 'active', 'Inspected'));
    const discontinued = unwrap(
      await h.admin.changeItemStatus(h.by, item.id, 'discontinued', 'No longer stocked'),
    );
    expect(discontinued.statusHistory.map((change) => change.to)).toEqual([
      'suspended',
      'active',
      'discontinued',
    ]);
    expect(discontinued.statusHistory[0]?.by).toBe(h.by.actor);
    expect(discontinued.statusHistory[0]?.at).toBe(h.at);
    expect(discontinued.statusHistory[0]?.reason).toBe('Damaged');
    expect((await h.read.eligibility(h.by, item.id, 'purchase')).ok).toBe(false);
    expect((await h.read.eligibility(h.by, item.id, 'sale')).ok).toBe(true);
    expect((await h.admin.changeItemStatus(h.by, item.id, 'active', 'Try again')).ok).toBe(false);
  });

  it('refuses missing reasons, no-op transitions, foreign or invalid ids and denied commands', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Goods', parent: null, defaultBaseUnit: piece }),
    );
    const item = unwrap(await h.admin.createItem(h.by, { name: 'Good', category: category.id }));
    expect((await h.admin.changeItemStatus(h.by, item.id, 'suspended', '  ')).ok).toBe(false);
    expect((await h.admin.changeItemStatus(h.by, item.id, 'active', 'No change')).ok).toBe(false);
    expect((await h.admin.changeItemStatus(h.other, item.id, 'suspended', 'Other')).ok).toBe(false);
    expect(await h.read.item(h.other, item.id)).toBeNull();
    expect((await h.read.eligibility(h.other, item.id, 'sale')).ok).toBe(false);
    expect(
      (await h.admin.changeItemStatus(h.by, 'invalid' as typeof item.id, 'suspended', 'Bad id')).ok,
    ).toBe(false);
    h.deny();
    const denied = await h.admin.changeItemStatus(h.by, item.id, 'suspended', 'Denied');
    expect(denied.ok ? null : denied.error.code).toBe('cat.not-permitted');
  });

  it('keeps every committed transition when status commands race', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Race', parent: null, defaultBaseUnit: piece }),
    );
    const item = unwrap(await h.admin.createItem(h.by, { name: 'Shared', category: category.id }));
    const results = await Promise.all([
      h.admin.changeItemStatus(h.by, item.id, 'suspended', 'Hold'),
      h.admin.changeItemStatus(h.by, item.id, 'discontinued', 'Retire'),
    ]);
    const committed = results.filter((result) => result.ok).length;
    expect((await h.read.item(h.by, item.id))?.statusHistory).toHaveLength(committed);
    expect(committed).toBeGreaterThanOrEqual(1);
  });
});
