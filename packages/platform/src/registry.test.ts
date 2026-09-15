import { newId, orThrow, systemClock } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import { contractKey } from './contract.js';
import { commandContext } from './context.js';
import { composeEdition, type EditionPlan, type EditionRequest } from './edition.js';
import { ContractCycleError, ContractUnavailableError, UndeclaredEventError } from './errors.js';
import { createEventBus, eventType, type EventBus } from './events.js';
import {
  defineModule,
  provideContract,
  subscribeTo,
  type ModuleCode,
  type ModuleDefinition,
} from './module.js';
import { createRegistry, type Registry } from './registry.js';
import {
  createMemoryStore,
  createTransactor,
  type MemorySession,
  type MemoryStore,
} from './unit-of-work.js';

const ConsignmentUnitSold = eventType<{ item: string }>('stk.consignment-unit-sold');
const PurchaseHistory = contractKey<{ forItem(item: string): string[] }>(
  'pur.item-purchase-history',
);

const CORE: readonly ModuleCode[] = ['SYS', 'SEC', 'FX', 'FIN'];

const core: readonly ModuleDefinition<MemorySession>[] = [
  defineModule({ code: 'SYS', labelKey: 'module.sys' }),
  defineModule({ code: 'SEC', labelKey: 'module.sec', dependsOn: ['SYS'] }),
  defineModule({ code: 'FX', labelKey: 'module.fx', dependsOn: ['SYS'] }),
  defineModule({ code: 'FIN', labelKey: 'module.fin', dependsOn: ['FX', 'SEC'] }),
];

interface Brought {
  readonly registry: Registry<MemorySession>;
  readonly bus: EventBus;
  readonly plan: EditionPlan;
  readonly store: MemoryStore;
}

function bring(
  catalogue: readonly ModuleDefinition<MemorySession>[],
  request: EditionRequest,
): Brought {
  const composed = composeEdition(catalogue, request);
  const plan = orThrow(composed, (refusal) => new Error(refusal.code));
  const bus = createEventBus({
    onHandlerFailure: () => {
      throw new Error('no handler should fail in this test');
    },
  });
  const store = createMemoryStore();
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock: systemClock,
    onEffectFailure: () => {
      throw new Error('no effect should fail in this test');
    },
  });
  return {
    registry: createRegistry({ catalogue, plan, bus, transactor, clock: systemClock }),
    bus,
    plan,
    store,
  };
}

describe('subscriptions', () => {
  const stk = defineModule<MemorySession>({
    code: 'STK',
    labelKey: 'module.stk',
    dependsOn: ['FIN'],
    publishes: [{ type: ConsignmentUnitSold, labelKey: 'event.stk.consignment-unit-sold' }],
  });
  const pur = defineModule<MemorySession>({
    code: 'PUR',
    labelKey: 'module.pur',
    dependsOn: ['STK'],
    subscribes: [subscribeTo(ConsignmentUnitSold, () => Promise.resolve())],
  });

  it('wires what an enabled module declared', () => {
    const { bus } = bring([...core, stk, pur], { modules: [...CORE, 'STK', 'PUR'] });
    expect(bus.subscriberCount(ConsignmentUnitSold.name)).toBe(1);
  });

  it('wires nothing for a module this edition did not buy', () => {
    const { bus } = bring([...core, stk, pur], { modules: [...CORE, 'STK'] });
    expect(bus.subscriberCount(ConsignmentUnitSold.name)).toBe(0);
  });

  it('refuses a subscription to an event nobody publishes', () => {
    // The symptom otherwise is silence: the handler never fires, no error is
    // raised anywhere, and the payable is simply never created.
    const strayed = defineModule<MemorySession>({
      code: 'PUR',
      labelKey: 'module.pur',
      subscribes: [subscribeTo(eventType('stk.consignment-unit-sld'), () => Promise.resolve())],
    });
    expect(() => bring([...core, strayed], { modules: [...CORE, 'PUR'] })).toThrow(
      UndeclaredEventError,
    );
  });
});

describe('contracts', () => {
  let built = 0;
  const pur = defineModule<MemorySession>({
    code: 'PUR',
    labelKey: 'module.pur',
    provides: [
      provideContract(PurchaseHistory, () => {
        built += 1;
        return { forItem: (item: string) => [`${item}: 1200 SYP`] };
      }),
    ],
  });

  it('hands back null when no module in this edition provides it', () => {
    // CAT-16: the item card simply has no purchase-history section, which is
    // what the customer bought when they left PUR out.
    const { registry } = bring([...core], { modules: [...CORE] });
    expect(registry.resolve(PurchaseHistory)).toBeNull();
  });

  it('raises when something required it and the provider is absent', () => {
    const { registry } = bring([...core], { modules: [...CORE] });
    expect(() => registry.require(PurchaseHistory)).toThrow(ContractUnavailableError);
  });

  it('builds it once, however many modules ask', () => {
    built = 0;
    const { registry } = bring([...core, pur], { modules: [...CORE, 'PUR'] });
    const first = registry.require(PurchaseHistory);
    const second = registry.require(PurchaseHistory);

    expect(first).toBe(second);
    expect(built).toBe(1);
    expect(first.forItem('SKU-1')).toEqual(['SKU-1: 1200 SYP']);
  });

  it('refuses to build two contracts that need each other', () => {
    const A = contractKey<{ a: string }>('stk.a');
    const B = contractKey<{ b: string }>('pur.b');
    const catalogue: readonly ModuleDefinition<MemorySession>[] = [
      ...core,
      defineModule<MemorySession>({
        code: 'STK',
        labelKey: 'module.stk',
        provides: [provideContract(A, (context) => ({ a: context.require(B).b }))],
      }),
      defineModule<MemorySession>({
        code: 'PUR',
        labelKey: 'module.pur',
        provides: [provideContract(B, (context) => ({ b: context.require(A).a }))],
      }),
    ];
    const { registry } = bring(catalogue, { modules: [...CORE, 'STK', 'PUR'] });
    expect(() => registry.require(A)).toThrow(ContractCycleError);
  });
});

