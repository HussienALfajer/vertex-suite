import { describe, expect, it } from 'vitest';
import { newId, orThrow, systemClock, type Result } from '@vertex/kernel';
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
    clock: systemClock,
    onEffectFailure: (failure) => {
      throw failure.cause;
    },
  });
  const registry = createRegistry({
    catalogue,
    plan,
    bus,
    transactor,
    clock: systemClock,
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
