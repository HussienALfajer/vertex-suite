import { describe, expect, it } from 'vitest';

import { contractKey } from './contract.js';
import { ModuleDeclarationError } from './errors.js';
import { eventType } from './events.js';
import { defineModule, provideContract, subscribeTo } from './module.js';

const StockMoved = eventType<{ item: string }>('stk.stock-moved');

describe('defineModule', () => {
  it('takes the layer from the module map rather than from the module', () => {
    // A module that could call itself optional could be dropped from an edition
    // that everything else in the edition depends on.
    expect(defineModule({ code: 'SYS', labelKey: 'module.sys' }).layer).toBe('core');
    expect(defineModule({ code: 'CAT', labelKey: 'module.cat' }).layer).toBe('base');
    expect(defineModule({ code: 'POS', labelKey: 'module.pos' }).layer).toBe('optional');
  });

  it('refuses a name outside the module namespace', () => {
    expect(() =>
      defineModule({
        code: 'STK',
        labelKey: 'module.stk',
        permissions: [{ id: 'cat.item.create', labelKey: 'permission.cat.item.create' }],
      }),
    ).toThrow(ModuleDeclarationError);
  });

  it('refuses a namespace with nothing after it', () => {
    expect(() =>
      defineModule({
        code: 'STK',
        labelKey: 'module.stk',
        settings: [{ key: 'stk.', labelKey: 'setting.x', scope: 'tenant' }],
      }),
    ).toThrow(ModuleDeclarationError);
  });

  it('refuses one name used for two things', () => {
    expect(() =>
      defineModule({
        code: 'STK',
        labelKey: 'module.stk',
        permissions: [{ id: 'stk.adjust', labelKey: 'permission.stk.adjust' }],
        settings: [{ key: 'stk.adjust', labelKey: 'setting.stk.adjust', scope: 'branch' }],
      }),
    ).toThrow(ModuleDeclarationError);
  });

  it('refuses a module that names itself', () => {
    expect(() => defineModule({ code: 'STK', labelKey: 'module.stk', dependsOn: ['STK'] })).toThrow(
      ModuleDeclarationError,
    );
  });

  it('refuses a module that is both required and merely helpful', () => {
    // The distinction is the whole of modules.md §6: POS cannot run without
    // CSH, and merely loses the credit sale without SAL. A module that claimed
    // both about one companion has said nothing.
    expect(() =>
      defineModule({
        code: 'POS',
        labelKey: 'module.pos',
        dependsOn: ['SAL'],
        enhancedBy: ['SAL'],
      }),
    ).toThrow(ModuleDeclarationError);
  });

  it('refuses two handlers for one event in one module', () => {
    expect(() =>
      defineModule({
        code: 'PUR',
        labelKey: 'module.pur',
        subscribes: [
          subscribeTo(StockMoved, () => Promise.resolve()),
          subscribeTo(StockMoved, () => Promise.resolve()),
        ],
      }),
    ).toThrow(ModuleDeclarationError);
  });

  it('refuses a subscription to a name that belongs to nobody', () => {
    expect(() =>
      defineModule({
        code: 'PUR',
        labelKey: 'module.pur',
        subscribes: [subscribeTo(eventType('stock-moved'), () => Promise.resolve())],
      }),
    ).toThrow(ModuleDeclarationError);
  });

  it('accepts a complete declaration and freezes it', () => {
    const History = contractKey<{ read(): string }>('pur.item-purchase-history');
    const module = defineModule({
      code: 'PUR',
      labelKey: 'module.pur',
      dependsOn: ['CAT', 'STK', 'FIN', 'FX'],
      permissions: [{ id: 'pur.order.approve', labelKey: 'permission.pur.order.approve' }],
      accounts: [{ role: 'pur.payable', labelKey: 'account.pur.payable', normalBalance: 'credit' }],
      settings: [{ key: 'pur.landed-cost', labelKey: 'setting.pur.landed-cost', scope: 'tenant' }],
      switches: [
        { key: 'pur.consignment', labelKey: 'switch.pur.consignment', enabledByDefault: false },
      ],
      publishes: [{ type: eventType('pur.goods-received'), labelKey: 'event.pur.goods-received' }],
      subscribes: [subscribeTo(StockMoved, () => Promise.resolve())],
      provides: [provideContract(History, () => ({ read: () => 'x' }))],
      migrations: [{ id: 'pur.0001-supplier', target: 'store-node', up: () => Promise.resolve() }],
    });

    expect(module.layer).toBe('optional');
    expect(Object.isFrozen(module)).toBe(true);
    expect(Object.isFrozen(module.dependsOn)).toBe(true);
    expect(module.dependsOn).toEqual(['CAT', 'STK', 'FIN', 'FX']);
  });
});
