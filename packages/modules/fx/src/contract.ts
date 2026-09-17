import { permissionId, type PermissionId, type SeededRole, type TenantId } from '@vertex/contracts';
import type { Currency, CurrencyCode, Refusal, Result, RoundingMode } from '@vertex/kernel';
import { contractKey, type CommandContext } from '@vertex/platform';

/**
 * What `FX` lets the rest of the system see.
 *
 * Every module above this one handles an amount, and an amount is meaningless
 * without its currency's rules: how precisely it is stored, what step it
 * settles to, which way it rounds. So nearly everything reads this contract,
 * and nothing may reach past it (`modules.md` §4) — `check:boundaries` holds
 * the workspace to that.
 *
 * Types and keys only. Anything this file imported would be imported by every
 * module that handles money, which is why it may not import the implementation
 * behind it.
 */

/**
 * What `FX` needs from a store, and nothing more.
 *
 * Declared here rather than borrowed from `SYS`, whose contract carries the same
 * three methods, for the reason `SEC` gives: a store port is nobody's property,
 * and structural typing already lets one session satisfy all three modules.
 *
 * There is no `remove`. A currency is taken out of use and never deleted,
 * because every amount ever recorded in it names its code — and a module with no
 * way to delete is a stronger statement of that than a rule to remember.
 */
export interface RecordSession {
  put(key: string, value: unknown): void;
  get(key: string): unknown;
  keys(): readonly string[];
}

interface TenantOwned {
  readonly tenant: TenantId;
}

/**
 * A currency as one tenant keeps it (`FX-01`).
 *
 * It **is** a kernel `Currency`, with the tenant and whether it is in use added,
 * so it can be handed as it stands to `round`, to `allocate` and to `<Money>`.
 * There is no second shape to convert into, and so no conversion that could
 * drop a field on the way.
 *
 * The code is ISO 4217: three capital letters. That is what `<Money>` prints
 * beside every amount (`design-system.md` §12), and it is also why there is no
 * name here — a screen names a currency through `Intl.DisplayNames` in whichever
 * language it is showing, which covers every ISO code in both of the product's
 * languages with nothing to translate and nothing to keep up to date.
 *
 * `enabled` false is a currency the shop no longer takes. It stays readable,
 * because last year's documents are still written in it.
 */
export interface TenantCurrency extends Currency, TenantOwned {
  readonly enabled: boolean;
}

/**
 * A currency being defined: exactly the kernel's definition.
 *
 * What makes a currency coherent does not change because a tenant is the one
 * defining it, so the shape is not restated — the kernel's `flawOf` judges it,
 * and this module turns what it finds into a refusal.
 */
export type NewCurrency = Currency;

/**
 * What may change about a currency once it exists. Every field is optional: an
 * owner revises what they came to revise.
 *
 * The code is absent because it is the currency's identity — every amount ever
 * recorded names it. Whether it is in use is absent because that is its own
 * pair of commands, which are not symmetrical: taking the functional currency
 * out of use is refused, and a flag would hide which direction was.
 *
 * The precision may rise and may not fall. `FX` cannot see the amounts other
 * modules have stored, so it cannot know that none of them needs the places
 * being removed — and a stored amount that its own currency can no longer
 * represent is a figure that silently changes the next time it is read.
 */
export interface CurrencyRevision {
  readonly symbol?: string;
  readonly decimals?: number;
  readonly roundingIncrement?: string;
  readonly roundingMode?: RoundingMode;
}

/** Whether a listing hides the currencies taken out of use, or shows every one. */
export interface Listing {
  readonly including?: 'enabled' | 'all';
}

/**
 * The read side, which is what other modules use.
 *
 * **Unguarded**, for the reason `SYS` gives for its own reads: these are what
 * other modules build on, under the context of whoever started the command. A
 * cashier's sale settles an amount in a currency, and whether the cashier may
 * open the currencies screen has nothing to do with whether the sale may know
 * the currency's rules. What a *person* may see is decided where their request
 * enters the system of record (`U07`), using the view rights declared below.
 */
