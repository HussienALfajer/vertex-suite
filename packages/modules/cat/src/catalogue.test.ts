import { describe, expect, it } from 'vitest';
import { instant, newId, orThrow, type Result } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  recordJournal,
  runMigrations,
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
import { searchable, shardNames, shardOf } from './search.js';

const unwrap = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));

function installed() {
  let allowed = true;
  const withheld = new Set<string>();
  const at = instant(1_780_000_000_000);
  const clock = { now: () => at };
  const Authority = contractKey<Authoriser>('sec.authorisation');
  const catalogue = [
    defineModule<MemorySession>({ code: 'SYS', labelKey: 'module.sys' }),
    defineModule<MemorySession>({
      code: 'SEC',
      labelKey: 'module.sec',
      provides: [
        provideContract(Authority, () => ({
          may: (_by, right) => Promise.resolve(allowed && !withheld.has(right)),
        })),
      ],
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
    withhold: (right: string) => {
      withheld.add(right);
    },
    store,
    registry,
    transactor,
    at,
  };
}

const piece = { code: 'pc', kind: 'count' as const, decimals: 0 };
const kilogram = { code: 'kg', kind: 'weight' as const, decimals: 3 };

describe('CAT-08 item units and exact stock conversion', () => {
  it('keeps a legacy item base-only, then converts carton, pack and piece exactly in both directions', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Goods', parent: null, defaultBaseUnit: piece }),
    );
    const item = unwrap(await h.admin.createItem(h.by, { name: 'Pencils', category: category.id }));
    const base = unwrap(await h.read.units(h.by, item.id));
    expect(base).toHaveLength(1);
    expect(base[0]).toMatchObject({ unit: piece, basePerUnit: '1' });
    const pack = unwrap(
      await h.admin.addUnit(h.by, item.id, {
        unit: { code: 'pack', kind: 'count', decimals: 0 },
        basePerUnit: '6',
      }),
    );
    const carton = unwrap(
      await h.admin.addUnit(h.by, item.id, {
        unit: { code: 'carton', kind: 'count', decimals: 0 },
        basePerUnit: '24',
      }),
    );
    expect(unwrap(await h.read.convert(h.by, item.id, '2', carton.id, base[0]!.id))).toMatchObject({
      amount: '48',
      unit: base[0],
    });
    expect(unwrap(await h.read.stockQuantity(h.by, item.id, '2', carton.id))).toMatchObject({
      amount: '48',
      unit: base[0],
    });
    expect(unwrap(await h.read.convert(h.by, item.id, '4', carton.id, pack.id)).amount).toBe('16');
    expect(unwrap(await h.read.convert(h.by, item.id, '16', pack.id, carton.id)).amount).toBe('4');
    expect(await h.read.convert(h.by, item.id, '1', pack.id, carton.id)).toMatchObject({
      ok: false,
      error: { code: 'cat.conversion-inexact' },
    });
    expect(
      await h.admin.addUnit(h.by, item.id, { unit: pack.unit, basePerUnit: '7' }),
    ).toMatchObject({ ok: false, error: { code: 'cat.unit-duplicate' } });
    expect(unwrap(await h.read.units(h.by, item.id))).toHaveLength(3);
  });

  it('permits an explicit bag to kg relation, enforces precision and rejects invalid or foreign units', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, {
        name: 'Produce',
        parent: null,
        defaultBaseUnit: kilogram,
      }),
    );
    const item = unwrap(
      await h.admin.createItem(h.by, { name: 'Rice', category: category.id, kind: 'weighed' }),
    );
    const base = unwrap(await h.read.units(h.by, item.id))[0]!;
    const bag = unwrap(
      await h.admin.addUnit(h.by, item.id, {
        unit: { code: 'bag', kind: 'count', decimals: 0 },
        basePerUnit: '2.5',
      }),
    );
    expect(unwrap(await h.read.convert(h.by, item.id, '3', bag.id, base.id)).amount).toBe('7.5');
    expect(unwrap(await h.read.convert(h.by, item.id, '7.5', base.id, bag.id)).amount).toBe('3');
    const sachet = unwrap(
      await h.admin.addUnit(h.by, item.id, {
        unit: { code: 'sachet', kind: 'count', decimals: 0 },
        basePerUnit: '0.125',
      }),
    );
    expect(unwrap(await h.read.stockQuantity(h.by, item.id, '1', sachet.id)).amount).toBe('0.125');
    expect(unwrap(await h.read.convert(h.by, item.id, '0.125', base.id, sachet.id)).amount).toBe(
      '1',
    );
    expect(await h.read.convert(h.by, item.id, '1', base.id, bag.id)).toMatchObject({
      ok: false,
      error: { code: 'cat.conversion-inexact' },
    });
    expect(await h.read.convert(h.by, item.id, '0.0001', base.id, base.id)).toMatchObject({
      ok: false,
      error: { code: 'cat.quantity-invalid' },
    });
    for (const factor of ['0', '-1', 'abc', '1e3']) {
      expect(
        (
          await h.admin.addUnit(h.by, item.id, {
            unit: { code: 'bad', kind: 'count', decimals: 0 },
            basePerUnit: factor,
          })
        ).ok,
      ).toBe(false);
    }
    expect(
      await h.admin.addUnit(h.by, item.id, {
        unit: { code: 'tiny', kind: 'count', decimals: 0 },
        basePerUnit: '0.0001',
      }),
    ).toMatchObject({ ok: false, error: { code: 'cat.factor-invalid' } });
    expect(await h.read.units(h.other, item.id)).toMatchObject({
      ok: false,
      error: { code: 'cat.item-not-found' },
    });
    expect(await h.read.convert(h.other, item.id, '1', bag.id, base.id)).toMatchObject({
      ok: false,
      error: { code: 'cat.item-not-found' },
    });
    const another = unwrap(
      await h.admin.createItem(h.by, { name: 'Other', category: category.id }),
    );
    expect(await h.read.convert(h.by, another.id, '1', bag.id, base.id)).toMatchObject({
      ok: false,
      error: { code: 'cat.unit-not-found' },
    });
    expect(unwrap(await h.read.units(h.by, item.id))).toHaveLength(3);
    h.deny();
    expect(
      await h.admin.addUnit(h.by, item.id, {
        unit: { code: 'crate', kind: 'count', decimals: 0 },
        basePerUnit: '5',
      }),
    ).toMatchObject({ ok: false, error: { code: 'cat.not-permitted' } });
  });
});

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

