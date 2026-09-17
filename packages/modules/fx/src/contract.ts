import {
  operation,
  permissionId,
  type Action,
  type BranchId,
  type DeviceId,
  type PermissionId,
  type RegisterId,
  type SeededRole,
  type TenantId,
  type UserId,
} from '@vertex/contracts';
import type {
  Currency,
  CurrencyCode,
  Id,
  Instant,
  LocalDate,
  Refusal,
  Result,
  RoundingMode,
} from '@vertex/kernel';
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
  /**
   * A rate has been written against the functional currency (`FX-04`), so every
   * figure since is expressed in it. Changing it now would reinterpret them all.
   */
  | 'fx.functional-currency-in-use'
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
   *
   * **Chosen once figures exist, fixed.** A daily rate is units of a currency
   * per one unit of this one, so the first rate recorded or suggested against it
   * fixes it: every rate, and everything later converted at one, means something
   * only in its terms. Choosing the currency already chosen is still answered.
   */
  makeFunctional(by: CommandContext, code: CurrencyCode): Outcome<TenantCurrency>;
}

export const Currencies = contractKey<Currencies>('fx.currencies');

export const CurrencyAdministration = contractKey<CurrencyAdministration>(
  'fx.currency-administration',
);

/**
 * The places a rate is carried to once it is in its canonical form.
 *
 * Twelve, as the kernel's decimal anticipates: enough that an amount divided by
 * a rate settles to the same cent on every machine in the shop, and a bound a
 * rate can be declared with. A rate typed with more places than this is refused
 * rather than rounded — an owner who typed thirteen places meant every one.
 */
export const RATE_DECIMALS = 12;

/**
 * The two forms a rate may be typed in (`FX-04`: "in the form the local market
 * quotes").
 *
 * `units-per-functional` is how a market quotes a currency weaker than the
 * functional one: 13,100 pounds to the dollar. `functional-per-unit` is how it
 * quotes a stronger one: 1.08 dollars to the euro. Both mean the same thing once
 * recorded, which is always units of the currency per one unit of the
 * functional currency — the direction `<CurrencyRate>` displays and every later
 * conversion reads.
 */
export const QUOTE_FORMS = Object.freeze(['units-per-functional', 'functional-per-unit'] as const);

export type QuoteForm = (typeof QUOTE_FORMS)[number];

/**
 * A rate as somebody typed it: two figures, in one form.
 *
 * **`buy` is the rate applied when the shop receives the currency, and `sell`
 * when it pays the currency out** — in both forms, because that is what the two
 * words mean in `FX-04`, and a form changes how a figure is written, never what
 * it is for. Only the figures invert between forms: 1.07 dollars to the euro
 * received is 0.934579… euros to the dollar.
 *
 * A board in a Syrian exchange office lists the **dollar's** buy and sell in
 * pounds, which are the pound's the other way round: the board's dollar sell of
 * 13,100 is the pound's buy — what a shop receiving pounds asks per dollar — and
 * its dollar buy of 12,900 is the pound's sell. That translation belongs to
 * the screen that speaks the board's language, and this contract is written in
 * the currency's own terms so that a screen which got it wrong is refused below
 * (`fx.rate-spread-inverted`) instead of trading at a loss.
 */
export interface RateQuote {
  readonly form: QuoteForm;
  readonly buy: string;
  readonly sell: string;
}

export type RateRevisionId = Id<'rate-revision'>;

export type SuggestedRateId = Id<'suggested-rate'>;

export type LastKnownRatesId = Id<'last-known-rates'>;

/**
 * One branch's rates for one currency on one day, as they were at one moment
 * (`FX-04`).
 *
 * A **revision**, never an edit. A mistyped rate is corrected by recording the
 * next revision of the same day, which names the one it replaces; nothing
 * rewrites a revision, so a document stamped with the mistyped one (`FX-05`)
 * still reads what it was stamped with.
 *
 * `buy` and `sell` are canonical: units of the currency per one unit of
 * `functional`, to `RATE_DECIMALS`, and `buy` is never below `sell`. `quoted` is
 * what was typed, kept because the canonical form of 1.07 dollars to the euro is
 * a figure nobody typed and nobody would recognise in an audit.
 *
 * `day` is the branch's own calendar day when it was recorded — the day in its
 * time zone, not the store node's.
 */
