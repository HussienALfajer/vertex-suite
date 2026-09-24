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
  type Authoriser,
  type MemorySession,
} from '@vertex/platform';
import {
  catModule,
  CatalogueAdministration,
  ItemCosting,
  INVENTORY_ROLE,
  type CostQuote,
  type InventoryPosting,
} from './index.js';

const taken = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));
const piece = { code: 'pc', kind: 'count' as const, decimals: 0 };
const kilogram = { code: 'kg', kind: 'weight' as const, decimals: 3 };

function installed() {
  const Authority = contractKey<Authoriser>('sec.authorisation');
  const modules = [
    defineModule<MemorySession>({ code: 'SYS', labelKey: 'module.sys' }),
    defineModule<MemorySession>({
      code: 'SEC',
      labelKey: 'module.sec',
      provides: [provideContract(Authority, () => ({ may: () => Promise.resolve(true) }))],
    }),
    defineModule<MemorySession>({ code: 'FX', labelKey: 'module.fx' }),
    catModule<MemorySession>(),
  ];
  const plan = taken(composeEdition(modules, { modules: ['SYS', 'SEC', 'FX', 'CAT'] }));
  const store = createMemoryStore();
  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw failure.cause;
    },
  });
  const clock = { now: () => instant(1_780_000_000_000) };
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock,
    onEffectFailure: (failure) => {
      throw failure.cause;
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
  const by = commandContext({ tenant: newId<'tenant'>(), actor: newId<'user'>() });
  const other = commandContext({ tenant: newId<'tenant'>(), actor: newId<'user'>() });
  return {
    by,
    other,
    store,
    transactor,
    admin: registry.require(CatalogueAdministration),
    cost: registry.require(ItemCosting),
  };
}

function posting(
  tenant: ReturnType<typeof installed>['by']['tenant'],
  quote: CostQuote,
): InventoryPosting {
  return {
    entry: { tenant, source: { document: quote.movement } },
    lines: [
      {
        role: INVENTORY_ROLE,
        side: quote.direction === 'receipt' ? 'debit' : 'credit',
        amount: { amount: quote.valueUSD, currency: 'USD' },
      },
    ],
  };
}

