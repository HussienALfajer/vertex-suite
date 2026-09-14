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
 */
export type RoundingMode = 'half-up' | 'half-even' | 'up' | 'down' | 'ceil' | 'floor';

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
 * Validates a currency record and freezes it.
 *
 * The checks are not ceremony. A rounding increment finer than the stored
 * precision would let `round` produce a value that cannot be stored, and the
 * residual of `FX-07` would then absorb a difference that no account explains.
 */
export function defineCurrency<C extends CurrencyCode>(currency: Currency<C>): Currency<C> {
  const { code, symbol, decimals, roundingIncrement, roundingMode } = currency;

  if (code.trim() === '') {
    throw new InvalidCurrencyError('A currency code must not be empty.');
  }
  if (symbol.trim() === '') {
    throw new InvalidCurrencyError(`Currency ${code} must declare a symbol.`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new InvalidCurrencyError(
      `Currency ${code} declares ${String(decimals)} decimal places; expected an integer between 0 and 12.`,
    );
  }
  if (!isDecimalString(roundingIncrement)) {
    throw new InvalidCurrencyError(
      `Currency ${code} declares a rounding increment of "${roundingIncrement}", which is not an exact decimal.`,
    );
  }

  const increment = new Dec(roundingIncrement);
  if (!increment.isPositive() || increment.isZero()) {
    throw new InvalidCurrencyError(
      `Currency ${code} declares a rounding increment that is not positive.`,
    );
  }
  if (increment.decimalPlaces() > decimals) {
    throw new InvalidCurrencyError(
      `Currency ${code} rounds to ${roundingIncrement} but stores only ${String(decimals)} decimal places, ` +
        'so a rounded amount could not be stored exactly.',
    );
  }

  return Object.freeze({ code, symbol, decimals, roundingIncrement, roundingMode });
}

/** The rounding increment of a currency, as a decimal. */
export function incrementOf(currency: Currency): Decimal {
  return new Dec(currency.roundingIncrement);
}

/** Maps a declared rounding mode onto the decimal library's constant. */
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
}
