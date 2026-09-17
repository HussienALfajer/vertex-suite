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
 * Configured by cloning rather than by mutating the library default, so that
 * reconfiguring the library's global — a dependency may — does not change how
 * this system computes money.
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
 * The clone is exported, so a clone alone protected nothing: any importer could
 * call `Dec.set({ precision: 4 })` and every allocation in the process would
 * stop summing to its total. Its configuration methods are withdrawn instead.
 *
 * Not `Object.freeze(Dec)`, which is the obvious reach and breaks the library:
 * `pow`, `ln`, `cos` and `toFraction` raise the constructor's own precision for
 * their working digits and restore it afterwards, and a frozen constructor
 * makes each of them throw. Assigning a setting directly — `Dec.precision = 4`
 * — is refused by the linter, which is the one place that can see it.
 */
const refuseReconfiguration = (): never => {
  throw new TypeError(
    'The kernel decimal is configured once, in decimal.ts. Reconfiguring it would change how ' +
      'every amount in this process is computed.',
  );
};
Dec.set = refuseReconfiguration;
Dec.config = refuseReconfiguration;

/**
 * The rounding argument accepted by the decimal library, derived from the
 * library's own signature so it cannot drift from it.
 */
export type Rounding = NonNullable<Parameters<Decimal['toDecimalPlaces']>[1]>;

/**
 * True when the string is an exact decimal literal this system will accept.
 *
 * Exactly as given, surrounding whitespace included. It once trimmed before
 * testing, and the decimal library does not: `money(' 1.5')` passed this check
 * and then threw the library's own untyped error, which a boundary catching
 * `InvalidAmountError` to produce a refusal could not catch. Trimming what a
 * person typed is the boundary's decision, made before it gets here.
 */
export function isDecimalString(value: string): boolean {
  return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(value);
}
