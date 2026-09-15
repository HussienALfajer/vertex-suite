import { isSeededRole, OWNER, type SeededRole } from '@vertex/contracts';
import type { Clock } from '@vertex/kernel';

import type { AuthorisationScope } from './authorise.js';
import type { CommandContext } from './context.js';
import type { ContractKey, ContractResolver } from './contract.js';
import { ModuleDeclarationError } from './errors.js';
import type { DomainEvent, EventType } from './events.js';
import type { Transactor } from './unit-of-work.js';

/**
 * The sixteen modules of modules.md §3, in the order that document lists them.
 *
 * This is the one thing about modules that the platform knows. It is not a
 * breach of "platform knows how to host a module but not what any module does":
 * the codes and the layer are what an **edition** is made of, and an edition
 * that cannot be checked before it is installed is a customer discovering at
 * the till that half a screen is missing.
 *
 * The order is also the deterministic tie-break when several modules are ready
 * to activate at once, so an edition's activation order is a property of the
 * edition rather than of the order somebody happened to pass the modules in.
 */
export const MODULE_CODES = [
  'SYS',
  'SEC',
  'FX',
  'FIN',
  'CAT',
  'PRC',
  'STK',
  'SYN',
  'PUR',
  'SAL',
  'CSH',
  'POS',
  'CNT',
  'HW',
  'MIG',
  'RPT',
] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];

/**
 * How deeply a module is wired in, and therefore what it costs to leave out
 * (modules.md §3).
 *
 * **core** — every edition ships it; removing it is a different product.
 * **base** — every edition that holds or sells goods ships it.
 * **optional** — removable with no effect on anything above it.
 */
export type ModuleLayer = 'core' | 'base' | 'optional';

export const MODULE_LAYERS: Readonly<Record<ModuleCode, ModuleLayer>> = Object.freeze({
  SYS: 'core',
  SEC: 'core',
  FX: 'core',
  FIN: 'core',
  CAT: 'base',
  PRC: 'base',
  STK: 'base',
  SYN: 'base',
  PUR: 'optional',
  SAL: 'optional',
  CSH: 'optional',
  POS: 'optional',
  CNT: 'optional',
  HW: 'optional',
  MIG: 'optional',
  RPT: 'optional',
});

const MODULE_CODE_SET: ReadonlySet<string> = new Set(MODULE_CODES);

export function isModuleCode(value: string): value is ModuleCode {
  return MODULE_CODE_SET.has(value);
}

/** The prefix every name a module declares has to start with: SEC becomes "sec.". */
export function namespaceOf(code: ModuleCode): string {
  return `${code.toLowerCase()}.`;
}

/**
 * A permission a module defines (SEC-02).
 *
 * The label is a terminology key, never a sentence: design-system.md §12 puts
 * every user-facing string in the terminology layer, and the permission list is
 * a screen an administrator reads in Arabic.
 */
export interface PermissionDeclaration {
  readonly id: string;
  readonly labelKey: string;
  /** SEC-05: re-authorisation, and an audit record, before the action proceeds. */
  readonly sensitive?: boolean;
  /**
   * Which of the seven seeded roles hold this right when a tenant is set up
   * (SEC-01), and nothing more than that.
   *
   * The module that defines a right is the only one that knows who needs it: a
   * warehouse keeper's business with a stock location is CAT and STK's
   * knowledge, not SEC's. The alternative — SEC holding a table of every
   * module's rights — makes shipping a module an edit to SEC, and an edition
   * that omits that module a table with dead rows in it.
   *
   * It is a **seed and not a rule**: the roles are ordinary editable rows from
   * the moment they exist, so a shop that wants its cashiers counting stock
   * says so once in the role editor and this list never argues with it.
   *
   * `owner` is refused here. The owner holds every right the edition declares,
   * computed by SEC rather than listed by each module, because a list is
   * something a module can forget to join — and an owner who cannot do one
   * thing in their own shop has no way to find out why.
   */
  readonly seededFor?: readonly SeededRole[];
}

/**
 * A ledger account a module needs, named by its **role** rather than its code.
 *
 * FIN-01 gives the tenant its own chart of accounts, so "1200" means whatever
 * that tenant decided. A module that hard-coded a number would be wrong in the
 * second shop it was installed in. It declares stk.inventory; FIN maps the role
 * to the tenant's account.
 */
