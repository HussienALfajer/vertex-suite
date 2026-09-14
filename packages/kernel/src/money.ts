import { incrementOf, roundingOf, type Currency, type CurrencyCode } from './currency.js';
import { Dec, isDecimalString, type Decimal } from './decimal.js';
import {
  AllocationError,
  CurrencyMismatchError,
  InvalidAmountError,
  UnroundedAmountError,
} from './errors.js';

/**
 * An exact amount in one currency.
 *
 * Every operation takes its currency from the first argument and requires the
 * rest to match it exactly (`NoInfer`), because without that TypeScript would
 * happily infer a union and let the two be combined.
 *
 * The currency is a type parameter, so `Money<'USD'>` and `Money<'SYP'>` are
 * different types wherever the code is a literal, and adding one to the other
 * fails to compile rather than failing in a shop. The runtime check exists for
 * the boundaries where the code is only known at run time.
 */
export interface Money<C extends CurrencyCode = CurrencyCode> {
  readonly amount: Decimal;
  readonly currency: C;
}

/**
 * Constructs an amount from an exact decimal string or an existing decimal.
 *
 * There is deliberately no constructor taking a `number`. A JavaScript float
 * cannot represent `0.1`, and once such a value enters the system there is no
 * later point at which the error can be detected, only points at which it is
 * carried forward.
 */
export function money<C extends CurrencyCode>(amount: string | Decimal, currency: C): Money<C> {
  if (typeof amount === 'string') {
    if (!isDecimalString(amount)) {
      throw new InvalidAmountError(`"${amount}" is not an exact decimal amount.`);
    }
    return Object.freeze({ amount: new Dec(amount), currency });
  }
  if (!amount.isFinite()) {
    throw new InvalidAmountError('An amount must be finite.');
  }
  return Object.freeze({ amount, currency });
}

/** Zero in the given currency. */
export function zero<C extends CurrencyCode>(currency: C): Money<C> {
  return money(new Dec(0), currency);
}

function assertSameCurrency(left: CurrencyCode, right: CurrencyCode): void {
  if (left !== right) {
    throw new CurrencyMismatchError(left, right);
  }
}

export function add<C extends CurrencyCode>(a: Money<C>, b: Money<NoInfer<C>>): Money<C> {
  assertSameCurrency(a.currency, b.currency);
  return money(a.amount.plus(b.amount), a.currency);
}

export function subtract<C extends CurrencyCode>(a: Money<C>, b: Money<NoInfer<C>>): Money<C> {
  assertSameCurrency(a.currency, b.currency);
  return money(a.amount.minus(b.amount), a.currency);
}

export function negate<C extends CurrencyCode>(a: Money<C>): Money<C> {
  return money(a.amount.negated(), a.currency);
}

export function absolute<C extends CurrencyCode>(a: Money<C>): Money<C> {
  return money(a.amount.absoluteValue(), a.currency);
}

/** Multiplies by a dimensionless factor — a quantity, a percentage, a rate. */
export function multiply<C extends CurrencyCode>(a: Money<C>, factor: string | Decimal): Money<C> {
  return money(a.amount.times(toDecimal(factor)), a.currency);
}

/**
 * Divides by a dimensionless divisor.
 *
 * The result keeps the full working precision and is deliberately *not*
 * rounded: `PUR-04` redistributes an invoice cost across a received quantity
 * including free goods, and rounding at that step would move cost that belongs
 * in the inventory account.
 */
export function divide<C extends CurrencyCode>(a: Money<C>, divisor: string | Decimal): Money<C> {
  const d = toDecimal(divisor);
  if (d.isZero()) {
    throw new InvalidAmountError('Cannot divide an amount by zero.');
  }
  return money(a.amount.dividedBy(d), a.currency);
}

/** Sums amounts of one currency. The currency is required so an empty list still has one. */
export function sum<C extends CurrencyCode>(
  items: readonly Money<NoInfer<C>>[],
  currency: C,
): Money<C> {
  let total = new Dec(0);
  for (const item of items) {
    assertSameCurrency(item.currency, currency);
    total = total.plus(item.amount);
  }
  return money(total, currency);
}

