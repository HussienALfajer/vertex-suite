import { newId, orThrow, systemClock, type Id } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import { contractKey } from './contract.js';
import { commandContext, systemContext, type CommandContext } from './context.js';
import { composeEdition, type EditionRequest } from './edition.js';
import { createEventBus, eventType, type HandlerFailure } from './events.js';
import { memoryJournal, runMigrations } from './migrations.js';
import {
  defineModule,
  provideContract,
  subscribeTo,
  type ModuleCode,
  type ModuleDefinition,
} from './module.js';
import { createRegistry } from './registry.js';
import { createMemoryStore, createTransactor, type MemorySession } from './unit-of-work.js';

/**
 * The fourth inversion of modules.md §5, end to end.
 *
 * STK sells a consignment unit. The payable belongs to PUR. Done the obvious
 * way — STK calls PUR — STK could never ship in an edition without purchasing,
 * and half the shops this product is for buy nothing on consignment at all.
 *
 * So STK publishes, PUR subscribes, and the same STK code runs unchanged in
 * both editions below. Nothing in this file is a mock: it is the registry, the
 * bus and the unit of work as they ship, over the memory store.
 */

interface ConsignmentUnitSold {
  readonly item: string;
  readonly owed: string;
}

const ConsignmentUnitSold = eventType<ConsignmentUnitSold>('stk.consignment-unit-sold');

const Selling = contractKey<{ sell(item: string, by: CommandContext): Promise<void> }>(
  'stk.selling',
);
const PurchaseHistory = contractKey<{ forItem(item: string): readonly string[] }>(
  'pur.item-purchase-history',
);
const ItemCard = contractKey<{
  open(item: string): { item: string; history: readonly string[] | null };
}>('cat.item-card');

const CORE: readonly ModuleCode[] = ['SYS', 'SEC', 'FX', 'FIN'];

const catalogue: readonly ModuleDefinition<MemorySession>[] = [
  defineModule<MemorySession>({
    code: 'SYS',
    labelKey: 'module.sys',
    migrations: [
      {
        id: 'sys.0001-tenant',
        target: 'both',
        up: (session) => {
          session.put('table:tenant', true);
          return Promise.resolve();
        },
      },
    ],
  }),
  defineModule<MemorySession>({ code: 'SEC', labelKey: 'module.sec', dependsOn: ['SYS'] }),
  defineModule<MemorySession>({ code: 'FX', labelKey: 'module.fx', dependsOn: ['SYS'] }),
  defineModule<MemorySession>({ code: 'FIN', labelKey: 'module.fin', dependsOn: ['FX', 'SEC'] }),

  defineModule<MemorySession>({
    code: 'CAT',
    labelKey: 'module.cat',
    dependsOn: ['SYS', 'SEC', 'FX'],
    // CAT-16. The section exists when PUR does, and the item card is otherwise
    // exactly the same screen.
    enhancedBy: ['PUR'],
    provides: [
      provideContract(ItemCard, (context) => ({
        open: (item: string) => ({
          item,
          history: context.resolve(PurchaseHistory)?.forItem(item) ?? null,
        }),
      })),
    ],
    migrations: [
      {
        id: 'cat.0001-item',
        target: 'both',
        up: (session) => {
          session.put('table:item', true);
          return Promise.resolve();
        },
      },
    ],
  }),

  defineModule<MemorySession>({
    code: 'STK',
    labelKey: 'module.stk',
    dependsOn: ['CAT', 'FIN', 'SYS', 'SEC'],
    enhancedBy: ['PUR'],
    publishes: [{ type: ConsignmentUnitSold, labelKey: 'event.stk.consignment-unit-sold' }],
    provides: [
      provideContract(Selling, (context) => ({
        sell: async (item: string, by: CommandContext) => {
          await context.transactor.run(by, (uow) => {
            uow.session.put(`movement:${item}`, { kind: 'sale', item });
            // STK has never heard of PUR. It states what happened in its own
            // terms and stops there.
            uow.publish(ConsignmentUnitSold, { item, owed: '1200' });
            return Promise.resolve();
          });
        },
      })),
    ],
    migrations: [
      {
        id: 'stk.0001-movement',
        target: 'both',
        up: (session) => {
          session.put('table:movement', true);
          return Promise.resolve();
        },
      },
    ],
  }),

  defineModule<MemorySession>({
    code: 'PUR',
    labelKey: 'module.pur',
    dependsOn: ['CAT', 'STK', 'FIN', 'FX'],
    subscribes: [
      subscribeTo(ConsignmentUnitSold, async (event, context) => {
        // Its own transaction, carrying the correlation of the sale that caused
        // it, so the payable and the sale can be put back together afterwards.
        await context.transactor.run(event.context, (uow) => {
          uow.session.put(`payable:${event.payload.item}`, {
            owed: event.payload.owed,
            because: event.context.correlation,
          });
          return Promise.resolve();
        });
      }),
    ],
    provides: [
      provideContract(PurchaseHistory, () => ({
        forItem: (item: string) => [`${item}: 1,200 on 2026-09-01`],
      })),
    ],
    migrations: [
      {
        id: 'pur.0001-supplier',
        target: 'store-node',
        up: (session) => {
          session.put('table:supplier', true);
          return Promise.resolve();
        },
      },
    ],
  }),
];