export interface Currencies {
  /**
   * The tenant's currencies, in order of their codes, so a list somebody is
   * reading does not rearrange itself between two reads. Only those in use,
   * unless the listing asks for all.
   */
  currencies(by: CommandContext, listing?: Listing): Promise<readonly TenantCurrency[]>;

  /**
   * One currency, whether in use or not.
   *
   * Not filtered, deliberately: a document from before the shop stopped taking
   * a currency still has to be read in that currency's precision.
   */
  currency(by: CommandContext, code: CurrencyCode): Promise<TenantCurrency | null>;

  /**
   * The currency this tenant keeps its books in (`FX-02`): every cost, margin,
   * profit and valuation is stored and computed in it.
   *
   * Null only for a tenant whose currencies were never set up, and never
   * guessed at — a module that went on to value stock in a currency nobody had
   * chosen would be writing figures in an assumption.
   */
  functional(by: CommandContext): Promise<TenantCurrency | null>;
}

export type CurrencyRefusalCode =
  /** Not three capital letters: the form every amount in the system names its currency by. */
  | 'fx.currency-code-invalid'
  | 'fx.currency-exists'
  | 'fx.currency-not-found'
  | 'fx.currency-symbol-required'
  | 'fx.currency-decimals-invalid'
  /** See `CurrencyRevision`: an amount already stored may need the places being removed. */
  | 'fx.currency-decimals-reduced'
  /** Not an exact, positive decimal. */
  | 'fx.currency-increment-invalid'
  /** A step finer than the precision a settled amount is stored at could not be stored. */
  | 'fx.currency-increment-too-fine'
  | 'fx.currency-rounding-mode-unknown'
  /** The books cannot be kept in a currency the shop does not take. */
  | 'fx.currency-disabled'
  /** Taking the functional currency out of use would leave the books in nothing. */
  | 'fx.currency-is-functional'
  /** The caller does not hold the right this command declares (`SEC-02`). */
  | 'fx.not-permitted';

export type CurrencyRefusal = Refusal<CurrencyRefusalCode>;

type Outcome<T> = Promise<Result<T, CurrencyRefusal>>;

/**
 * The write side: what the tenant's owner does to its own currencies, with no
 * vendor and no code change (`FX-01`).
 *
 * Every command asks the right it declares through `ModuleContext.authorise`,
 * before its transaction opens, and each is a decision about the whole tenant —
 * a currency's rules apply in every branch at once — so each is asked at the
 * tenant-wide place, which only an unconfined grant reaches (`SEC-04`).
 *
 * There is no delete. See `RecordSession`.
 */
export interface CurrencyAdministration {
  /**
   * Installs the four currencies of `FX-01` and makes USD the functional
   * currency, for a tenant that has neither yet.
   *
   * Idempotent, and that is load-bearing: first-run installation can be
   * interrupted and `SYN-02` replays commands, and a second seeding that put
   * back the shipped rounding rules would silently undo every revision the
   * owner had made. A currency already there is left as it is, and a functional
   * currency already chosen is never replaced.
   *
   * Asked under `currency.create` alone. The functional currency it writes is
   * only ever the first one, and it is the product's shipped default rather
   * than anybody's choice — so it takes nothing from whoever holds the right to
   * change one.
   */
  seed(by: CommandContext): Outcome<readonly TenantCurrency[]>;

  /** Adds a currency, in use from the moment it exists. */
  define(by: CommandContext, input: NewCurrency): Outcome<TenantCurrency>;

  /** Applies from now on. An amount already settled keeps the figure it was settled at. */
  revise(
    by: CommandContext,
    code: CurrencyCode,
    changes: CurrencyRevision,
  ): Outcome<TenantCurrency>;

  /** Takes a currency out of use. Repeating it is answered as done. */
  disable(by: CommandContext, code: CurrencyCode): Outcome<TenantCurrency>;

  /** Puts one back into use. Repeating it is answered as done. */
  enable(by: CommandContext, code: CurrencyCode): Outcome<TenantCurrency>;