describe('CAT-10 moving weighted-average item cost', () => {
  it('keeps exact USD value and base quantity through receipts and issues, including the last cent', async () => {
    const h = installed();
    const category = taken(
      await h.admin.createCategory(h.by, {
        name: 'Goods',
        parent: null,
        defaultBaseUnit: piece,
      }),
    );
    const item = taken(await h.admin.createItem(h.by, { name: 'Pencils', category: category.id }));
    const base = item.units[0]!;
    const carton = taken(
      await h.admin.addUnit(h.by, item.id, {
        unit: { code: 'carton', kind: 'count', decimals: 0 },
        basePerUnit: '10',
      }),
    );
    expect(taken(await h.cost.snapshot(h.by, item.id))).toMatchObject({
      quantity: '0',
      valueUSD: '0',
      average: null,
      revision: 0,
    });
    const first = taken(
      await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '1', carton.id, '30'),
    );
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, first, posting(h.by.tenant, first)))),
    );
    const second = taken(
      await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '10', base.id, '50'),
    );
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, second, posting(h.by.tenant, second)))),
    );
    expect(taken(await h.cost.snapshot(h.by, item.id))).toMatchObject({
      quantity: '20',
      valueUSD: '80',
      average: { valueUSD: '80', quantity: '20' },
      revision: 2,
    });
    const issue = taken(
      await h.cost.quoteIssue(h.by, newId<'cost-movement'>(), item.id, '5', base.id),
    );
    expect(issue.valueUSD).toBe('20');
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, issue, posting(h.by.tenant, issue)))),
    );
    const last = taken(
      await h.cost.quoteIssue(h.by, newId<'cost-movement'>(), item.id, '15', base.id),
    );
    expect(last.valueUSD).toBe('60');
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, last, posting(h.by.tenant, last)))),
    );
    expect(taken(await h.cost.snapshot(h.by, item.id))).toMatchObject({
      quantity: '0',
      valueUSD: '0',
      average: null,
      revision: 4,
    });
    expect(taken(await h.cost.quoteIssue(h.by, last.movement, item.id, '15', base.id))).toEqual(
      last,
    );
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, last, posting(h.by.tenant, last)))),
    );
    expect(taken(await h.cost.snapshot(h.by, item.id)).revision).toBe(4);
  });

  it('keeps the rounding residual in stock and its cost out of the item sent to a register', async () => {
    const h = installed();
    const category = taken(
      await h.admin.createCategory(h.by, {
        name: 'Produce',
        parent: null,
        defaultBaseUnit: kilogram,
      }),
    );
    const item = taken(
      await h.admin.createItem(h.by, { name: 'Rice', category: category.id, kind: 'weighed' }),
    );
    const base = item.units[0]!;
    const receipt = taken(
      await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '3', base.id, '10'),
    );
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, receipt, posting(h.by.tenant, receipt)))),
    );
    const first = taken(
      await h.cost.quoteIssue(h.by, newId<'cost-movement'>(), item.id, '1', base.id),
    );
    expect(first.valueUSD).toBe('3.33');
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, first, posting(h.by.tenant, first)))),
    );
    const rest = taken(
      await h.cost.quoteIssue(h.by, newId<'cost-movement'>(), item.id, '2', base.id),
    );
    expect(rest.valueUSD).toBe('6.67');
    expect(rest.after.valueUSD).toBe('0');
    expect(item).not.toHaveProperty('cost');
    expect(item).not.toHaveProperty('valueUSD');
    expect(await h.cost.snapshot(h.other, item.id)).toMatchObject({
      ok: false,
      error: { code: 'cat.item-not-found' },
    });
  });

  it('refuses invalid quantities, value precision, overdraw and a conflicting movement identity', async () => {
    const h = installed();
    const category = taken(
      await h.admin.createCategory(h.by, {
        name: 'Goods',
        parent: null,
        defaultBaseUnit: piece,
      }),
    );
    const item = taken(await h.admin.createItem(h.by, { name: 'Pens', category: category.id }));
    const base = item.units[0]!;
    expect(
      (await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '0', base.id, '1')).ok,
    ).toBe(false);
    expect(
      (await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '-1', base.id, '1')).ok,
    ).toBe(false);
    expect(
      (await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '1', base.id, '1.001'))
        .ok,
    ).toBe(false);
    expect(
      (await h.cost.quoteIssue(h.by, newId<'cost-movement'>(), item.id, '1', base.id)).ok,
    ).toBe(false);
    const movement = newId<'cost-movement'>();
    const first = taken(await h.cost.quoteReceipt(h.by, movement, item.id, '1', base.id, '1'));
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, first, posting(h.by.tenant, first)))),
    );
    expect((await h.cost.quoteReceipt(h.by, movement, item.id, '1', base.id, '2')).ok).toBe(false);
    expect(taken(await h.cost.snapshot(h.by, item.id)).valueUSD).toBe('1');
  });

  it('accepts free stock without inventing a zero-valued journal line', async () => {
    const h = installed();
    const category = taken(
      await h.admin.createCategory(h.by, {
        name: 'Goods',
        parent: null,
        defaultBaseUnit: piece,
      }),
    );
    const item = taken(await h.admin.createItem(h.by, { name: 'Samples', category: category.id }));
    const base = item.units[0]!;
    const free = taken(
      await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '3', base.id, '0'),
    );
    await h.transactor.run(h.by, (uow) => Promise.resolve(taken(h.cost.apply(uow, free, null))));
    const issue = taken(
      await h.cost.quoteIssue(h.by, newId<'cost-movement'>(), item.id, '3', base.id),
    );
    expect(issue.valueUSD).toBe('0');
    await h.transactor.run(h.by, (uow) => Promise.resolve(taken(h.cost.apply(uow, issue, null))));
    expect(taken(await h.cost.snapshot(h.by, item.id)).quantity).toBe('0');
  });

  it('matches USD source value when the tenant keeps its journal in another currency', async () => {
    const h = installed();
    const category = taken(
      await h.admin.createCategory(h.by, {
        name: 'Goods',
        parent: null,
        defaultBaseUnit: piece,
      }),
    );
    const item = taken(await h.admin.createItem(h.by, { name: 'Pens', category: category.id }));
    const quote = taken(
      await h.cost.quoteReceipt(
        h.by,
        newId<'cost-movement'>(),
        item.id,
        '2',
        item.units[0]!.id,
        '5',
      ),
    );
    const converted: InventoryPosting = {
      entry: { tenant: h.by.tenant, source: { document: quote.movement } },
      lines: [
        {
          role: INVENTORY_ROLE,
          side: 'debit',
          amount: { amount: '4.25', currency: 'EUR' },
          original: { amount: '5', currency: 'USD' },
        },
      ],
    };
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, quote, converted))),
    );
    expect(taken(await h.cost.snapshot(h.by, item.id)).valueUSD).toBe('5');
  });

  it('rolls back a posted entry when its inventory line disagrees or its cost quote became stale', async () => {
    const h = installed();
    const category = taken(
      await h.admin.createCategory(h.by, {
        name: 'Goods',
        parent: null,
        defaultBaseUnit: piece,
      }),
    );
    const item = taken(await h.admin.createItem(h.by, { name: 'Pens', category: category.id }));
    const base = item.units[0]!;
    const stale = taken(
      await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '2', base.id, '4'),
    );
    await expect(
      h.transactor.run(h.by, (uow) => {
        uow.session.put('fin/test-entry', { amount: '5' });
        return Promise.resolve(
          h.cost.apply(uow, stale, {
            ...posting(h.by.tenant, stale),
            lines: [
              { role: INVENTORY_ROLE, side: 'debit', amount: { amount: '5', currency: 'USD' } },
            ],
          }),
        );
      }),
    ).rejects.toThrow('disagree');
    expect(h.store.committed().has('fin/test-entry')).toBe(false);
    const earlier = taken(
      await h.cost.quoteReceipt(h.by, newId<'cost-movement'>(), item.id, '1', base.id, '1'),
    );
    await h.transactor.run(h.by, (uow) =>
      Promise.resolve(taken(h.cost.apply(uow, earlier, posting(h.by.tenant, earlier)))),
    );
    await expect(
      h.transactor.run(h.by, (uow) => {
        uow.session.put('fin/test-entry', { amount: '4' });
        return Promise.resolve(h.cost.apply(uow, stale, posting(h.by.tenant, stale)));
      }),
    ).rejects.toThrow('changed');
    expect(h.store.committed().has('fin/test-entry')).toBe(false);
    expect(taken(await h.cost.snapshot(h.by, item.id))).toMatchObject({
      quantity: '1',
      valueUSD: '1',
      revision: 1,
    });
  });
});