const TENANT: Id<'tenant'> = newId<'tenant'>();

async function install(request: EditionRequest) {
  const plan = orThrow(composeEdition(catalogue, request), (refusal) => new Error(refusal.code));

  const handlerFailures: HandlerFailure[] = [];
  const bus = createEventBus({ onHandlerFailure: (failure) => handlerFailures.push(failure) });
  const store = createMemoryStore();
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock: systemClock,
    onEffectFailure: (failure) => {
      throw new Error(String(failure.cause));
    },
  });
  const registry = createRegistry({ catalogue, plan, bus, transactor, clock: systemClock });

  await runMigrations({
    plan: registry.migrationPlan('store-node'),
    transactor,
    context: systemContext(TENANT),
    journal: memoryJournal(),
  });

  return { plan, registry, store, handlerFailures };
}

const FULL: EditionRequest = { modules: [...CORE, 'CAT', 'STK', 'PUR'] };
const CASH_ONLY: EditionRequest = { modules: [...CORE, 'CAT', 'STK'] };

describe('an edition that bought purchasing', () => {
  it('creates every module table in dependency order', async () => {
    const { registry, store } = await install(FULL);
    expect(registry.migrationPlan('store-node').map((one) => one.id)).toEqual([
      'sys.0001-tenant',
      'cat.0001-item',
      'stk.0001-movement',
      'pur.0001-supplier',
    ]);
    for (const table of ['tenant', 'item', 'movement', 'supplier']) {
      expect(store.committed().get(`table:${table}`), table).toBe(true);
    }
  });

  it('raises the payable when a consignment unit is sold', async () => {
    const { registry, store, handlerFailures } = await install(FULL);
    const by = commandContext({ tenant: TENANT, actor: newId<'user'>() });

    await registry.require(Selling).sell('SKU-1', by);

    expect(store.committed().get('movement:SKU-1')).toEqual({ kind: 'sale', item: 'SKU-1' });
    expect(store.committed().get('payable:SKU-1')).toEqual({
      owed: '1200',
      because: by.correlation,
    });
    expect(handlerFailures).toEqual([]);
  });

  it('shows the purchase history on the item card', async () => {
    const { registry } = await install(FULL);
    expect(registry.require(ItemCard).open('SKU-1').history).toEqual([
      'SKU-1: 1,200 on 2026-09-01',
    ]);
  });
});

describe('an edition that did not', () => {
  it('is told what it is doing without', async () => {
    const { plan } = await install(CASH_ONLY);
    expect(plan.inactiveEnhancements).toEqual([
      { module: 'CAT', absent: 'PUR' },
      { module: 'STK', absent: 'PUR' },
    ]);
  });

  it('runs the same sale, and simply has no payable', async () => {
    const { registry, store, handlerFailures } = await install(CASH_ONLY);

    await registry.require(Selling).sell('SKU-1', systemContext(TENANT));

    expect(store.committed().get('movement:SKU-1')).toEqual({ kind: 'sale', item: 'SKU-1' });
    expect(store.committed().has('payable:SKU-1')).toBe(false);
    // Not an error and not a failure: nobody subscribed, because nobody was
    // bought. STK published into a room with no one in it and carried on.
    expect(handlerFailures).toEqual([]);
  });

  it('opens the same item card, without the section PUR owns', async () => {
    const { registry } = await install(CASH_ONLY);
    const card = registry.require(ItemCard).open('SKU-1');
    expect(card.item).toBe('SKU-1');
    expect(card.history).toBeNull();
  });

  it('never creates the tables of a module it did not buy', async () => {
    const { store } = await install(CASH_ONLY);
    expect(store.committed().has('table:supplier')).toBe(false);
    expect(store.committed().has('table:movement')).toBe(true);
  });
});