  /**
   * Chooses the currency the books are kept in (`FX-02`), which must be in use.
   *
   * A setting of the tenant and not a constant of the product: a shop group
   * whose books are kept in lira chooses lira here, and nothing else in the
   * system is written as though the answer were the dollar.
   */
  makeFunctional(by: CommandContext, code: CurrencyCode): Outcome<TenantCurrency>;
}

export const Currencies = contractKey<Currencies>('fx.currencies');

export const CurrencyAdministration = contractKey<CurrencyAdministration>(
  'fx.currency-administration',
);

/** The four rights over a thing that is made, read, revised and taken out of use. */
export interface StructuralRights {
  readonly view: PermissionId;
  readonly create: PermissionId;
  readonly edit: PermissionId;
  /** `delete` in `SEC-02`'s grammar. Nothing is deleted: a currency is taken out of use. */
  readonly withdraw: PermissionId;
}

/** A thing that is looked at and revised, and never created or withdrawn. */
export interface EditableRights {
  readonly view: PermissionId;
  readonly edit: PermissionId;
}

/**
 * Every right defined below, collected as each is built, with the roles that
 * hold it the day a shop is set up (`SEC-01`).
 *
 * The same arrangement `SYS` and `SEC` use: the module declares its permissions
 * from this list, and the builders beneath are the only way to make a right —
 * so a right cannot exist without being declared, and cannot be declared under
 * a name that differs by a character from the one a command asks for.
 */
interface Declared {
  readonly id: PermissionId;
  readonly seededFor: readonly SeededRole[];
}

const DECLARED: Declared[] = [];

type StructuralSeeds = Readonly<Record<keyof StructuralRights, readonly SeededRole[]>>;

type EditableSeeds = Readonly<Record<keyof EditableRights, readonly SeededRole[]>>;

function rightsOver(resource: string, seeds: StructuralSeeds): StructuralRights {
  const rights: StructuralRights = Object.freeze({
    view: permissionId('fx', resource, 'view'),
    create: permissionId('fx', resource, 'create'),
    edit: permissionId('fx', resource, 'edit'),
    withdraw: permissionId('fx', resource, 'delete'),
  });
  DECLARED.push(
    { id: rights.view, seededFor: seeds.view },
    { id: rights.create, seededFor: seeds.create },
    { id: rights.edit, seededFor: seeds.edit },
    { id: rights.withdraw, seededFor: seeds.withdraw },
  );
  return rights;
}

function rightsToReadAndRevise(resource: string, seeds: EditableSeeds): EditableRights {
  const rights: EditableRights = Object.freeze({
    view: permissionId('fx', resource, 'view'),
    edit: permissionId('fx', resource, 'edit'),
  });
  DECLARED.push(
    { id: rights.view, seededFor: seeds.view },
    { id: rights.edit, seededFor: seeds.edit },
  );
  return rights;
}

/**
 * Everybody who works in a shop handles an amount, and an amount is read in its
 * currency's precision.
 */
const EVERYONE: readonly SeededRole[] = Object.freeze([
  'manager',
  'accountant',
  'purchasing',
  'warehouse-keeper',
  'floor-supervisor',
  'cashier',
]);

/**
 * Nobody but the owner, seeded.
 *
 * A currency's rounding rule decides how much change every till in the group
 * gives, and the functional currency decides what every figure in the books is
 * written in. A shop that wants its accountant making either decision grants it
 * in the role editor, which is a deliberate act and an auditable one.
 */
const OWNER_ONLY: readonly SeededRole[] = Object.freeze([]);

export interface FxPermissions {
  readonly currency: StructuralRights;
  readonly functionalCurrency: EditableRights;
}

export const FX_PERMISSIONS: FxPermissions = Object.freeze({
  currency: rightsOver('currency', {
    view: EVERYONE,
    create: OWNER_ONLY,
    edit: OWNER_ONLY,
    withdraw: OWNER_ONLY,
  }),
  functionalCurrency: rightsToReadAndRevise('functional-currency', {
    view: EVERYONE,
    edit: OWNER_ONLY,
  }),
});

/** What the module hands the platform: every right, and who starts out holding it. */
export const FX_PERMISSION_SEEDS: readonly Declared[] = Object.freeze([...DECLARED]);