export interface AccountRoleDeclaration {
  readonly role: string;
  readonly labelKey: string;
  readonly normalBalance: 'debit' | 'credit';
}

export interface SettingDeclaration {
  readonly key: string;
  readonly labelKey: string;
  /** The level a value may be set at. A register may differ from its branch. */
  readonly scope: 'tenant' | 'branch' | 'register';
}

/**
 * A switch an edition turns on or off within a module it has bought.
 *
 * The unit of subtraction is the module (modules.md §1); a switch is the finer
 * dial inside one, for behaviour a shop either wants or does not.
 */
export interface FeatureSwitchDeclaration {
  readonly key: string;
  readonly labelKey: string;
  readonly enabledByDefault: boolean;
}

export interface EventDeclaration {
  readonly type: EventType<unknown>;
  readonly labelKey: string;
}

/** Where a migration runs: the store node, the register's own store, or both. */
export type MigrationTarget = 'store-node' | 'terminal' | 'both';

/**
 * One irreversible step in a module's own schema.
 *
 * There is no down migration, and its absence is a decision. Reversing a
 * schema change on live retail data is a fiction the moment any row has been
 * written against the new shape. SYS-10 already states the real mechanism: the
 * installer snapshots, migrates, and restores the snapshot if any health or
 * integrity check fails. A half-believed down migration would only stand
 * between an operator and that snapshot.
 */
export interface MigrationDeclaration<Session = unknown> {
  readonly id: string;
  readonly target: MigrationTarget;
  up(session: Session): Promise<void>;
}

/**
 * What a module is handed: the time, a way to start a transaction, the
 * contracts of the modules present in this edition, and its own switches.
 *
 * Note what is absent. There is no way to ask for another module's repository,
 * table or screen, because modules.md §4 does not permit it and a platform that
 * offered it would make the rule a matter of discipline again.
 */
export interface ModuleContext<Session = unknown> extends ContractResolver {
  readonly clock: Clock;
  readonly transactor: Transactor<Session>;
  /**
   * Whether this caller may do this, here (`SEC-02`, `SEC-04`).
   *
   * The seam of `authorise.ts`: a module asks without knowing that `SEC` is
   * what answers, because it may not know. A command whose right is declared
   * and never asked is a right that reads on the role editor as protection and
   * is none — so a module guards its own commands with this, exactly as `SEC`
   * guards its own with its own decision.
   *
   * Throws when the edition was composed with nothing that can answer. That is
   * the host's wiring rather than the caller's command, and a silent yes or a
   * silent no would each be wrong in a way nobody could see.
   */
  authorise(by: CommandContext, right: string, where?: AuthorisationScope): Promise<boolean>;
  switchEnabled(key: string): boolean;
  /**
   * Every right the modules of **this edition** declare, and SEC is why it is
   * here.
   *
   * SEC-01 seeds the seven roles out of what an edition actually has, and
   * SEC-02 refuses to grant a right no module declared. Neither is answerable
   * from inside SEC alone: a role holding `pos.sale.create` in an edition that
   * did not buy POS is a tick in the role editor that silently does nothing,
   * and nothing about it looks wrong.
   *
   * It is names, never behaviour. A module still cannot reach another module's
   * repository, table or screen — the list says what may be asked for, which is
   * public by construction, since every one of these ends up on a screen an
   * administrator reads.
   */
  readonly declaredPermissions: readonly PermissionDeclaration[];
}

export interface ContractProvision<Session = unknown> {
  readonly key: ContractKey<unknown>;
  readonly create: (context: ModuleContext<Session>) => unknown;
}

/**
 * Offers an implementation of a contract to whichever modules ask for it.
 *
 * Built on first resolution rather than at registration, so that a provider may
 * itself resolve contracts — the registry detects a cycle if two of them ask
 * for each other.
 */
export function provideContract<T, Session = unknown>(
  key: ContractKey<T>,
  create: (context: ModuleContext<Session>) => T,
): ContractProvision<Session> {
  // This call is the checkpoint. A provision has to sit in a list beside
  // provisions of other shapes, which widens what it builds to unknown; here,
  // and only here, the key's type and the value's type are both still known and
  // are required to agree.
  return { key, create };
}

