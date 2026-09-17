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
  /**
   * The branch's today is a day it has already traded past.
   *
   * A rate is filed under the branch's own day, and a branch's day only ever
   * moves forward. It can be made to move backwards three ways — the zone is
   * revised, the machine clock is corrected the wrong way, an hour is handed
   * back at the end of summer time — and each of them would file a rate under a
   * day that has closed, beneath the documents already stamped on it (`FX-05`).
   *
   * The values name the branch, the day being asked for and the latest day it
   * has recorded, so the prompt can say what is wrong rather than that
   * something is. Refused rather than accepted and marked: `SYS` decides who
   * may move a branch's zone, and this decides what a moved zone cannot do.
   */
  | 'fx.rate-day-behind'
  /** Nothing the tenant suggested was published on this branch's today. */
  | 'fx.suggested-rate-missing'
  /** A last-known rate is confirmed at a register in the branch, by somebody standing at it. */
  | 'fx.not-at-register'
  /**
   * An override was typed with nothing written in the reason (`FX-06`).
   *
   * The log answers "who" and "what" on its own; only the person overriding can
   * answer "why", and an override nobody can explain a month later is a figure
   * an auditor has to treat as an error. Judged as the exemption comments in
   * `tools/` are judged — a reason is words, so a dash or a full stop is a shrug
   * with punctuation.
   */
  | 'fx.override-reason-required'
  /**
   * An override on the far side of the day's other rate: receiving the currency
   * at fewer units per functional unit than the branch pays it out at, or paying
   * it out at more than it receives it at.
   *
   * The same judgement `fx.rate-spread-inverted` makes about a board, made about
   * one document: every exchange at that pair loses. The right to override is
   * the right to trade away from the board, not the right to trade at a certain
   * loss, and almost always this is a figure entered on the wrong side. Equal to
   * the other side is allowed, exactly as it is on a board.
   */
  | 'fx.override-crosses-spread'
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

/**
 * Which way the money is moving, which is the whole of what a caller has to say
 * for `FX-06` to pick a side.
 *
 * `received` is the shop taking the currency in — a sale settled in euros, a
 * customer paying down an account in pounds, a receivable that will be
 * collected in them. `paid-out` is the shop letting it go — change given, a
 * supplier paid, a refund. Named for the money and not for the document,
 * because `FX` does not know what a document is and must not learn.
 */
export const CASH_DIRECTIONS = Object.freeze(['received', 'paid-out'] as const);

export type CashDirection = (typeof CASH_DIRECTIONS)[number];

/** Which of a revision's two figures a direction selects. */
export type RateSide = 'buy' | 'sell';

export type RateStampId = Id<'rate-stamp'>;

export type RateOverrideId = Id<'rate-override'>;

/**
 * A rate typed over the one that would have applied (`FX-06`).
 *
 * One figure and not a pair: an override replaces the side the direction of the
 * cash selected, and leaves the other side of the board alone. It is typed in
 * either of the two forms of `RateQuote`, for the reason a board is — the person
 * overriding is reading a rate off something, and it says what it says.
 */
export interface RateOverrideQuote {
  readonly form: QuoteForm;
  readonly rate: string;
  /** Why. Required: see `fx.override-reason-required`. */
  readonly reason: string;
}

/**
 * What a caller tells `FX` about the money, and nothing else.
 *
 * No amount, because the rate does not depend on one; no document, because `FX`
 * would then have to know what documents there are, and `modules.md` §5 is a
 * list of what that costs. The caller keeps the stamp it is handed.
 */
export interface Stamping {
  readonly branch: BranchId;
  readonly currency: CurrencyCode;
  readonly direction: CashDirection;
  /** Present only when somebody is deliberately replacing the applied rate. */
  readonly override?: RateOverrideQuote;
}

/**
 * The rate one transaction used, stored permanently on that transaction
 * (`FX-05`).
 *
 * **The figure is copied here**, not read through the revision it came from.
 * That is the whole feature: a stamp that only named a revision would read
 * whatever the revision reads today, and a revision is superseded whenever a
 * mistyped rate is corrected. `revision` is kept beside the figure for
 * provenance — which rate this was, and what else was entered that day — and
 * nothing ever recomputes from it.
 *
 * `day` is the branch's day the document was stamped on. `rateDay` is the day
 * the rate itself was recorded for, and the two differ only under `FX-04`'s one
 * exception, where a register cut off from the store node trades on the most
 * recent rate it holds. Both are here so that sync can flag that document for
 * review without having to work out which case it was.
 */
export interface RateStamp extends TenantOwned {
  readonly id: RateStampId;
  readonly branch: BranchId;
  readonly currency: CurrencyCode;
  /** What "one unit of the functional currency" meant when this was stamped. */
  readonly functional: CurrencyCode;
  readonly day: LocalDate;
  readonly direction: CashDirection;
  /** The side the direction selected: buy on receipt, sell on disbursement. */
  readonly side: RateSide;
  /** The rate applied, canonical: units of the currency per one unit of `functional`. */
  readonly rate: string;
  readonly revision: RateRevisionId;
  readonly rateDay: LocalDate;
  /** The log entry, when `rate` is not what the revision said; otherwise null. */
  readonly override: RateOverrideId | null;
  /** `FX-04`'s exception this was stamped under, or null. */
  readonly lastKnown: LastKnownRatesId | null;
  readonly stampedBy: UserId | null;
  readonly stampedAt: Instant;
}

