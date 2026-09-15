import { ok, refuse, type Refusal, type Result } from '@vertex/kernel';

import { RegistryError } from './errors.js';
import { MODULE_CODES, type ModuleCode, type ModuleDefinition } from './module.js';

/**
 * An edition: which modules a customer bought, and which switches they want.
 *
 * modules.md §1 — the unit of subtraction is the module, never the feature —
 * and §6 lists what each removal costs. This file is where an edition file is
 * checked against those rules, before a single table is created, on the
 * engineer's machine rather than in the shop.
 */
export interface EditionRequest {
  readonly modules: readonly ModuleCode[];
  readonly switches?: Readonly<Record<string, boolean>>;
}

/** A module is present, an optional companion is not, and something is therefore absent. */
export interface InactiveEnhancement {
  readonly module: ModuleCode;
  readonly absent: ModuleCode;
}

export interface EditionPlan {
  readonly enabled: ReadonlySet<ModuleCode>;
  /** Dependency order: nothing activates before what it depends on. */
  readonly activation: readonly ModuleCode[];
  /**
   * What this edition does without. Reported rather than merely permitted: the
   * person assembling the edition should read "POS is here, SAL is not, so
   * POS-12 credit sales are gone" at the moment they compose it.
   */
  readonly inactiveEnhancements: readonly InactiveEnhancement[];
  readonly switches: ReadonlyMap<string, boolean>;
}

export type EditionRefusalCode =
  | 'edition.unknown-module'
  | 'edition.core-module-omitted'
  | 'edition.missing-dependency'
  | 'edition.unknown-switch';

export type EditionRefusal = Refusal<EditionRefusalCode>;

function order(codes: Iterable<ModuleCode>): ModuleCode[] {
  return [...codes].sort((a, b) => MODULE_CODES.indexOf(a) - MODULE_CODES.indexOf(b));
}

/**
 * Arranges the enabled modules so that nothing activates before what it depends
 * on, with §3's own order as the tie-break.
 *
 * A cycle raises rather than refuses. It cannot be fixed by editing the edition
 * file — two modules declaring each other is a defect in the modules, identical
 * on every machine — and modules.md §4 rule 1 exists precisely to make it
 * impossible, so reaching here means the rule was broken.
 */
function activationOrder(
  dependencies: ReadonlyMap<ModuleCode, readonly ModuleCode[]>,
): ModuleCode[] {
  const outstanding = new Map<ModuleCode, Set<ModuleCode>>();
  for (const [code, required] of dependencies) {
    outstanding.set(code, new Set(required.filter((one) => dependencies.has(one))));
  }

  const activation: ModuleCode[] = [];
  while (outstanding.size > 0) {
    const ready = order(
      [...outstanding].filter(([, waitingFor]) => waitingFor.size === 0).map(([code]) => code),
    );

    if (ready.length === 0) {
      throw new RegistryError(
        `These modules depend on each other in a circle: ${order(outstanding.keys()).join(', ')}. ` +
          'A module may depend on another module, or publish an event the other subscribes to, ' +
          'but not both ways round — see modules.md §5 for the five places that reads backwards.',
      );
    }

    for (const code of ready) {
      activation.push(code);
      outstanding.delete(code);
    }
    for (const waitingFor of outstanding.values()) {
      for (const code of ready) waitingFor.delete(code);
    }
  }

  return activation;
}

/**
 * Checks an edition against the module map and works out what it activates.
 *
 * A missing dependency is **refused rather than filled in**. An edition file is
 * a commercial document: silently adding a module the customer did not buy is
 * both a licensing question and a surprise in the shop. The refusal names every
 * module that is missing, so that the file can be corrected in one pass.
 */
export function composeEdition<Session>(
  catalogue: readonly ModuleDefinition<Session>[],
  request: EditionRequest,
): Result<EditionPlan, EditionRefusal> {
  const byCode = new Map<ModuleCode, ModuleDefinition<Session>>();
  for (const definition of catalogue) {
    if (byCode.has(definition.code)) {
      throw new RegistryError(`The catalogue holds ${definition.code} twice.`);
    }
    byCode.set(definition.code, definition);
  }

  const unknown = order(new Set(request.modules.filter((code) => !byCode.has(code))));
  if (unknown.length > 0) {
    return refuse('edition.unknown-module', { modules: unknown.join(', ') });
  }

  const enabled = new Set(request.modules);

  const omittedCore = order(
    [...byCode.values()]
      .filter((one) => one.layer === 'core' && !enabled.has(one.code))
      .map((one) => one.code),
  );
  if (omittedCore.length > 0) {
    return refuse('edition.core-module-omitted', { modules: omittedCore.join(', ') });
  }

  const dependencies = new Map<ModuleCode, readonly ModuleCode[]>();
  const missing: string[] = [];
  for (const code of order(enabled)) {
    const required = byCode.get(code)?.dependsOn ?? [];
    dependencies.set(code, required);
    for (const one of required) {
      if (!enabled.has(one)) {
        missing.push(`${code} needs ${one}`);
      }
    }
  }
  if (missing.length > 0) {
    return refuse('edition.missing-dependency', { requirements: missing.join('; ') });
  }

  const inactiveEnhancements: InactiveEnhancement[] = [];
  for (const code of order(enabled)) {
    for (const absent of byCode.get(code)?.enhancedBy ?? []) {
      if (!enabled.has(absent)) {
        inactiveEnhancements.push({ module: code, absent });
      }
    }
  }

  const switches = new Map<string, boolean>();
  for (const code of order(enabled)) {
    for (const declared of byCode.get(code)?.switches ?? []) {
      switches.set(declared.key, declared.enabledByDefault);
    }
  }

  const requested = request.switches ?? {};
  const unknownSwitches = Object.keys(requested)
    .filter((key) => !switches.has(key))
    .sort();
  if (unknownSwitches.length > 0) {
    // Including a switch belonging to a module this edition did not buy. Left
    // unchecked, a renamed switch would go on reading as "off" for years.
    return refuse('edition.unknown-switch', { switches: unknownSwitches.join(', ') });
  }
  for (const [key, value] of Object.entries(requested)) {
    switches.set(key, value);
  }

  return ok(
    Object.freeze({
      enabled: new Set(order(enabled)),
      activation: Object.freeze(activationOrder(dependencies)),
      inactiveEnhancements: Object.freeze(inactiveEnhancements),
      switches: new Map([...switches].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    }),
  );
}
