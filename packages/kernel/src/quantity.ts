import { Dec, isDecimalString, type Decimal } from './decimal.js';
import { InvalidAmountError, KernelError } from './errors.js';

/**
 * Quantities, and the units they are always expressed in.
 *
 * A quantity without its unit is not a quantity. `design-system.md` §12 makes
 * that a display contract; this makes it a type, so the unit cannot be lost on
 * the way to the screen.
 */

export type UnitCode = string;

/**
 * What the unit measures.
 *
 * `weight` exists as a distinct kind because §12 requires a weight never to be
 * shown as an integer count: 1 kg of tomatoes and 1 tin of tomatoes are not the
 * same statement, and a cashier reading "1" for a weighed item is reading a
 * defect.
 */
export type UnitKind = 'count' | 'weight' | 'volume' | 'length';

const UNIT_KINDS: ReadonlySet<string> = new Set<UnitKind>(['count', 'weight', 'volume', 'length']);

/** A unit of measure (`CAT-08`). Data, like currencies. */
export interface Unit<U extends UnitCode = UnitCode> {
  readonly code: U;
  readonly kind: UnitKind;
  /** Decimal places at which a quantity in this unit is stored. */
  readonly decimals: number;
}

export class InvalidUnitError extends KernelError {}

/** An amount of something, in one unit. */
export interface Quantity<U extends UnitCode = UnitCode> {
  readonly amount: Decimal;
  readonly unit: U;
}

export class UnitMismatchError extends KernelError {
  readonly left: string;
  readonly right: string;
  constructor(left: string, right: string) {
    super(`Cannot combine a quantity in ${left} with a quantity in ${right}.`);
    this.left = left;
    this.right = right;
  }
}

/** Validates a unit record and freezes it. */
export function defineUnit<U extends UnitCode>(unit: Unit<U>): Unit<U> {
  const { code, kind, decimals } = unit;
  if (code.trim() === '') {
    throw new InvalidUnitError('A unit code must not be empty.');
  }
  // Units are data (CAT-08) as currencies are, and the rules below branch on the
  // kind: an unknown one would be treated as a measure and accepted.
  if (!UNIT_KINDS.has(kind)) {
    throw new InvalidUnitError(`Unit ${code} measures "${kind}", which is not a kind of unit.`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new InvalidUnitError(
      `Unit ${code} declares ${String(decimals)} decimal places; expected an integer between 0 and 12.`,
    );
  }
  if (kind === 'count' && decimals !== 0) {
    throw new InvalidUnitError(
      `Unit ${code} counts things, so it cannot carry ${String(decimals)} decimal places. ` +
        'Half a tin is a different unit, not a fraction of this one.',
    );
  }
  if (kind !== 'count' && decimals === 0) {
    throw new InvalidUnitError(
      `Unit ${code} measures ${kind}, so it needs decimal places: stored at zero it would ` +
        'render a weight as a count, which §12 forbids.',
    );
  }
  return Object.freeze({ code, kind, decimals });
}

/**
 * Constructs a quantity from an exact decimal string or an existing decimal.
 *
 * As with money, there is no constructor taking a `number`: a weight read from
 * a scale is a decimal from the moment it is parsed.
 */
export function quantity<U extends UnitCode>(amount: string | Decimal, unit: U): Quantity<U> {
  if (typeof amount === 'string') {
    if (!isDecimalString(amount)) {
      throw new InvalidAmountError(`"${amount}" is not an exact decimal quantity.`);
    }
    return Object.freeze({ amount: new Dec(amount), unit });
  }
  if (!amount.isFinite()) {
    throw new InvalidAmountError('A quantity must be finite.');
  }
  return Object.freeze({ amount, unit });
}

export function zeroQuantity<U extends UnitCode>(unit: U): Quantity<U> {
  return quantity(new Dec(0), unit);
}

function assertSameUnit(left: UnitCode, right: UnitCode): void {
  if (left !== right) {
    throw new UnitMismatchError(left, right);
  }
}

export function addQuantity<U extends UnitCode>(
  a: Quantity<U>,
  b: Quantity<NoInfer<U>>,
): Quantity<U> {
  assertSameUnit(a.unit, b.unit);
  return quantity(a.amount.plus(b.amount), a.unit);
}

export function subtractQuantity<U extends UnitCode>(
  a: Quantity<U>,
  b: Quantity<NoInfer<U>>,
): Quantity<U> {
  assertSameUnit(a.unit, b.unit);
  return quantity(a.amount.minus(b.amount), a.unit);
}

export function negateQuantity<U extends UnitCode>(a: Quantity<U>): Quantity<U> {
  return quantity(a.amount.negated(), a.unit);
}

export function compareQuantity<U extends UnitCode>(
  a: Quantity<U>,
  b: Quantity<NoInfer<U>>,
): -1 | 0 | 1 {
  assertSameUnit(a.unit, b.unit);
  const result = a.amount.comparedTo(b.amount);
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

export function quantityEquals<U extends UnitCode>(
  a: Quantity<U>,
  b: Quantity<NoInfer<U>>,
): boolean {
  return a.unit === b.unit && a.amount.equals(b.amount);
}

export function isZeroQuantity(a: Quantity): boolean {
  return a.amount.isZero();
}

/** The exact stored value, with no locale applied. */
export function quantityToDecimalString(a: Quantity): string {
  return a.amount.toFixed();
}