export interface RateRevision extends TenantOwned {
  readonly id: RateRevisionId;
  readonly branch: BranchId;
  readonly currency: CurrencyCode;
  /** What "one unit of the functional currency" meant when this was recorded. */
  readonly functional: CurrencyCode;
  readonly day: LocalDate;
  /** 1 for the first rate of the day, and one more for each correction. */
  readonly sequence: number;
  readonly buy: string;
  readonly sell: string;
  readonly quoted: RateQuote;
  /** The revision of the same day this one corrects, or null for the day's first. */
  readonly supersedes: RateRevisionId | null;
  /** The tenant's suggestion this branch adopted as its own, or null for one typed here. */
  readonly adoptedFrom: SuggestedRateId | null;
  readonly recordedBy: UserId | null;
  readonly recordedAt: Instant;
}

/**
 * A rate the tenant publishes for its branches to adopt (`FX-04`).
 *
 * Not a rate any branch trades at until one adopts it, and adopting copies it:
 * a suggestion revised at noon leaves every branch that adopted the morning's
 * trading at the morning's, which is the point of a branch's rate being its own.
 *
 * It carries the moment it was published rather than a day, because a tenant
 * has no time zone of its own — its branches do. A branch adopts a suggestion
 * published on **its** today.
 */
export interface SuggestedRate extends TenantOwned {
  readonly id: SuggestedRateId;
  readonly currency: CurrencyCode;
  readonly functional: CurrencyCode;
  readonly buy: string;
  readonly sell: string;
  readonly quoted: RateQuote;
  /** The suggestion for the same currency this one replaces, or null. */
  readonly supersedes: SuggestedRateId | null;
  readonly suggestedBy: UserId | null;
  readonly suggestedAt: Instant;
}

/**
 * The most recent rate a register holds for one currency, confirmed for today.
 */
export interface LastKnownRate {
  readonly currency: CurrencyCode;
  readonly revision: RateRevisionId;
  /** The day that rate was recorded for — what every currency-sensitive screen shows. */
  readonly rateDay: LocalDate;
}

/**
 * `FX-04`'s one exception to "no rate for today, no trading in the currency".
 *
 * A register that cannot reach the store node cannot learn today's rate, and a
 * shop with a dead line still has to sell. So it may trade on the most recent
 * rate it synced — **only after a supervisor standing at it confirms that**, for
 * that register and that day. What this records is the confirmation: who gave
 * it, where, and which rates it covers.
 *
 * Whether the register can in fact reach the store node is the host's to know
 * and not this module's, which is why the confirmation is only ever offered by
 * the register's own host. What `FX` holds to is the rest: a register in that
 * branch, a supervisor's right, rates that genuinely are not today's, and an
 * answer from `current` that says so every time it is read.
 */
export interface LastKnownRates extends TenantOwned {
  readonly id: LastKnownRatesId;
  readonly branch: BranchId;
  readonly register: RegisterId;
  readonly device: DeviceId;
  /** The day being traded — the register's today — not the day the rates are from. */
  readonly day: LocalDate;
  readonly rates: readonly LastKnownRate[];
  readonly confirmedBy: UserId | null;
  readonly confirmedAt: Instant;
}

/**
 * The rate a currency trades at, here and now.
 *
 * `lastKnown` null is today's rate. Otherwise it is the confirmation this
 * register is trading under, and the revision is from `rateDay` — which a screen
 * shows beside every figure, and which a document stamped with it (`FX-05`)
 * carries, so that sync can flag it for review.
 */
export interface RateInForce {
  readonly revision: RateRevision;
  readonly lastKnown: LastKnownRates | null;
}