describe('CAT-04 multiple barcodes per item', () => {
  async function stocked(h: ReturnType<typeof installed>, name = 'Tea') {
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Goods', parent: null, defaultBaseUnit: piece }),
    );
    const item = unwrap(await h.admin.createItem(h.by, { name, category: category.id }));
    const carton = unwrap(
      await h.admin.addUnit(h.by, item.id, {
        unit: { code: 'carton', kind: 'count', decimals: 0 },
        basePerUnit: '24',
      }),
    );
    return { category, item, base: item.units[0]!, carton };
  }

  it('resolves every registered code — manufacturer, carton and legacy — to its item and unit', async () => {
    const h = installed();
    const { item, base, carton } = await stocked(h);
    const manufacturer = unwrap(await h.admin.addBarcode(h.by, item.id, { code: '4006381333931' }));
    unwrap(await h.admin.addBarcode(h.by, item.id, { code: '96385074', unit: carton.id }));
    unwrap(await h.admin.addBarcode(h.by, item.id, { code: ' LEG-0042 ', unit: base.id }));

    // Registered without a unit, a code means the base unit — explicitly, so
    // that nothing downstream has to guess what an absent binding meant.
    expect(manufacturer).toMatchObject({ code: '4006381333931', unit: base.id, active: true });
    expect(manufacturer.registered).toEqual({ by: h.by.actor, at: h.at });
    for (const [code, unit] of [
      ['4006381333931', base],
      ['96385074', carton],
      ['LEG-0042', base],
    ] as const) {
      const found = unwrap(await h.read.scan(h.by, code));
      expect(found.item.id, code).toBe(item.id);
      expect(found.unit, code).toEqual(unit);
    }
    expect((await h.read.item(h.by, item.id))?.barcodes.map((one) => one.code)).toEqual([
      '4006381333931',
      '96385074',
      'LEG-0042',
    ]);
    // Code 128 distinguishes case, so a code that differs only in case is another code.
    expect(await h.read.scan(h.by, 'leg-0042')).toMatchObject({
      ok: false,
      error: { code: 'cat.barcode-not-found', values: { code: 'leg-0042' } },
    });
  });

  it('reads one GTIN in every spelling a scanner or a keyboard produces', async () => {
    const h = installed();
    const { item, base } = await stocked(h);
    unwrap(await h.admin.addBarcode(h.by, item.id, { code: '036000291452' }));
    // The same UPC-A as an EAN-13 and as a GTIN-14, and as typed on an Arabic
    // keyboard in either digit set.
    for (const spelling of [
      '036000291452',
      '0036000291452',
      '00036000291452',
      '٠٣٦٠٠٠٢٩١٤٥٢',
      '۰۳۶۰۰۰۲۹۱۴۵۲',
    ]) {
      const found = unwrap(await h.read.scan(h.by, spelling));
      expect(found.item.id, spelling).toBe(item.id);
      expect(found.unit, spelling).toEqual(base);
      expect(found.barcode.code, spelling).toBe('036000291452');
    }
    // A UPC-E and the UPC-A it abbreviates are one product: registered in
    // either spelling, the other scans to it and cannot be registered again.
    unwrap(await h.admin.addBarcode(h.by, item.id, { code: '01234565' }));
    expect(unwrap(await h.read.scan(h.by, '012345000065')).barcode.code).toBe('01234565');
    expect(await h.admin.addBarcode(h.by, item.id, { code: '0012345000065' })).toMatchObject({
      ok: false,
      error: { code: 'cat.barcode-taken' },
    });
    // Pasted out of an Arabic document, a code arrives wrapped in direction
    // marks nobody can see; they are not part of it.
    expect(unwrap(await h.read.scan(h.by, '\u200f036000291452\u200e')).item.id).toBe(item.id);
    // Twelve digits whose check digit fails are not a GTIN, only a code, and
    // gain no leading-zero twin.
    unwrap(await h.admin.addBarcode(h.by, item.id, { code: '036000291453' }));
    expect(await h.read.scan(h.by, '0036000291453')).toMatchObject({
      ok: false,
      error: { code: 'cat.barcode-not-found' },
    });
  });

  it('keeps a code unique within the tenant, in any spelling, and independent between tenants', async () => {
    const h = installed();
    const { item, category } = await stocked(h);
    const other = unwrap(await h.admin.createItem(h.by, { name: 'Coffee', category: category.id }));
    unwrap(await h.admin.addBarcode(h.by, item.id, { code: '4006381333931' }));
    for (const [target, code] of [
      [other.id, '4006381333931'],
      [item.id, '4006381333931'],
      [other.id, '04006381333931'],
      [other.id, '٤٠٠٦٣٨١٣٣٣٩٣١'],
    ] as const) {
      expect(await h.admin.addBarcode(h.by, target, { code }), code).toMatchObject({
        ok: false,
        error: { code: 'cat.barcode-taken', values: { item: 'Tea' } },
      });
    }
    expect((await h.read.item(h.by, other.id))?.barcodes).toEqual([]);

    // Another shop may sell the same manufacturer's product under the same
    // code; neither can see, scan or withdraw the other's.
    const theirs = await stocked({ ...h, by: h.other });
    unwrap(await h.admin.addBarcode(h.other, theirs.item.id, { code: '4006381333931' }));
    expect(unwrap(await h.read.scan(h.other, '4006381333931')).item.id).toBe(theirs.item.id);
    expect(unwrap(await h.read.scan(h.by, '4006381333931')).item.id).toBe(item.id);
    expect(await h.admin.addBarcode(h.other, item.id, { code: 'X-1' })).toMatchObject({
      ok: false,
      error: { code: 'cat.item-not-found' },
    });
    unwrap(await h.admin.deactivateBarcode(h.other, '4006381333931', 'Theirs'));
    expect((await h.read.scan(h.by, '4006381333931')).ok).toBe(true);
  });

  it('refuses a withdrawn code at the till but still says what it meant, and can restore it', async () => {
    const h = installed();
    const { item, carton, category } = await stocked(h);
    unwrap(await h.admin.addBarcode(h.by, item.id, { code: 'OLD-7', unit: carton.id }));
    const withdrawn = unwrap(await h.admin.deactivateBarcode(h.by, 'OLD-7', 'Supplier changed'));
    expect(withdrawn).toMatchObject({ code: 'OLD-7', unit: carton.id, active: false });
    expect(withdrawn.history).toEqual([
      { active: false, reason: 'Supplier changed', by: h.by.actor, at: h.at },
    ]);

    expect(await h.read.scan(h.by, 'OLD-7')).toMatchObject({
      ok: false,
      error: { code: 'cat.barcode-inactive', values: { code: 'OLD-7' } },
    });
    // A document printed while the code was live still reads: same item, same unit.
    const history = unwrap(await h.read.barcode(h.by, 'OLD-7'));
    expect(history.item.id).toBe(item.id);
    expect(history.unit).toEqual(carton);
    expect(history.barcode.active).toBe(false);

    // Withdrawn is not released: handing the code to another item would make
    // that same document name a different product.
    const other = unwrap(await h.admin.createItem(h.by, { name: 'Other', category: category.id }));
    expect((await h.admin.addBarcode(h.by, other.id, { code: 'OLD-7' })).ok).toBe(false);

    expect(await h.admin.deactivateBarcode(h.by, 'OLD-7', 'Again')).toMatchObject({
      ok: false,
      error: { code: 'cat.barcode-inactive' },
    });
    expect(await h.admin.reactivateBarcode(h.by, 'OLD-7', ' ')).toMatchObject({
      ok: false,
      error: { code: 'cat.reason-required' },
    });
    const restored = unwrap(await h.admin.reactivateBarcode(h.by, 'OLD-7', 'Old stock found'));
    expect(restored.history.map((change) => [change.active, change.reason])).toEqual([
      [false, 'Supplier changed'],
      [true, 'Old stock found'],
    ]);
    expect(unwrap(await h.read.scan(h.by, 'OLD-7')).unit).toEqual(carton);
    expect(await h.admin.reactivateBarcode(h.by, 'OLD-7', 'Twice')).toMatchObject({
      ok: false,
      error: { code: 'cat.barcode-active' },
    });
    expect(await h.admin.deactivateBarcode(h.by, 'NEVER', 'Missing')).toMatchObject({
      ok: false,
      error: { code: 'cat.barcode-not-found' },
    });
  });

  it('refuses a code that is not one, a unit of another item, and a caller without the right', async () => {
    const h = installed();
    const { item, category } = await stocked(h);
    for (const code of ['', '   ', 'TWO WORDS', 'رمز', 'x'.repeat(49), 42, null]) {
      expect(
        await h.admin.addBarcode(h.by, item.id, { code: code as string }),
        String(code),
      ).toMatchObject({ ok: false, error: { code: 'cat.barcode-invalid' } });
    }
    expect(
      await h.admin.addBarcode(h.by, item.id, null as unknown as { code: string }),
    ).toMatchObject({ ok: false, error: { code: 'cat.barcode-invalid' } });
    expect(unwrap(await h.admin.addBarcode(h.by, item.id, { code: 'x'.repeat(48) })).code).toBe(
      'x'.repeat(48),
    );
    const other = await h.admin.createItem(h.by, { name: 'Other', category: category.id });
    expect(
      await h.admin.addBarcode(h.by, item.id, {
        code: 'FOREIGN-UNIT',
        unit: unwrap(other).units[0]!.id,
      }),
    ).toMatchObject({ ok: false, error: { code: 'cat.unit-not-found' } });
    expect(await h.read.scan(h.by, '  ')).toMatchObject({
      ok: false,
      error: { code: 'cat.barcode-invalid' },
    });
    expect(await h.admin.addBarcode(h.by, newId<'item'>(), { code: 'NO-ITEM' })).toMatchObject({
      ok: false,
      error: { code: 'cat.item-not-found' },
    });
    expect((await h.read.scan(h.by, 'NO-ITEM')).ok).toBe(false);

    h.deny();
    for (const denied of [
      await h.admin.addBarcode(h.by, item.id, { code: 'DENIED' }),
      await h.admin.deactivateBarcode(h.by, 'x'.repeat(48), 'Denied'),
      await h.read.scan(h.by, 'x'.repeat(48)),
      await h.read.barcode(h.by, 'x'.repeat(48)),
    ])
      expect(denied).toMatchObject({ ok: false, error: { code: 'cat.not-permitted' } });
  });

  it('gives an item stored before barcodes existed none, and lets it take one', async () => {
    const h = installed();
    const { category } = await stocked(h);
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
    expect((await h.read.item(h.by, id))?.barcodes).toEqual([]);
    unwrap(await h.admin.addBarcode(h.by, id, { code: 'EARLIER-1' }));
    expect(unwrap(await h.read.scan(h.by, 'EARLIER-1')).unit).toMatchObject({
      id,
      basePerUnit: '1',
    });
  });

  it('registers a contested code to exactly one item when two managers race for it', async () => {
    const h = installed();
    const { item, category } = await stocked(h);
    const other = unwrap(await h.admin.createItem(h.by, { name: 'Other', category: category.id }));
    const results = await Promise.all([
      h.admin.addBarcode(h.by, item.id, { code: 'RACE-1' }),
      h.admin.addBarcode(h.by, other.id, { code: 'RACE-1' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const holders = [
      ...((await h.read.item(h.by, item.id))?.barcodes ?? []),
      ...((await h.read.item(h.by, other.id))?.barcodes ?? []),
    ];
    expect(holders.map((one) => one.code)).toEqual(['RACE-1']);
  });
});

describe('CAT-15 Arabic search', () => {
  async function shelves(h: ReturnType<typeof installed>) {
    const dairy = unwrap(
      await h.admin.createCategory(h.by, { name: 'ألبان', parent: null, defaultBaseUnit: piece }),
    );
    const fresh = unwrap(await h.admin.createCategory(h.by, { name: 'طازجة', parent: dairy.id }));
    const pantry = unwrap(
      await h.admin.createCategory(h.by, {
        name: 'مواد غذائية',
        parent: null,
        defaultBaseUnit: piece,
      }),
    );
    const add = async (name: string, category = pantry.id, code?: string) =>
      unwrap(
        await h.admin.createItem(h.by, { name, category, ...(code === undefined ? {} : { code }) }),
      );
    return { dairy, fresh, pantry, add };
  }
  const names = (found: { items: readonly { name: string }[] }) =>
    found.items.map((one) => one.name);

  it('finds a diacritised name from a term typed without diacritics, and the reverse', async () => {
    const h = installed();
    const { add, fresh } = await shelves(h);
    await add('حَلِيبٌ طَازَجٌ', fresh.id);
    await add('لبن كامل الدسم', fresh.id);
    expect(names(unwrap(await h.read.search(h.by, 'حليب')))).toEqual(['حَلِيبٌ طَازَجٌ']);
    expect(names(unwrap(await h.read.search(h.by, 'لَبَنٌ')))).toEqual(['لبن كامل الدسم']);
    // The dagger alef and the tatweel are marks of the page, not of the word.
    await add('هٰذا الـمنتج');
    expect(names(unwrap(await h.read.search(h.by, 'هذا المنتج')))).toEqual(['هٰذا الـمنتج']);
  });

  it('finds every alef form from a term with any alef form', async () => {
    const h = installed();
    const { add } = await shelves(h);
    const spellings = ['أرز بسمتي', 'إرز مصري', 'آرز حبة طويلة', 'ارز أبيض', 'ٱرز بني'];
    for (const name of spellings) await add(name);
    await add('برغل');
    for (const term of ['أرز', 'إرز', 'آرز', 'ارز', 'ٱرز']) {
      const found = unwrap(await h.read.search(h.by, term));
      expect(new Set(names(found)), term).toEqual(new Set(spellings));
      expect(found.total, term).toBe(spellings.length);
    }
  });

  it('forgives taa marbuta, alef maqsura, hamza seats, keyboards and the definite article', async () => {
    const h = installed();
    const { add } = await shelves(h);
    await add('زبدة');
    await add('حلوى');
    await add('مؤشر حرارة');
    await add('مسائل');
    await add('ماء معدني');
    await add('شاي أخضر 100 كيس');
    await add('Café Crème');
    for (const [term, name] of [
      ['زبده', 'زبدة'],
      ['حلوي', 'حلوى'],
      ['حلوی', 'حلوى'], // a Persian yeh from a Persian keyboard
      ['موشر', 'مؤشر حرارة'],
      ['مسايل', 'مسائل'],
      ['ما معدني', 'ماء معدني'],
      ['شاي ١٠٠', 'شاي أخضر 100 كيس'], // Arabic-Indic digits
      ['الزبدة', 'زبدة'], // the definite article, which the label left off
      ['cafe creme', 'Café Crème'],
    ] as const)
      expect(names(unwrap(await h.read.search(h.by, term))), term).toEqual([name]);
    // Stripped of its article, a word must still be a word: `الة` does not
    // become the one letter that is in half the catalogue.
    expect(unwrap(await h.read.search(h.by, 'الة')).total).toBe(0);
  });

  it('finds part of a word in the name, the code, an active barcode and the category', async () => {
    const h = installed();
    const { add, fresh, dairy } = await shelves(h);
    const milk = await add('حليب طازج', fresh.id, 'SKU-1042');
    const cheese = await add('جبنة بيضاء', dairy.id);
    const rice = await add('أرز بسمتي');
    unwrap(await h.admin.addBarcode(h.by, milk.id, { code: '4006381333931' }));
    unwrap(await h.admin.addBarcode(h.by, rice.id, { code: '036000291452' }));
    for (const [term, expected] of [
      ['حلي', [milk]], // part of the name
      ['1042', [milk]], // part of the code
      ['sku-1042', [milk]], // the code in another case
      ['333931', [milk]], // part of a barcode
      ['0036000291452', [rice]], // a barcode in another spelling of the same GTIN
      ['ألبان', [cheese, milk]], // the category, and every category beneath it
      ['طازجة', [milk]],
      ['حليب البان', [milk]], // one word from the name, one from the category
    ] as const) {
      const found = unwrap(await h.read.search(h.by, term));
      expect(
        found.items.map((one) => one.id),
        term,
      ).toEqual(expected.map((one) => one.id));
    }
    expect(unwrap(await h.read.search(h.by, 'حليب جبنة')).total).toBe(0);
  });

  it('ranks an exact code first, then a name that begins with the term, then the rest', async () => {
    const h = installed();
    const { add } = await shelves(h);
    const infant = unwrap(
      await h.admin.createCategory(h.by, {
        name: 'حليب الأطفال',
        parent: null,
        defaultBaseUnit: piece,
      }),
    );
    const powder = await add('بودرة', infant.id);
    const chocolate = await add('شوكولاتة بالحليب');
    const milk = await add('حليب مجفف');
    expect(unwrap(await h.read.search(h.by, 'حليب')).items.map((one) => one.id)).toEqual([
      milk.id,
      chocolate.id,
      powder.id,
    ]);
    const box = await add('علبة 1042 غرام');
    const coded = await add('مشروب', undefined, '1042');
    expect(unwrap(await h.read.search(h.by, '1042')).items.map((one) => one.id)).toEqual([
      coded.id,
      box.id,
    ]);
  });

  it('lists every item in name order for an empty term, cut to the limit with the total kept', async () => {
    const h = installed();
    const { add } = await shelves(h);
    for (const name of ['ياسمين', 'بسكويت', 'تمر', 'أرز', 'خبز']) await add(name);
    const all = unwrap(await h.read.search(h.by, ''));
    expect(names(all)).toEqual(['أرز', 'بسكويت', 'تمر', 'خبز', 'ياسمين']);
    expect(all.total).toBe(5);
    const first = unwrap(await h.read.search(h.by, '  ', 2));
    expect(names(first)).toEqual(['أرز', 'بسكويت']);
    expect(first.total).toBe(5);
  });

  it('follows every write of an item: a new code, a withdrawn one, a restored one, a changed status', async () => {
    const h = installed();
    const { add } = await shelves(h);
    const tea = await add('شاي');
    expect(unwrap(await h.read.search(h.by, 'OLD-7')).total).toBe(0);
    unwrap(await h.admin.addBarcode(h.by, tea.id, { code: 'OLD-7' }));
    expect(names(unwrap(await h.read.search(h.by, 'OLD-7')))).toEqual(['شاي']);
    // Withdrawn, a code is history — `barcode` still answers for it, the
    // search does not sell by it.
    unwrap(await h.admin.deactivateBarcode(h.by, 'OLD-7', 'Relabelled'));
    expect(unwrap(await h.read.search(h.by, 'OLD-7')).total).toBe(0);
    unwrap(await h.admin.reactivateBarcode(h.by, 'OLD-7', 'Old stock found'));
    expect(unwrap(await h.read.search(h.by, 'OLD-7')).total).toBe(1);
    // Every status is found, and says what it is; selling it is eligibility's question.
    unwrap(await h.admin.changeItemStatus(h.by, tea.id, 'suspended', 'Recall'));
    const suspended = unwrap(await h.read.search(h.by, 'شاي'));
    expect(suspended.items[0]).toMatchObject({ id: tea.id, status: 'suspended' });
    unwrap(
      await h.admin.addUnit(h.by, tea.id, {
        unit: { code: 'carton', kind: 'count', decimals: 0 },
        basePerUnit: '24',
      }),
    );
    expect(unwrap(await h.read.search(h.by, 'شاي')).items[0]?.units).toHaveLength(2);
  });

  it("never finds another tenant's items, whatever the term", async () => {
    const h = installed();
    const { add } = await shelves(h);
    await add('حليب', undefined, 'SHARED-1');
    const theirs = await shelves({ ...h, by: h.other });
    unwrap(await h.admin.createItem(h.other, { name: 'حليب', category: theirs.pantry.id }));
    for (const term of ['', 'حليب', 'SHARED-1']) {
      const found = unwrap(await h.read.search(h.other, term));
      expect(
        found.items.every((one) => one.tenant === h.other.tenant),
        term,
      ).toBe(true);
      expect(
        found.items.map((one) => one.code),
        term,
      ).not.toContain('SHARED-1');
    }
    expect(unwrap(await h.read.search(h.by, '')).total).toBe(1);
  });

  it('drops an article only from the start of a word, and ranks as though it was never typed', async () => {
    const h = installed();
    const { add, dairy } = await shelves(h);
    const gum = await add('لبان عربي');
    const milk = await add('حليب طازج');
    const chocolate = await add('شوكولاتة بالحليب');
    // `ال` in `البان` is part of the word, not an article: the stem `بان`
    // inside `لبان` is no match.
    const cheese = await add('جبنة', dairy.id);
    expect(unwrap(await h.read.search(h.by, 'البان')).items.map((one) => one.id)).toEqual([
      cheese.id,
    ]);
    expect(unwrap(await h.read.search(h.by, 'لبان')).items.map((one) => one.id)).toContain(gum.id);
    expect(unwrap(await h.read.search(h.by, 'الحليب')).items.map((one) => one.id)).toEqual([
      milk.id,
      chocolate.id,
    ]);
  });

  it('finds nothing through a category name for a caller who may not read categories', async () => {
    const h = installed();
    const { add, dairy } = await shelves(h);
    const cheese = await add('جبنة', dairy.id);
    expect(unwrap(await h.read.search(h.by, 'البان')).total).toBe(1);
    h.withhold(CAT_PERMISSIONS.category.view);
    expect(unwrap(await h.read.search(h.by, 'البان')).total).toBe(0);
    expect(unwrap(await h.read.search(h.by, 'جبنة')).items.map((one) => one.id)).toEqual([
      cheese.id,
    ]);
  });

  it('files every identifier, whatever its shape, in a shard the search reads', () => {
    const read = new Set(shardNames());
    for (const id of [newId<'item'>(), 'legacy-42', 'ZZ', '', 'حليب'])
      expect(read.has(shardOf(id as ReturnType<typeof newId<'item'>>)), id).toBe(true);
  });

  it('refuses a term that is not one, a limit out of range, and a caller without the right', async () => {
    const h = installed();
    await shelves(h);
    for (const term of ['x'.repeat(101), 42, null, undefined])
      expect(await h.read.search(h.by, term as string), String(term)).toMatchObject({
        ok: false,
        error: { code: 'cat.search-invalid', values: { max: 100 } },
      });
    expect((await h.read.search(h.by, 'x'.repeat(100))).ok).toBe(true);
    for (const limit of [0, 201, 1.5, -1, '10'])
      expect(await h.read.search(h.by, '', limit as number), String(limit)).toMatchObject({
        ok: false,
        error: { code: 'cat.search-limit-invalid', values: { max: 200 } },
      });
    expect((await h.read.search(h.by, '', 200)).ok).toBe(true);
    h.deny();
    expect(await h.read.search(h.by, '')).toMatchObject({
      ok: false,
      error: { code: 'cat.not-permitted', values: { right: CAT_PERMISSIONS.item.view } },
    });
  });

  it('indexes an item stored before the index existed when the migration runs, once', async () => {
    const h = installed();
    const { pantry } = await shelves(h);
    const id = newId<'item'>();
    const session = await h.store.driver.begin(h.by);
    session.put(`cat/item/${encodeURIComponent(h.by.tenant)}/${encodeURIComponent(id)}`, {
      tenant: h.by.tenant,
      id,
      name: 'عَسَل',
      category: pantry.id,
      kind: 'standard',
      baseUnit: piece,
    });
    await h.store.driver.commit(session);
    expect(unwrap(await h.read.search(h.by, 'عسل')).total).toBe(0);
    const journal = recordJournal();
    const plan = h.registry.migrationPlan('terminal');
    expect(plan.map((one) => one.id)).toEqual(['cat.0001-search-index']);
    const migrate = () => runMigrations({ plan, transactor: h.transactor, context: h.by, journal });
    expect((await migrate()).applied).toEqual(['cat.0001-search-index']);
    expect(unwrap(await h.read.search(h.by, 'عسل')).items).toMatchObject([
      { id, name: 'عَسَل', code: null, status: 'active' },
    ]);
    expect((await migrate()).alreadyApplied).toEqual(['cat.0001-search-index']);
  });

  it('folds every spelling of a word to one, and keeps nothing a word is not made of', () => {
    for (const [typed, folded] of [
      ['أإآٱا', 'ااااا'],
      ['ؤ ئ ء', 'و ي'],
      ['مَدْرَسَةٌ', 'مدرسه'],
      ['مستشفى', 'مستشفي'],
      ['ﻻ ﷲ', 'لا الله'],
      ['\u200fرمز\u200e-٤٢\t۷', 'رمز 42 7'],
      ['İSTANBUL Ünlü', 'istanbul unlu'],
      ['  |\n  ', ''],
    ] as const)
      expect(searchable(typed), typed).toBe(folded);
  });
});

describe('CAT-15 item codes, which the search reads', () => {
  it('keeps a code on the item, unique within the tenant whatever its case or digits', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Goods', parent: null, defaultBaseUnit: piece }),
    );
    const tea = unwrap(
      await h.admin.createItem(h.by, { name: 'Tea', category: category.id, code: ' A-١٠٠ ' }),
    );
    expect(tea.code).toBe('A-100');
    expect((await h.read.item(h.by, tea.id))?.code).toBe('A-100');
    for (const code of ['A-100', 'a-100', 'a-١٠٠'])
      expect(
        await h.admin.createItem(h.by, { name: 'Other', category: category.id, code }),
        code,
      ).toMatchObject({ ok: false, error: { code: 'cat.code-taken', values: { item: 'Tea' } } });
    for (const code of ['TWO WORDS', 'رمز', 'x'.repeat(33), 42])
      expect(
        await h.admin.createItem(h.by, {
          name: 'Other',
          category: category.id,
          code: code as string,
        }),
        String(code),
      ).toMatchObject({ ok: false, error: { code: 'cat.code-invalid', values: { max: 32 } } });
    const plain = unwrap(
      await h.admin.createItem(h.by, { name: 'Plain', category: category.id, code: '  ' }),
    );
    expect(plain.code).toBeNull();
    // Another shop numbers its own shelves.
    const theirs = unwrap(
      await h.admin.createCategory(h.other, {
        name: 'Goods',
        parent: null,
        defaultBaseUnit: piece,
      }),
    );
    expect(
      unwrap(await h.admin.createItem(h.other, { name: 'Tea', category: theirs.id, code: 'A-100' }))
        .code,
    ).toBe('A-100');
  });

  it('gives a code to exactly one item when two managers race for it', async () => {
    const h = installed();
    const category = unwrap(
      await h.admin.createCategory(h.by, { name: 'Goods', parent: null, defaultBaseUnit: piece }),
    );
    const results = await Promise.all([
      h.admin.createItem(h.by, { name: 'One', category: category.id, code: 'RACE' }),
      h.admin.createItem(h.by, { name: 'Two', category: category.id, code: 'race' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(unwrap(await h.read.search(h.by, 'race')).total).toBe(1);
  });
});
