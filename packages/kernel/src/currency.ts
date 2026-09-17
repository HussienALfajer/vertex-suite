import { Dec, isDecimalString, type Decimal, type Rounding } from './decimal.js';
import { InvalidCurrencyError } from './errors.js';

/**
 * A currency identifier. Deliberately a plain string rather than a closed union:
 * `FX-01` requires the currency list to be data, extensible without code
 * changes. Code that knows which currencies it handles narrows this with a
 * literal type, which is what gives compile-time protection against mixing
 * them.
 */
export type CurrencyCode = string;

/**
 * How a value is moved onto a rounding increment.
 *
 * `half-even` is offered because it is the neutral choice for repeated
 * revaluation (`FX-10`); `half-up` is what a shop expects to see on a receipt.
 *
 * Published as a list, and not only as a type, because `FX-01` makes the mode
 * data: a module checking a definition somebody typed and a screen offering the
 * choice both need to know which modes exist, and a copy of this list anywhere
 * else is how a mode comes to be offered in one place and refused in another.
 */
export const ROUNDING_MODES = Object.freeze([
  'half-up',
  'half-even',
  'up',
  'down',
  'ceil',
  'floor',
] as const);

export type RoundingMode = (typeof ROUNDING_MODES)[number];

const KNOWN_MODES: ReadonlySet<string> = new Set(ROUNDING_MODES);

/** Whether a stored string names a rounding mode, without throwing. */
export function isRoundingMode(value: string): value is RoundingMode {
  return KNOWN_MODES.has(value);
}

/**
 * The finest precision an amount is stored at.
 *
 * Far beyond any currency in circulation. The bound exists so that a stored
 * precision is a number a column can be declared with, and so that a mistyped
 * `200` cannot make every amount of a currency carry two hundred places.
 */
const MAX_DECIMALS = 12;

/** Something a person could see: not whitespace, not a bidirectional or joining control. */
const VISIBLE = /[^\p{Cf}\p{Z}\s]/u;

/**
 * A currency and its arithmetic rules (`FX-01`, `FX-07`).
 *
 * This is a data record. The kernel defines its shape and validates it; it does
 * not contain a list of currencies, because the list belongs to the tenant.
 */
export interface Currency<C extends CurrencyCode = CurrencyCode> {
  readonly code: C;
  readonly symbol: string;
  /** Decimal places at which an amount of this currency is stored. */
  readonly decimals: number;
  /**
   * The smallest step a settled amount of this currency may take, as an exact
   * decimal string — `"0.01"` for a currency settled to the cent, `"100"` for
   * one whose smallest circulating note is a hundred.
   */
  readonly roundingIncrement: string;
  readonly roundingMode: RoundingMode;
}

/**
 * The first reason a currency definition cannot be used, named rather than
 * described.
 *
 * `defineCurrency` throws on any of these, which is right for a definition
 * written in code: it is wrong identically on every machine. But `FX-01` makes
 * the definition something an owner types, and an owner who typed a precision
 * of thirteen is owed a refusal naming the field rather than a crash. So the
 * judgement is a value, and exactly one implementation of it exists — the
 * module that turns it into a refusal cannot come to accept a currency this
 * file would refuse, because it is asking this file.
 */
export type CurrencyFlaw =
  | 'code-empty'
  | 'symbol-empty'
  | 'decimals-out-of-range'
  | 'increment-not-decimal'
  | 'rounding-mode-unknown'
  | 'increment-not-positive'
  | 'increment-finer-than-decimals';

/** A definition's fields as they may actually arrive: typed by a person, or read off a wire. */
type Arriving = { readonly [Field in keyof Currency]: unknown };

/**
 * Judges a currency definition, and returns its first flaw or null.
 *
 * Every field is checked for its kind as well as its value. The type says a
 * rounding increment is a string, and the type is gone at run time: a number
 * arriving as `0.01` passed the decimal test by being coerced to `"0.01"` on
 * the way, which is a float entering the definition of how every amount of the
 * currency is settled.
 */