/** One currency's line on a branch's board for today. */
export interface RateBoardLine {
  readonly currency: TenantCurrency;
  /** Today's rate in force, or null: the missing rate `FX-04` blocks trading on. */
  readonly revision: RateRevision | null;
  /**
   * The tenant's suggestion published on this branch's today, or null: what
   * `adopt` would make the branch's own.
   */
  readonly suggestion: SuggestedRate | null;
}

/**
 * A branch's rates for today, one line for every currency in use other than
 * the functional one — which has no rate, being what every rate is expressed in.
 */
export interface RateBoard {
  readonly branch: BranchId;
  readonly day: LocalDate;
  readonly functional: TenantCurrency;
  readonly lines: readonly RateBoardLine[];
}

export type RateRefusalCode =
  | 'fx.branch-not-found'
  /** A withdrawn branch trades in nothing, so nothing is entered for it. */
  | 'fx.branch-inactive'
  | 'fx.currency-not-found'
  | 'fx.currency-disabled'
  /** The functional currency has no rate: every rate is expressed in it. */
  | 'fx.currency-is-functional'
  /** The tenant's currencies were never set up, so there is nothing a rate could be per. */
  | 'fx.functional-currency-unset'
  | 'fx.rate-form-unknown'
  /** Not a positive exact decimal, or too large to be carried in canonical form. */
  | 'fx.rate-invalid'
  /** More places than `RATE_DECIMALS`. */
  | 'fx.rate-too-precise'
  /**
   * Receiving the currency at fewer units per functional unit than paying it
   * out: every exchange the shop made at these rates would lose. Almost always a
   * board read the wrong way round (see `RateQuote`). Equal rates are allowed.
   */
  | 'fx.rate-spread-inverted'
  /**
   * No rate for today — and yesterday's is not used in its place (`FX-04`). The
   * values name the branch, the currency and the day, which is what the prompt
   * has to tell somebody to go and enter.
   */
  | 'fx.rate-missing'
  /** Nothing the tenant suggested was published on this branch's today. */
  | 'fx.suggested-rate-missing'
  /** A last-known rate is confirmed at a register in the branch, by somebody standing at it. */
  | 'fx.not-at-register'
  /** Today's rates are all here; there is nothing a last-known rate would stand in for. */
  | 'fx.rates-current'
  /** The caller does not hold the right this command declares (`SEC-02`). */
  | 'fx.not-permitted';

export type RateRefusal = Refusal<RateRefusalCode>;

type Rated<T> = Promise<Result<T, RateRefusal>>;

/**
 * The read side of the daily rates, which is what other modules use.
 *
 * Unguarded, for the reason `Currencies` is: a cashier's sale reads the rate it
 * trades at whether or not the cashier may open the rates screen.
 */
export interface ExchangeRates {
  /** Today's board at a branch, in the branch's own day. */
  board(by: CommandContext, branch: BranchId): Rated<RateBoard>;

  /**
   * The rate a currency trades at in this branch now, or `fx.rate-missing`.
   *
   * Never yesterday's in place of today's — except under a last-known
   * confirmation for the register the caller is standing at, and then marked.
   */
  current(by: CommandContext, branch: BranchId, currency: CurrencyCode): Rated<RateInForce>;

  /** Every revision of one day, first to last: the rate and each correction of it. */
  revisions(
    by: CommandContext,
    branch: BranchId,
    currency: CurrencyCode,
    day: LocalDate,
  ): Promise<readonly RateRevision[]>;
}

/**
 * The write side: what a branch's manager enters, what the owner suggests, and
 * what a supervisor confirms at a register cut off from the store node.
 *
 * Every command asks its right before anything else — before even asking `SYS`
 * whether the branch exists, so that somebody refused learns nothing about
 * branches they could not have acted on.
 */
export interface RateAdministration {
  /**
   * Records today's rates for one currency at one branch: the day's first, or a
   * correction of the day's latest. Asked at the branch (`SEC-04`), and never for
   * any day but the branch's today.
   */
  record(
    by: CommandContext,
    branch: BranchId,
    currency: CurrencyCode,
    quote: RateQuote,
  ): Rated<RateRevision>;