export interface SubscriptionDeclaration<Session = unknown> {
  readonly event: string;
  handle(event: DomainEvent, context: ModuleContext<Session>): Promise<void>;
}

/**
 * Subscribes to another module's event.
 *
 * The event type comes from the publishing module's contract, so the name is
 * never retyped and the payload is checked against what the publisher declared.
 */
export function subscribeTo<Payload, Session = unknown>(
  type: EventType<Payload>,
  handle: (event: DomainEvent<Payload>, context: ModuleContext<Session>) => Promise<void>,
): SubscriptionDeclaration<Session> {
  return {
    event: type.name,
    handle(event: DomainEvent, context: ModuleContext<Session>): Promise<void> {
      // Sound because the bus only ever delivers an event to handlers
      // registered under its own name, and the name came from this type.
      return handle(event as DomainEvent<Payload>, context);
    },
  };
}

export interface ModuleInput<Session = unknown> {
  readonly code: ModuleCode;
  readonly labelKey: string;
  /** Absent, the module cannot run at all. The edition refuses to compose. */
  readonly dependsOn?: readonly ModuleCode[];
  /**
   * Absent, a named part of this module is simply not there.
   *
   * modules.md §6 is full of these and they are not the same as a dependency.
   * POS needs CSH, HW and SYN to exist at all; it merely loses the credit sale
   * of POS-12 when SAL is not bought. Writing the second as a dependency would
   * force every cash-only shop to buy receivables.
   */
  readonly enhancedBy?: readonly ModuleCode[];
  readonly permissions?: readonly PermissionDeclaration[];
  readonly accounts?: readonly AccountRoleDeclaration[];
  readonly settings?: readonly SettingDeclaration[];
  readonly switches?: readonly FeatureSwitchDeclaration[];
  readonly publishes?: readonly EventDeclaration[];
  readonly subscribes?: readonly SubscriptionDeclaration<Session>[];
  readonly provides?: readonly ContractProvision<Session>[];
  readonly migrations?: readonly MigrationDeclaration<Session>[];
}

export interface ModuleDefinition<Session = unknown> {
  readonly code: ModuleCode;
  readonly layer: ModuleLayer;
  readonly labelKey: string;
  readonly dependsOn: readonly ModuleCode[];
  readonly enhancedBy: readonly ModuleCode[];
  readonly permissions: readonly PermissionDeclaration[];
  readonly accounts: readonly AccountRoleDeclaration[];
  readonly settings: readonly SettingDeclaration[];
  readonly switches: readonly FeatureSwitchDeclaration[];
  readonly publishes: readonly EventDeclaration[];
  readonly subscribes: readonly SubscriptionDeclaration<Session>[];
  readonly provides: readonly ContractProvision<Session>[];
  readonly migrations: readonly MigrationDeclaration<Session>[];
}

function requireNamespaced(code: ModuleCode, what: string, name: string, seen: Set<string>): void {
  const prefix = namespaceOf(code);
  if (!name.startsWith(prefix) || name.length <= prefix.length) {
    throw new ModuleDeclarationError(
      `${code} declares the ${what} "${name}", which is outside its own namespace. ` +
        `Every name a module owns begins with "${prefix}", so that two modules in one ` +
        'edition can never claim the same one and so that reading a name tells you who owns it.',
    );
  }
  if (seen.has(name)) {
    throw new ModuleDeclarationError(`${code} declares the ${what} "${name}" twice.`);
  }
  seen.add(name);
}

/**
 * A seed that names a role nobody seeds is a right that quietly reaches nobody.
 *
 * Checked at declaration for the same reason as the namespace: it is wrong
 * identically on every machine this edition is installed on, and the symptom
 * otherwise arrives months later as a job somebody cannot do, with a role
 * editor that looks right.
 */
function requireSeededRoles(code: ModuleCode, permission: PermissionDeclaration): void {
  const seen = new Set<SeededRole>();
  for (const role of permission.seededFor ?? []) {
    if (!isSeededRole(role)) {
      throw new ModuleDeclarationError(
        `${code} seeds "${permission.id}" into "${String(role)}", which is not one of the ` +
          'seven roles of SEC-01.',
      );
    }
    if (role === OWNER) {
      throw new ModuleDeclarationError(
        `${code} seeds "${permission.id}" into the owner. The owner holds every right the ` +
          'edition declares, worked out from the declarations rather than listed by each ' +
          'module — so naming it here is either redundant or, read by the next person, a ' +
          'suggestion that an unnamed right is one the owner does not hold.',
      );
    }
    if (seen.has(role)) {
      throw new ModuleDeclarationError(`${code} seeds "${permission.id}" into "${role}" twice.`);
    }
    seen.add(role);
  }
}