describe('what the host asks the registry', () => {
  const catalogue: readonly ModuleDefinition<MemorySession>[] = [
    defineModule<MemorySession>({
      code: 'SYS',
      labelKey: 'module.sys',
      permissions: [{ id: 'sys.branch.manage', labelKey: 'permission.sys.branch.manage' }],
      migrations: [{ id: 'sys.0001-tenant', target: 'both', up: () => Promise.resolve() }],
    }),
    defineModule<MemorySession>({
      code: 'SEC',
      labelKey: 'module.sec',
      dependsOn: ['SYS'],
      permissions: [
        { id: 'sec.user.create', labelKey: 'permission.sec.user.create' },
        { id: 'sec.cost.see', labelKey: 'permission.sec.cost.see', sensitive: true },
      ],
      migrations: [{ id: 'sec.0001-user', target: 'store-node', up: () => Promise.resolve() }],
    }),
    defineModule<MemorySession>({ code: 'FX', labelKey: 'module.fx', dependsOn: ['SYS'] }),
    defineModule<MemorySession>({
      code: 'FIN',
      labelKey: 'module.fin',
      dependsOn: ['FX', 'SEC'],
      accounts: [
        { role: 'fin.rounding', labelKey: 'account.fin.rounding', normalBalance: 'debit' },
      ],
      settings: [
        { key: 'fin.fiscal-start', labelKey: 'setting.fin.fiscal-start', scope: 'tenant' },
      ],
      switches: [
        { key: 'fin.strict-periods', labelKey: 'switch.fin.strict', enabledByDefault: true },
      ],
      migrations: [{ id: 'fin.0001-account', target: 'terminal', up: () => Promise.resolve() }],
    }),
  ];

  it('aggregates declarations in activation order', () => {
    const { registry } = bring(catalogue, { modules: [...CORE] });
    expect(registry.permissions.map((one) => one.id)).toEqual([
      'sys.branch.manage',
      'sec.user.create',
      'sec.cost.see',
    ]);
    expect(registry.accounts.map((one) => one.role)).toEqual(['fin.rounding']);
    expect(registry.settings.map((one) => one.key)).toEqual(['fin.fiscal-start']);
  });

  it('plans migrations per store, in the order the modules activate', () => {
    const { registry } = bring(catalogue, { modules: [...CORE] });
    expect(registry.migrationPlan('store-node').map((one) => one.id)).toEqual([
      'sys.0001-tenant',
      'sec.0001-user',
    ]);
    // The register's own store carries only what the register needs: no user
    // table, and no cost figure anywhere near it (PRC-07).
    expect(registry.migrationPlan('terminal').map((one) => one.id)).toEqual([
      'sys.0001-tenant',
      'fin.0001-account',
    ]);
  });

  it('answers for a switch, and says no for one nothing declared', () => {
    const { registry } = bring(catalogue, {
      modules: [...CORE],
      switches: { 'fin.strict-periods': false },
    });
    expect(registry.switchEnabled('fin.strict-periods')).toBe(false);
    expect(registry.switchEnabled('pos.nothing-declares-this')).toBe(false);
  });

  it('knows which modules it is running', () => {
    const { registry } = bring(catalogue, { modules: [...CORE] });
    expect(registry.modules.map((one) => one.code)).toEqual(['SYS', 'SEC', 'FX', 'FIN']);
    expect(registry.module('FIN')?.layer).toBe('core');
    expect(registry.module('POS')).toBeNull();
  });
});

describe('what a module is handed', () => {
  it('can open a transaction and read the clock, and can reach nothing else', async () => {
    const Recorder = contractKey<{ record(): Promise<void> }>('sys.recorder');
    const sys = defineModule<MemorySession>({
      code: 'SYS',
      labelKey: 'module.sys',
      provides: [
        provideContract(Recorder, (context) => ({
          record: async () => {
            await context.transactor.run(commandContext({ tenant: newId<'tenant'>() }), (uow) => {
              uow.session.put('recorded-at', context.clock.now());
              return Promise.resolve();
            });
          },
        })),
      ],
    });

    const { registry, store } = bring([sys, ...core.slice(1)], { modules: [...CORE] });
    await registry.require(Recorder).record();

    expect(store.committed().has('recorded-at')).toBe(true);
    // Everything a module can reach is on this object, and there is no member
    // on it that leads to another module's data — only to its contracts.
    expect(Object.keys(registry.require(Recorder))).toEqual(['record']);
  });
});
