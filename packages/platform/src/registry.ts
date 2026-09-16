import type { Clock } from '@vertex/kernel';

import type { AuthorisationScope, Authoriser } from './authorise.js';
import type { CommandContext } from './context.js';
import type { ContractKey } from './contract.js';
import {
  AuthoriserUnavailableError,
  ContractCycleError,
  ContractUnavailableError,
  DuplicateDeclarationError,
  RegistryError,
  UndeclaredEventError,
} from './errors.js';
import type { EventBus } from './events.js';
import type { EditionPlan } from './edition.js';
import type {
  AccountRoleDeclaration,
  MigrationDeclaration,
  ModuleCode,
  ModuleContext,
  ModuleDefinition,
  PermissionDeclaration,
  SettingDeclaration,
} from './module.js';
import type { Transactor } from './unit-of-work.js';

/**
 * The live set of modules: what an edition became once it started.
 *
 * It answers the four questions a host asks — what permissions exist, what
 * account roles need mapping, what settings exist, what has to be migrated —
 * and it is the only thing that knows all sixteen modules at once. A module
 * never sees this; it sees a ModuleContext, which can reach contracts and
 * nothing else.
 */
export interface Registry<Session = unknown> {
  readonly plan: EditionPlan;
  readonly modules: readonly ModuleDefinition<Session>[];
  module(code: ModuleCode): ModuleDefinition<Session> | null;

  readonly permissions: readonly PermissionDeclaration[];
  readonly accounts: readonly AccountRoleDeclaration[];
  readonly settings: readonly SettingDeclaration[];

  /** Everything to run, in activation order, for one kind of store. */
  migrationPlan(target: 'store-node' | 'terminal'): readonly MigrationDeclaration<Session>[];

  resolve<T>(key: ContractKey<T>): T | null;
  require<T>(key: ContractKey<T>): T;
  switchEnabled(key: string): boolean;

  /**
   * The same question a module asks through its context, offered to the host.
   *
   * A request boundary has to ask it too — an app screen calls a module's
   * contract, and the app is where a session becomes a `CommandContext`. One
   * implementation for both, so a module and the app in front of it can never
   * be answering to two different authorities.
   */
  authorise(by: CommandContext, right: string, where?: AuthorisationScope): Promise<boolean>;
}

export interface RegistryOptions<Session> {
  /** Every module this build knows how to host, enabled or not. */
  readonly catalogue: readonly ModuleDefinition<Session>[];
  readonly plan: EditionPlan;
  readonly bus: EventBus;
  readonly transactor: Transactor<Session>;
  readonly clock: Clock;
  /**
   * Which contract answers "may they" for every module in this edition.
   *
   * Named by the **host**, because the host composes the edition and is the one
   * thing `modules.md` §4 lets name a module: in every real edition it is
   * `Authorisation` from `@vertex/sec/contract`. The platform holds the key and
   * never the name, and resolves it on first use — `SEC` is built from this
   * same registry, so there is nothing to hand in at construction.
   *
   * Optional only so that a module's own tests can compose an edition of one.
   * Asking without it is a defect rather than a denial (`AuthoriserUnavailableError`).
   */
  readonly authorisedBy?: ContractKey<Authoriser>;
}

/**
 * Brings up the modules of one edition.
 *
 * Two things happen and neither can be left until later. Every declaration is
 * checked against the whole catalogue, because a subscription to an event that
 * no module publishes is a defect that produces no error at all at run time —
 * the handler simply never fires, and the symptom is a payable that was never
 * raised. And every subscription of an enabled module is wired to the bus, so
 * that the inversions of modules.md §5 are live from the first command.
 */