function requireCodes(
  code: ModuleCode,
  what: string,
  codes: readonly ModuleCode[],
  forbidden: ReadonlySet<ModuleCode>,
): readonly ModuleCode[] {
  const seen = new Set<ModuleCode>();
  for (const other of codes) {
    if (!isModuleCode(other)) {
      throw new ModuleDeclarationError(
        `${code} names "${String(other)}" in ${what}; no such module.`,
      );
    }
    if (other === code) {
      throw new ModuleDeclarationError(`${code} names itself in ${what}.`);
    }
    if (seen.has(other)) {
      throw new ModuleDeclarationError(`${code} names ${other} twice in ${what}.`);
    }
    if (forbidden.has(other)) {
      throw new ModuleDeclarationError(
        `${code} names ${other} as both a dependency and an enhancement. It is one or the ` +
          'other: either the module cannot run without it, or it loses a part of itself.',
      );
    }
    seen.add(other);
  }
  return Object.freeze([...codes]);
}

/**
 * Validates a module's own declaration and freezes it.
 *
 * Everything checked here is checkable without looking at any other module, and
 * every failure is a defect rather than a refusal: a name outside the module's
 * namespace is wrong on every machine this edition is ever installed on.
 */
export function defineModule<Session = unknown>(
  input: ModuleInput<Session>,
): ModuleDefinition<Session> {
  const { code } = input;
  if (!isModuleCode(code)) {
    throw new ModuleDeclarationError(`"${String(code)}" is not one of the sixteen modules.`);
  }
  if (input.labelKey.trim() === '') {
    throw new ModuleDeclarationError(`${code} must declare a terminology key for its name.`);
  }

  const dependsOn = requireCodes(code, 'dependsOn', input.dependsOn ?? [], new Set());
  const enhancedBy = requireCodes(code, 'enhancedBy', input.enhancedBy ?? [], new Set(dependsOn));

  const permissions = input.permissions ?? [];
  const accounts = input.accounts ?? [];
  const settings = input.settings ?? [];
  const switches = input.switches ?? [];
  const publishes = input.publishes ?? [];
  const provides = input.provides ?? [];
  const migrations = input.migrations ?? [];
  const subscribes = input.subscribes ?? [];

  const names = new Set<string>();
  for (const permission of permissions) {
    requireNamespaced(code, 'permission', permission.id, names);
    requireSeededRoles(code, permission);
  }
  for (const account of accounts) requireNamespaced(code, 'account role', account.role, names);
  for (const setting of settings) requireNamespaced(code, 'setting', setting.key, names);
  for (const item of switches) requireNamespaced(code, 'feature switch', item.key, names);
  for (const event of publishes) requireNamespaced(code, 'event', event.type.name, names);
  for (const contract of provides) requireNamespaced(code, 'contract', contract.key.key, names);
  for (const migration of migrations) requireNamespaced(code, 'migration', migration.id, names);

  const subscribed = new Set<string>();
  for (const subscription of subscribes) {
    if (!subscription.event.includes('.')) {
      throw new ModuleDeclarationError(
        `${code} subscribes to "${subscription.event}", which names no module.`,
      );
    }
    if (subscribed.has(subscription.event)) {
      // Two handlers for one event in one module hide their order from the
      // reader. One handler that does both steps does not.
      throw new ModuleDeclarationError(`${code} subscribes to "${subscription.event}" twice.`);
    }
    subscribed.add(subscription.event);
  }

  return Object.freeze({
    code,
    layer: MODULE_LAYERS[code],
    labelKey: input.labelKey,
    dependsOn,
    enhancedBy,
    permissions: Object.freeze([...permissions]),
    accounts: Object.freeze([...accounts]),
    settings: Object.freeze([...settings]),
    switches: Object.freeze([...switches]),
    publishes: Object.freeze([...publishes]),
    subscribes: Object.freeze([...subscribes]),
    provides: Object.freeze([...provides]),
    migrations: Object.freeze([...migrations]),
  });
}