/**
 * An override, in `FX`'s own log (`FX-06`: "an override is logged").
 *
 * Its own record rather than three more fields on the stamp, because it is read
 * for a different reason and by somebody else: a stamp is read one at a time,
 * with the document it belongs to, and this is read a day or a month at a time
 * by whoever is checking what the tills did. It is keyed by branch and day so
 * that reading it is that question, and not a scan of every stamp ever taken.
 *
 * It holds **both** figures. One that recorded only what was applied would not
 * say what was departed from, and the difference is the entire subject of the
 * review.
 */
export interface RateOverride extends TenantOwned {
  readonly id: RateOverrideId;
  readonly stamp: RateStampId;
  readonly branch: BranchId;
  readonly currency: CurrencyCode;
  readonly day: LocalDate;
  readonly side: RateSide;
  /** What `FX-06` would have applied: the revision's own figure for this side. */
  readonly automatic: string;
  /** What was applied instead, canonical. */
  readonly applied: string;
  /** What was typed, and in which form — `applied` is a figure nobody may have typed. */
  readonly quoted: { readonly form: QuoteForm; readonly rate: string };
  readonly reason: string;
  /** The revision departed from, so the board it departed from can be read beside it. */
  readonly revision: RateRevisionId;
  readonly by: UserId | null;
  readonly at: Instant;
}

/**
 * A stamp worked out and not yet written, with the log entry that goes with it.
 *
 * Everything that could refuse has been decided by the time this exists, which
 * is what lets `stamp` be an ordinary write with no answer but the stamp. The
 * identifier is settled here too, so the caller can put it on the document it is
 * building before either of them is committed.
 */
export interface PreparedStamp {
  readonly stamp: RateStamp;
  readonly override: RateOverride | null;
}

/**
 * Stamping a transaction with the rate it used (`FX-05`), at the side the
 * direction of the money selects (`FX-06`).
 *
 * **Two calls, and the split is the point.** A rate has to be worked out before
 * the caller's transaction opens — it reads the branch from `SYS`, it reads the
 * clock, and an override asks `SEC` for a right — and none of those may happen
 * with a transaction already open, for the reason the rest of this module gives:
 * one command never holds two transactions at once. But the stamp has to be
 * *written* inside the caller's transaction, or a document and the rate it was
 * priced at commit separately and either can be left without the other.
 *
 * So `prepare` does everything that can refuse, outside; `stamp` does the write,
 * inside. Between the two, a correction may arrive for the day's rate, and the
 * document is still stamped with what it was priced at — which is what `FX-04`
 * means by "documents already stamped keep the revision they used".
 */
export interface RateStamps {
  /**
   * Works out the rate this movement will be stamped with, and refuses here if
   * it is going to be refused at all.
   *
   * Asks nothing of the caller unless there is an override, because stamping is
   * a read: a cashier stamps the rate of every sale they ring up, whether or
   * not they may open the rates screen.
   */
  prepare(by: CommandContext, stamping: Stamping): Rated<PreparedStamp>;

  /**
   * Writes the stamp, and its log entry, into the transaction the caller
   * already has open.
   *
   * Synchronous and with no answer of its own: it awaits nothing, so it cannot
   * open a second transaction inside the caller's, and everything it could have
   * refused was refused by `prepare`. Stamping under a tenant other than the one
   * that prepared it raises — that is a defect in a caller, not a refusal
   * anybody can act on.
   */
  stamp(by: CommandContext, session: RecordSession, prepared: PreparedStamp): RateStamp;

  /** One stamp, by the identifier the document carries. */
  stamped(by: CommandContext, id: RateStampId): Promise<RateStamp | null>;

  /**
   * Every override at a branch on one day, in the order they were made: the log
   * of `FX-06`, as whoever reviews the day reads it.
   */
  overrides(by: CommandContext, branch: BranchId, day: LocalDate): Promise<readonly RateOverride[]>;
}

export const RateStamps = contractKey<RateStamps>('fx.rate-stamps');

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
  /** Stamping a document at a rate other than the one `FX-06` selected. */
  readonly override: PermissionId;
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
    // Sensitive, and the manager's. `FX-04` gives a branch's rates to the owner
    // or to its manager, and a rate typed over the board on one document is
    // that same authority at the smallest scale — the one figure on the
    // document nobody else checked. The floor supervisor holds the last-known
    // confirmation below and not this: confirming the board's own rate for a
    // till that cannot reach the store node is not inventing a rate, and the
    // two are not the same trust.
    override: rightTo('rate', operation('override'), MANAGER, true),
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
