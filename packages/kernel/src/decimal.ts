// The named export is imported rather than the default: decimal.js merges a
// class, a function and a namespace under one name, and its default export
// resolves to the namespace in type position, which is not a type.
import { Decimal as DecimalJs } from 'decimal.js';

/**
 * An exact decimal. Never a JavaScript float.
 *
 * Every monetary amount, quantity, cost and exchange rate in the system is one
 * of these from the moment it is parsed to the moment it is stored.
 */
export type Decimal = DecimalJs;

/**
 * A private Decimal constructor.
 *
 * Configured by cloning rather than by mutating the library default, so that no
 * other code in the process — a dependency, a future package — can change how
 * this system computes money by reconfiguring a global.
 *
 * 40 significant digits is far beyond any figure this product handles. The
 * headroom exists for the intermediate steps: a weighted-average cost
 * accumulated across tens of thousands of movements, and an amount divided by
 * an exchange rate carried at twelve decimal places.
 */
export const Dec = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});

/**
 * The rounding argument accepted by the decimal library, derived from the
 * library's own signature so it cannot drift from it.
 */
export type Rounding = NonNullable<Parameters<Decimal['toDecimalPlaces']>[1]>;

/** True when the string is an exact decimal literal this system will accept. */
export function isDecimalString(value: string): boolean {
  return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(value.trim());
}