export function compare<C extends CurrencyCode>(a: Money<C>, b: Money<NoInfer<C>>): -1 | 0 | 1 {
  assertSameCurrency(a.currency, b.currency);
  const result = a.amount.comparedTo(b.amount);
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

export function equals<C extends CurrencyCode>(a: Money<C>, b: Money<NoInfer<C>>): boolean {
  return a.currency === b.currency && a.amount.equals(b.amount);
}

export function isZero(a: Money): boolean {
  return a.amount.isZero();
}

export function isNegative(a: Money): boolean {
  return a.amount.isNegative() && !a.amount.isZero();
}

export function isPositive(a: Money): boolean {
  return a.amount.isPositive() && !a.amount.isZero();
}

/** The exact stored value, with no locale applied. Presentation belongs to the interface. */
export function toDecimalString(a: Money): string {
  return a.amount.toFixed();
}

/**
 * The result of settling an amount onto its currency's rounding increment.
 *
 * `FX-07` requires the residual to go to a rounding account so that totals
 * never drift, which is only possible if rounding hands it back rather than
 * discarding it. `value` plus `residual` is exactly the amount that went in.
 */
export interface Rounded<C extends CurrencyCode = CurrencyCode> {
  readonly value: Money<C>;
  readonly residual: Money<C>;
}

/** Settles an amount onto the currency's rounding increment (`FX-07`). */
export function round<C extends CurrencyCode>(
  a: Money<C>,
  currency: Currency<NoInfer<C>>,
): Rounded<C> {
  assertSameCurrency(a.currency, currency.code);
  const increment = incrementOf(currency);
  const units = a.amount.dividedBy(increment).toDecimalPlaces(0, roundingOf(currency.roundingMode));
  const value = units.times(increment);
  return Object.freeze({
    value: money(value, a.currency),
    residual: money(a.amount.minus(value), a.currency),
  });
}

/** True when the amount is already a whole number of the currency's increments. */
export function isRounded<C extends CurrencyCode>(
  a: Money<C>,
  currency: Currency<NoInfer<C>>,
): boolean {
  assertSameCurrency(a.currency, currency.code);
  return a.amount.modulo(incrementOf(currency)).isZero();
}

/**
 * Splits a settled amount across weights without losing or inventing a single
 * increment.
 *
 * Used wherever one figure must become several that still add back to it:
 * landed cost across received lines (`PUR-06`), an invoice discount across its
 * lines (`PRC-08`), an invoice cost across paid and free quantities (`PUR-04`).
 *
 * The naive approach — round each share independently — produces a set of
 * shares whose total differs from the original, and the difference then has to
 * be explained to an accountant. This distributes the shortfall by largest
 * remainder, deterministically, so the sum is exact by construction.
 *
 * The total must already be settled: allocating an unsettled amount would leave
 * a residual that this function has no account to put it in.
 */
export function allocate<C extends CurrencyCode>(
  total: Money<C>,
  weights: readonly (string | Decimal)[],
  currency: Currency<NoInfer<C>>,
): Money<C>[] {
  assertSameCurrency(total.currency, currency.code);

  if (weights.length === 0) {
    throw new AllocationError('An allocation needs at least one weight.');
  }
  if (!isRounded(total, currency)) {
    throw new UnroundedAmountError(
      `Cannot allocate ${toDecimalString(total)} ${total.currency}: it is not a whole number of ` +
        `${currency.roundingIncrement} increments. Round it first and post the residual.`,
    );
  }

  const parsed = weights.map((weight) => toDecimal(weight));
  if (parsed.some((weight) => weight.isNegative())) {
    throw new AllocationError('An allocation weight must not be negative.');
  }

  const totalWeight = parsed.reduce((acc, weight) => acc.plus(weight), new Dec(0));
  if (totalWeight.isZero()) {
    throw new AllocationError('Allocation weights must not sum to zero.');
  }

  // Work on the magnitude so that a negative total (a credit note, a reversal)
  // distributes the same way a positive one does.
  const negative = total.amount.isNegative();
  const magnitude = negative ? total.amount.negated() : total.amount;
  const increment = incrementOf(currency);

  const units: Decimal[] = [];
  const fractions: Decimal[] = [];
  for (const weight of parsed) {
    const ideal = magnitude.times(weight).dividedBy(totalWeight).dividedBy(increment);
    const whole = ideal.toDecimalPlaces(0, Dec.ROUND_DOWN);
    units.push(whole);
    fractions.push(ideal.minus(whole));
  }

  const placed = units.reduce((acc, count) => acc.plus(count), new Dec(0));
  let remaining = magnitude.dividedBy(increment).minus(placed);

  // Largest remainder first; ties broken by position so two identical inputs
  // always produce the same split, online or offline.
  const order = fractions
    .map((fraction, index) => ({ fraction, index }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);

  for (const { index } of order) {
    // Not `isPositive()`: the decimal library reports the sign, and zero is
    // signed positive. Stopping on that would hand out one increment too many.
    if (!remaining.greaterThan(0)) break;
    const current = units[index];
    if (current === undefined) continue;
    units[index] = current.plus(1);
    remaining = remaining.minus(1);
  }

  return units.map((count) => {
    const share = count.times(increment);
    return money(negative ? share.negated() : share, total.currency);
  });
}

function toDecimal(value: string | Decimal): Decimal {
  if (typeof value === 'string') {
    if (!isDecimalString(value)) {
      throw new InvalidAmountError(`"${value}" is not an exact decimal.`);
    }
    return new Dec(value);
  }
  if (!value.isFinite()) {
    throw new InvalidAmountError('A factor must be finite.');
  }
  return value;
}