  /** Publishes a suggested rate for the whole tenant. Asked at the tenant-wide place. */
  suggest(by: CommandContext, currency: CurrencyCode, quote: RateQuote): Rated<SuggestedRate>;

  /**
   * Makes today's suggestions this branch's own rates, every currency in one
   * action. A suggestion the branch has already adopted is not recorded again.
   * Asked with the same right as `record`, since it records the branch's rates.
   */
  adopt(by: CommandContext, branch: BranchId): Rated<readonly RateRevision[]>;

  /**
   * Confirms, at the register the caller is standing at, that it trades today on
   * the most recent rates it holds for every currency lacking today's.
   *
   * Once per register per day: confirming again answers with the confirmation
   * already given. Marked sensitive, which is what `SEC-05` re-authorises.
   */
  confirmLastKnown(by: CommandContext, branch: BranchId): Rated<LastKnownRates>;
}

export const ExchangeRates = contractKey<ExchangeRates>('fx.exchange-rates');

export const RateAdministration = contractKey<RateAdministration>('fx.rate-administration');

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
  /** `SEC-05`: re-authorisation before it proceeds. */
  readonly sensitive?: boolean;
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
 * One right that is not part of a set.
 *
 * The daily rates have no set to belong to: a rate is recorded and never edited
 * or withdrawn — a correction is the next revision — so declaring `edit` and
 * `delete` over one would put two ticks in the role editor that nothing asks.
 */
function rightTo(
  resource: string,
  action: Action,
  seededFor: readonly SeededRole[],
  sensitive = false,
): PermissionId {
  const id = permissionId('fx', resource, action);
  DECLARED.push(sensitive ? { id, seededFor, sensitive } : { id, seededFor });
  return id;
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

/** A branch's manager: `FX-04` names the owner or manager of each branch. */
const MANAGER: readonly SeededRole[] = Object.freeze(['manager']);

/** The daily rates of a branch (`FX-04`). */
export interface RateRights {
  readonly view: PermissionId;
  /** Recording today's rate, correcting it, and adopting the tenant's suggestion. */
  readonly record: PermissionId;
}

/** The rates the tenant suggests to every branch. */
export interface SuggestedRateRights {
  readonly view: PermissionId;
  readonly suggest: PermissionId;
}

/** Trading on a register's last-known rates when it cannot reach the store node. */
export interface LastKnownRateRights {
  readonly confirm: PermissionId;
}

export interface FxPermissions {
  readonly currency: StructuralRights;
  readonly functionalCurrency: EditableRights;
  readonly rate: RateRights;
  readonly suggestedRate: SuggestedRateRights;
  readonly lastKnownRate: LastKnownRateRights;
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
  // Everybody who takes or gives money reads the rate it is taken at. Entering
  // one is the branch manager's, confined to their branch by `SEC-04`.
  rate: Object.freeze({
    view: rightTo('rate', 'view', EVERYONE),
    record: rightTo('rate', 'create', MANAGER),
  }),
  // Publishing a rate to every branch at once is a decision about the group,
  // and the owner's. The accountant reads it beside the managers who adopt it.
  suggestedRate: Object.freeze({
    view: rightTo('suggested-rate', 'view', ['manager', 'accountant']),
    suggest: rightTo('suggested-rate', 'create', OWNER_ONLY),
  }),
  // Sensitive: it lets a till trade at a rate that is not today's. The floor
  // supervisor is the one standing in the shop when the line goes down.
  lastKnownRate: Object.freeze({
    confirm: rightTo(
      'last-known-rate',
      operation('confirm'),
      ['manager', 'floor-supervisor'],
      true,
    ),
  }),
});

/** What the module hands the platform: every right, and who starts out holding it. */
export const FX_PERMISSION_SEEDS: readonly Declared[] = Object.freeze([...DECLARED]);
