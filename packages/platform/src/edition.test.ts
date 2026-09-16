import { isErr, isOk } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import { composeEdition } from './edition.js';
import { DuplicateDeclarationError, RegistryError } from './errors.js';
import { defineModule, type ModuleCode, type ModuleDefinition } from './module.js';

/**
 * modules.md §3's dependency table, with one reading made explicit.
 *
 * §3 lists SAL among POS's dependencies; §6 says the hard couplings among
 * optional modules are POS→CSH, POS→HW and POS→SYN and nothing else, and that
 * losing SAL costs POS only its credit sale (POS-12). §6 is the one that says
 * it is stating "the constraints an edition file must satisfy", so SAL is an
 * enhancement here. Modelled the other way, every cash-only shop would have to
 * buy receivables it will never open.
 */
const CATALOGUE: readonly ModuleDefinition[] = [
  defineModule({ code: 'SYS', labelKey: 'module.sys' }),
  defineModule({ code: 'SEC', labelKey: 'module.sec', dependsOn: ['SYS'] }),
  defineModule({ code: 'FX', labelKey: 'module.fx', dependsOn: ['SYS'] }),
  defineModule({ code: 'FIN', labelKey: 'module.fin', dependsOn: ['FX', 'SYS', 'SEC'] }),
  defineModule({
    code: 'CAT',
    labelKey: 'module.cat',
    dependsOn: ['SYS', 'SEC', 'FX'],
    // CAT-16: the item card shows a purchase-price history PUR owns.
    enhancedBy: ['PUR'],
  }),
  defineModule({ code: 'PRC', labelKey: 'module.prc', dependsOn: ['CAT', 'FX', 'SYS', 'SEC'] }),
  defineModule({
    code: 'STK',
    labelKey: 'module.stk',
    dependsOn: ['CAT', 'FIN', 'SYS', 'SEC'],
    // STK-11: consignment stock is sold by STK and paid for by PUR.
    enhancedBy: ['PUR'],
  }),
  defineModule({ code: 'SYN', labelKey: 'module.syn', dependsOn: ['SYS', 'SEC'] }),
  defineModule({ code: 'PUR', labelKey: 'module.pur', dependsOn: ['CAT', 'STK', 'FIN', 'FX'] }),
  defineModule({
    code: 'SAL',
    labelKey: 'module.sal',
    dependsOn: ['CAT', 'STK', 'PRC', 'FIN', 'FX'],
  }),
  defineModule({
    code: 'CSH',
    labelKey: 'module.csh',
    dependsOn: ['FIN', 'FX'],
    switches: [
      { key: 'csh.blind-count', labelKey: 'switch.csh.blind-count', enabledByDefault: true },
    ],
  }),
  defineModule({
    code: 'POS',
    labelKey: 'module.pos',
    dependsOn: ['CAT', 'PRC', 'STK', 'CSH', 'HW', 'SYN'],
    enhancedBy: ['SAL'],
    switches: [
      { key: 'pos.price-check', labelKey: 'switch.pos.price-check', enabledByDefault: true },
      { key: 'pos.customer-display', labelKey: 'switch.pos.display', enabledByDefault: false },
    ],
  }),
  defineModule({ code: 'CNT', labelKey: 'module.cnt', dependsOn: ['CAT', 'STK', 'FIN'] }),
  defineModule({ code: 'HW', labelKey: 'module.hw', dependsOn: ['SYS'] }),
  defineModule({ code: 'RPT', labelKey: 'module.rpt' }),
];

const CORE: readonly ModuleCode[] = ['SYS', 'SEC', 'FX', 'FIN'];
const BASE: readonly ModuleCode[] = ['CAT', 'PRC', 'STK', 'SYN'];