export function createRegistry<Session>(options: RegistryOptions<Session>): Registry<Session> {
  const { catalogue, plan, bus, transactor, clock } = options;

  // The plan is trusted to have come from `composeEdition` over this same
  // catalogue, and nothing made that true. Two definitions under one code
  // resolved silently to the last, and a module the plan enabled but the
  // catalogue lacked simply was not there — an edition short a module it was
  // sold, with nothing to say so until the first command that needed it.
  const seen = new Set<ModuleCode>();
  for (const definition of catalogue) {
    if (seen.has(definition.code)) {
      throw new DuplicateDeclarationError(`The catalogue holds ${definition.code} twice.`);
    }
    seen.add(definition.code);
  }
  const missing = [...plan.enabled].filter(
    (code) => !seen.has(code) || !plan.activation.includes(code),
  );
  if (missing.length > 0) {
    throw new RegistryError(
      `The plan enables ${missing.join(', ')}, which the catalogue or the activation order ` +
        'does not contain. Compose the plan from this catalogue with composeEdition.',
    );
  }

  const enabled = catalogue.filter((one) => plan.enabled.has(one.code));
  const byCode = new Map(enabled.map((one) => [one.code, one] as const));
  const inActivationOrder = plan.activation.flatMap((code) => {
    const definition = byCode.get(code);
    return definition === undefined ? [] : [definition];
  });

  // Every event any module in the **catalogue** declares, not just the enabled
  // ones: a subscription whose publisher this edition did not buy is inactive,
  // which is correct and expected; one whose event nobody declares anywhere is
  // a typo or a rename nobody followed through.
  const declaredEvents = new Set(
    catalogue.flatMap((one) => one.publishes.map((event) => event.type.name)),
  );
  for (const definition of enabled) {
    for (const subscription of definition.subscribes) {
      if (!declaredEvents.has(subscription.event)) {
        throw new UndeclaredEventError(
          `${definition.code} subscribes to "${subscription.event}", which no module publishes. ` +
            'Either the name is mistyped, or the event was renamed and this subscription was ' +
            'left behind — and a subscription that never fires raises no error on its own.',
        );
      }
    }
  }

  const provisions = new Map<string, (context: ModuleContext<Session>) => unknown>();
  for (const definition of inActivationOrder) {
    for (const provision of definition.provides) {
      provisions.set(provision.key.key, provision.create);
    }
  }

  const built = new Map<string, unknown>();
  const building = new Set<string>();

  const resolve = <T>(key: ContractKey<T>): T | null => {
    if (built.has(key.key)) {
      // Sound because provideContract checked the key against the value it
      // builds, at the one point where both types were still known.
      return built.get(key.key) as T;
    }
    const provision = provisions.get(key.key);
    if (provision === undefined) {
      return null;
    }
    if (building.has(key.key)) {
      throw new ContractCycleError(
        `Building "${key.key}" asked for itself, through: ${[...building].join(' → ')}.`,
      );
    }
    building.add(key.key);
    try {
      const value = provision(context) as T;
      built.set(key.key, value);
      return value;
    } finally {
      building.delete(key.key);
    }
  };

  // One frozen list, handed to the modules and reported by the registry, so
  // that what SEC seeds roles from and what a host shows in the role editor
  // cannot be two different answers to the same question.
  const declaredPermissions: readonly PermissionDeclaration[] = Object.freeze(
    inActivationOrder.flatMap((one) => [...one.permissions]),
  );

  /**
   * The system is not a person and holds every right, which is the same rule
   * `SEC` applies inside its own decision: a migration, a scheduled job, and a
   * sync applying work that was authorised on the register that did it all
   * arrive with no actor. Refusing them would leave a store node unable to take
   * up the trading of a shop that was offline, which is the one thing `POS-19`
   * promises. It is settled here as well as there so that a module cannot be
   * guarded into refusing its own installation.
   */
  const authorise = async (
    by: CommandContext,
    right: string,
    where?: AuthorisationScope,
  ): Promise<boolean> => {
    if (by.actor === null) return true;
    const key = options.authorisedBy;
    const authoriser = key === undefined ? null : resolve(key);
    if (authoriser === null) throw new AuthoriserUnavailableError(right);
    return authoriser.may(by, right, where);
  };

  const context: ModuleContext<Session> = {
    clock,
    transactor,
    declaredPermissions,
    authorise,
    resolve,
    require<T>(key: ContractKey<T>): T {
      const value = resolve(key);
      if (value === null) {
        throw new ContractUnavailableError(key.key);
      }
      return value;
    },
    switchEnabled(key: string): boolean {
      return plan.switches.get(key) ?? false;
    },
  };

  for (const definition of inActivationOrder) {
    for (const subscription of definition.subscribes) {
      bus.subscribe(subscription.event, definition.code, (event) =>
        subscription.handle(event, context),
      );
    }
  }

  return {
    plan,
    modules: Object.freeze(inActivationOrder),
    module(code: ModuleCode): ModuleDefinition<Session> | null {
      return byCode.get(code) ?? null;
    },
    permissions: declaredPermissions,
    accounts: Object.freeze(inActivationOrder.flatMap((one) => [...one.accounts])),
    settings: Object.freeze(inActivationOrder.flatMap((one) => [...one.settings])),
    migrationPlan(target: 'store-node' | 'terminal'): readonly MigrationDeclaration<Session>[] {
      return Object.freeze(
        inActivationOrder.flatMap((one) =>
          one.migrations.filter(
            (migration) => migration.target === target || migration.target === 'both',
          ),
        ),
      );
    },
    resolve,
    require<T>(key: ContractKey<T>): T {
      return context.require(key);
    },
    switchEnabled(key: string): boolean {
      return context.switchEnabled(key);
    },
    authorise,
  };
}
