import { newId, orThrow, systemClock } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import type { AuthorisationScope, Authoriser } from './authorise.js';
import { contractKey, type ContractKey } from './contract.js';
import { commandContext, systemContext } from './context.js';
import { composeEdition, type EditionPlan, type EditionRequest } from './edition.js';
import {
  AuthoriserUnavailableError,
  ContractCycleError,
  ContractUnavailableError,
  DuplicateDeclarationError,
  RegistryError,
  UndeclaredEventError,
} from './errors.js';
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
  authorisedBy?: ContractKey<Authoriser>,
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
    registry: createRegistry({
      catalogue,
      plan,
      bus,
      transactor,
      clock: systemClock,
      ...(authorisedBy === undefined ? {} : { authorisedBy }),
    }),
    bus,
    plan,
    store,
  };
}

describe('authorisation', () => {
  const Authority = contractKey<Authoriser>('sec.authorisation');
  const asked: { right: string; where: AuthorisationScope | undefined }[] = [];

  /**
   * `SEC` as the platform can ever see it: a shape resolved by key. The platform
   * holds no name of any module, so what answers is whatever the host said.
   */
  const sec = (answer: boolean): ModuleDefinition<MemorySession> =>
    defineModule<MemorySession>({
      code: 'SEC',
      labelKey: 'module.sec',
      dependsOn: ['SYS'],
      provides: [
        provideContract(Authority, () => ({
          may: (_by, right, where) => {
            asked.push({ right, where });
            return Promise.resolve(answer);
          },
        })),
      ],
    });

  // The real `SEC`, replaced by one that answers: every other module of the
  // core is left exactly as the rest of this file composes it.
  const catalogue = (answer: boolean): readonly ModuleDefinition<MemorySession>[] => [
    ...core.filter((one) => one.code !== 'SEC'),
    sec(answer),
  ];

  const somebody = commandContext({ tenant: newId<'tenant'>(), actor: newId<'user'>() });

  it('asks whatever the host named, and carries the place with the question', async () => {
    asked.length = 0;
    const branch = newId<'branch'>();
    const { registry } = bring(catalogue(true), { modules: [...CORE] }, Authority);

    expect(await registry.authorise(somebody, 'sys.branch.edit', { branch })).toBe(true);
    expect(asked).toEqual([{ right: 'sys.branch.edit', where: { branch } }]);
  });

  it('carries a refusal back as one', async () => {
    const { registry } = bring(catalogue(false), { modules: [...CORE] }, Authority);
    expect(await registry.authorise(somebody, 'sys.branch.edit', undefined)).toBe(false);
  });

  it('lets the system through without asking, since it has nobody to be', async () => {
    asked.length = 0;
    const { registry } = bring(catalogue(false), { modules: [...CORE] }, Authority);
    const system = systemContext(newId<'tenant'>());

    // A migration, a scheduled job, a sync applying work authorised on the
    // register that did it. `POS-19` turns on a store node being able to take
    // up the trading of a shop that was offline.
    expect(await registry.authorise(system, 'sys.branch.edit', undefined)).toBe(true);
    expect(asked).toEqual([]);
  });

  it('does not read a context that forgot its actor as the system', () => {
    // The system holds every right, so "nobody" has to be said. An optional
    // actor turned `{ tenant }` — a field forgotten by a caller, or dropped by a
    // payload in transit — into a context `authorise` said yes to without
    // asking the authoriser at all.
    const forgotten = { tenant: newId<'tenant'>() } as unknown as Parameters<
      typeof commandContext
    >[0];
    expect(() => commandContext(forgotten)).toThrow(TypeError);
  });

  it('raises rather than deciding for itself when the host wired nothing', async () => {
    // The two silent answers are both wrong. Yes hands the organisation of the
    // shop to whoever asked; no locks an administrator out of their own system
    // with nothing saying why. Either would be wrong on every machine this
    // edition is installed on, which makes it the host's defect to be told
    // about at the first question rather than at the first cashier.
    const { registry } = bring(catalogue(true), { modules: [...CORE] });

    await expect(registry.authorise(somebody, 'sys.branch.edit', undefined)).rejects.toThrow(
      AuthoriserUnavailableError,
    );
  });
});

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

  it('hands a module the same rights it reports to the host', () => {
    const Seeder = contractKey<{ seen(): readonly string[] }>('sec.seeder');
    const seeing = defineModule<MemorySession>({
      code: 'SEC',
      labelKey: 'module.sec',
      dependsOn: ['SYS'],
      permissions: [{ id: 'sec.role.edit', labelKey: 'permission.sec.role.edit' }],
      provides: [
        provideContract(Seeder, (context) => ({
          seen: () => context.declaredPermissions.map((one) => one.id),
        })),
      ],
    });

    const { registry } = bring(
      catalogue.map((one) => (one.code === 'SEC' ? seeing : one)),
      { modules: [...CORE] },
    );

    // SEC-01 seeds the seven roles out of this list and SEC-02 refuses to grant
    // a right outside it, so a module seeing a different list from the one the
    // role editor shows is a role editor offering ticks that do nothing.
    expect(registry.require(Seeder).seen()).toEqual(registry.permissions.map((one) => one.id));
    expect(registry.require(Seeder).seen()).toEqual(['sys.branch.manage', 'sec.role.edit']);
  });

  it('hands a module the same account roles it reports to the host', () => {
    const Mapper = contractKey<{ seen(): readonly string[] }>('fin.mapper');
    const mapping = defineModule<MemorySession>({
      code: 'FIN',
      labelKey: 'module.fin',
      dependsOn: ['SYS', 'SEC', 'FX'],
      accounts: [
        {
          role: 'fin.opening-balance-equity',
          labelKey: 'account-role.fin.opening-balance-equity',
          normalBalance: 'credit',
          reserved: 'opening-equity',
        },
      ],
      provides: [
        provideContract(Mapper, (context) => ({
          seen: () => context.declaredAccounts.map((one) => one.role),
        })),
      ],
    });

    const { registry } = bring(
      catalogue.map((one) => (one.code === 'FIN' ? mapping : one)),
      { modules: [...CORE] },
    );

    // FIN-01 maps every declared role to a tenant's account and refuses to map
    // one nobody declared, so a module seeing a different list from the one a
    // host reports is a mapping screen with rows that do nothing.
    expect(registry.require(Mapper).seen()).toEqual(registry.accounts.map((one) => one.role));
    expect(registry.require(Mapper).seen()).toEqual(['fin.opening-balance-equity']);
    expect(Object.isFrozen(registry.accounts)).toBe(true);
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

  it('refuses a plan that was not composed from the catalogue it is given', () => {
    // Nothing forced the two to match. Two definitions under one code resolved
    // to the last, and a module the plan enabled but the catalogue lacked was
    // simply absent — an edition short a module it was sold.
    const { plan } = bring(catalogue, { modules: [...CORE] });
    const wiring = (modules: readonly ModuleDefinition<MemorySession>[]) => () => {
      const store = createMemoryStore();
      const bus = createEventBus({ onHandlerFailure: () => undefined });
      createRegistry({
        catalogue: modules,
        plan,
        bus,
        transactor: createTransactor({
          driver: store.driver,
          bus,
          clock: systemClock,
          onEffectFailure: () => undefined,
        }),
        clock: systemClock,
      });
    };

    expect(wiring([...catalogue, catalogue[0]!])).toThrow(DuplicateDeclarationError);
    expect(wiring(catalogue.filter((one) => one.code !== 'FIN'))).toThrow(RegistryError);
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
    let handed: object | undefined;
    const sys = defineModule<MemorySession>({
      code: 'SYS',
      labelKey: 'module.sys',
      provides: [
        provideContract(Recorder, (context) => ({
          record: async () => {
            handed = context;
            await context.transactor.run(systemContext(newId<'tenant'>()), (uow) => {
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
    // Everything a module can reach is on the context it is handed, and there is
    // no member on it that leads to another module's data, to the bus or to the
    // registry — only to contracts, by key. A new member fails this on purpose.
    expect(Object.keys(handed ?? {}).sort()).toEqual([
      'authorise',
      'clock',
      'declaredAccounts',
      'declaredPermissions',
      'require',
      'resolve',
      'switchEnabled',
      'transactor',
    ]);
  });
});