export function flawOf(currency: Currency): CurrencyFlaw | null {
  const { code, symbol, decimals, roundingIncrement, roundingMode } = currency as Arriving;

  if (typeof code !== 'string' || code.trim() === '') return 'code-empty';

  // Visible, and not merely non-blank: a symbol that is only a right-to-left
  // mark passed a trim, and printed nothing beside every amount of its currency.
  if (typeof symbol !== 'string' || !VISIBLE.test(symbol)) return 'symbol-empty';

  if (
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_DECIMALS
  ) {
    return 'decimals-out-of-range';
  }

  if (typeof roundingIncrement !== 'string' || !isDecimalString(roundingIncrement)) {
    return 'increment-not-decimal';
  }

  // FX-01 makes the currency list data, so a mode arrives as a stored string the
  // type never saw. An unknown one used to reach the library as `undefined`,
  // which it reads as its own default — half-up — and a currency declared
  // `half_even` rounded the wrong way with nothing to say so.
  if (typeof roundingMode !== 'string' || !isRoundingMode(roundingMode)) {
    return 'rounding-mode-unknown';
  }

  const increment = new Dec(roundingIncrement);
  if (!increment.isPositive() || increment.isZero()) return 'increment-not-positive';

  // An increment finer than the stored precision would let `round` produce a
  // value that cannot be stored, and the residual of FX-07 would then absorb a
  // difference that no account explains.
  if (increment.decimalPlaces() > decimals) return 'increment-finer-than-decimals';

  return null;
}

function explain(flaw: CurrencyFlaw, currency: Currency): string {
  // Widened for the same reason `flawOf` widens: the flaw being explained is
  // often that a field is not what its type says.
  const arriving = currency as Arriving;
  const code = String(arriving.code);
  switch (flaw) {
    case 'code-empty':
      return 'A currency code must not be empty.';
    case 'symbol-empty':
      return `Currency ${code} must declare a symbol with something visible in it.`;
    case 'decimals-out-of-range':
      return (
        `Currency ${code} declares ${String(arriving.decimals)} decimal places; expected an ` +
        `integer between 0 and ${String(MAX_DECIMALS)}.`
      );
    case 'increment-not-decimal':
      return (
        `Currency ${code} declares a rounding increment of "${String(arriving.roundingIncrement)}", ` +
        'which is not an exact decimal.'
      );
    case 'rounding-mode-unknown':
      return (
        `Currency ${code} declares a rounding mode of "${String(arriving.roundingMode)}", which is ` +
        `not one of ${ROUNDING_MODES.join(', ')}.`
      );
    case 'increment-not-positive':
      return `Currency ${code} declares a rounding increment that is not positive.`;
    case 'increment-finer-than-decimals':
      return (
        `Currency ${code} rounds to ${currency.roundingIncrement} but stores only ` +
        `${String(currency.decimals)} decimal places, so a rounded amount could not be stored exactly.`
      );
  }
}

/**
 * Validates a currency record and freezes it.
 *
 * For a definition written in code. One that arrives as data is judged with
 * `flawOf` first, so that what is wrong with it can be refused rather than
 * thrown.
 */
export function defineCurrency<C extends CurrencyCode>(currency: Currency<C>): Currency<C> {
  const flaw = flawOf(currency);
  if (flaw !== null) {
    throw new InvalidCurrencyError(explain(flaw, currency));
  }
  const { code, symbol, decimals, roundingIncrement, roundingMode } = currency;
  return Object.freeze({ code, symbol, decimals, roundingIncrement, roundingMode });
}

/** The rounding increment of a currency, as a decimal. */
export function incrementOf(currency: Currency): Decimal {
  return new Dec(currency.roundingIncrement);
}

/**
 * Maps a declared rounding mode onto the decimal library's constant.
 *
 * Throws past the switch rather than falling out of it: a mode that is not in
 * the union can only have come from outside the type system, and `undefined`
 * would be taken by the library as a silent instruction to round half-up.
 */
export function roundingOf(mode: RoundingMode): Rounding {
  switch (mode) {
    case 'half-up':
      return Dec.ROUND_HALF_UP;
    case 'half-even':
      return Dec.ROUND_HALF_EVEN;
    case 'up':
      return Dec.ROUND_UP;
    case 'down':
      return Dec.ROUND_DOWN;
    case 'ceil':
      return Dec.ROUND_CEIL;
    case 'floor':
      return Dec.ROUND_FLOOR;
  }
  throw new InvalidCurrencyError(`"${String(mode)}" is not a rounding mode.`);
}