describe('composeEdition', () => {
  it('orders activation so nothing starts before what it depends on', () => {
    const composed = composeEdition(CATALOGUE, {
      modules: [...CORE, ...BASE, 'HW', 'CSH', 'POS'],
    });
    expect(isOk(composed)).toBe(true);
    if (!isOk(composed)) return;

    const position = (code: ModuleCode): number => composed.value.activation.indexOf(code);
    expect(position('SYS')).toBe(0);
    for (const definition of CATALOGUE) {
      if (!composed.value.enabled.has(definition.code)) continue;
      for (const required of definition.dependsOn) {
        expect(position(required)).toBeLessThan(position(definition.code));
      }
    }
  });

  it('refuses a module this build does not have', () => {
    const composed = composeEdition(CATALOGUE, { modules: [...CORE, 'MIG'] });
    expect(isErr(composed) && composed.error.code).toBe('edition.unknown-module');
    expect(isErr(composed) && composed.error.values['modules']).toBe('MIG');
  });

  it('refuses to leave out a core module', () => {
    // "Removing it is not a configuration, it is a different product" — §3.
    const composed = composeEdition(CATALOGUE, { modules: ['SYS', 'SEC'] });
    expect(isErr(composed) && composed.error.code).toBe('edition.core-module-omitted');
    expect(isErr(composed) && composed.error.values['modules']).toBe('FX, FIN');
  });

  it('names every missing dependency at once, rather than adding them silently', () => {
    // An edition file is a commercial document. Quietly shipping CSH, HW and
    // SYN because POS wanted them is a licensing decision made by a resolver.
    const composed = composeEdition(CATALOGUE, { modules: [...CORE, ...BASE, 'POS'] });
    expect(isErr(composed) && composed.error.code).toBe('edition.missing-dependency');
    expect(isErr(composed) && composed.error.values['requirements']).toBe(
      'POS needs CSH; POS needs HW',
    );
  });

  it('reports what an edition does without, without refusing it', () => {
    const composed = composeEdition(CATALOGUE, {
      modules: [...CORE, ...BASE, 'HW', 'CSH', 'POS'],
    });
    expect(isOk(composed)).toBe(true);
    if (!isOk(composed)) return;

    // A cash-only shop: POS runs, and POS-12 credit sales and the CAT-16
    // purchase history are simply not there.
    expect(composed.value.inactiveEnhancements).toEqual([
      { module: 'CAT', absent: 'PUR' },
      { module: 'STK', absent: 'PUR' },
      { module: 'POS', absent: 'SAL' },
    ]);
  });

  it('takes switch defaults from the modules and lets the edition override them', () => {
    const composed = composeEdition(CATALOGUE, {
      modules: [...CORE, ...BASE, 'HW', 'CSH', 'POS'],
      switches: { 'pos.customer-display': true, 'csh.blind-count': false },
    });
    expect(isOk(composed)).toBe(true);
    if (!isOk(composed)) return;

    expect([...composed.value.switches]).toEqual([
      ['csh.blind-count', false],
      ['pos.customer-display', true],
      ['pos.price-check', true],
    ]);
  });

  it('refuses a switch no module in this edition declares', () => {
    const composed = composeEdition(CATALOGUE, {
      modules: [...CORE, ...BASE],
      switches: { 'pos.price-check': true },
    });
    expect(isErr(composed) && composed.error.code).toBe('edition.unknown-switch');
  });

  it('raises rather than refuses when two modules depend on each other', () => {
    // Not something an edition file can fix: it is the same defect on every
    // machine, and modules.md §4 exists to make it impossible.
    const circular: readonly ModuleDefinition[] = [
      defineModule({ code: 'SYS', labelKey: 'module.sys' }),
      defineModule({ code: 'SEC', labelKey: 'module.sec', dependsOn: ['SYS'] }),
      defineModule({ code: 'FX', labelKey: 'module.fx', dependsOn: ['SYS'] }),
      defineModule({ code: 'FIN', labelKey: 'module.fin', dependsOn: ['FX', 'CSH'] }),
      defineModule({ code: 'CSH', labelKey: 'module.csh', dependsOn: ['FIN'] }),
    ];
    expect(() => composeEdition(circular, { modules: ['SYS', 'SEC', 'FX', 'FIN', 'CSH'] })).toThrow(
      RegistryError,
    );
  });

  it('raises when the catalogue holds one module twice', () => {
    // Its own subtype, not the plain `RegistryError` the cycle above raises: a
    // host wiring an edition can catch this one case — two claims on one
    // module identity — by name.
    expect(() =>
      composeEdition([...CATALOGUE, defineModule({ code: 'SYS', labelKey: 'module.sys' })], {
        modules: [...CORE],
      }),
    ).toThrow(DuplicateDeclarationError);
  });
});
