import { describe, expect, it } from 'vitest';

import { defineCurrency } from './currency.js';
import { Dec } from './decimal.js';
import {
  AllocationError,
  CurrencyMismatchError,
  InvalidAmountError,
  InvalidCurrencyError,
  UnroundedAmountError,
} from './errors.js';
import {
  add,
  allocate,
  divide,
  equals,
  isRounded,
  money,
  round,
  subtract,
  sum,
  toDecimalString,
  zero,
} from './money.js';

/**
 * Currencies are data (`FX-01`), so the kernel ships none. These four exist for
 * the tests, and they are the four the pilot trades in.
 */
const USD = defineCurrency({
  code: 'USD',
  symbol: '$',
  decimals: 2,
  roundingIncrement: '0.01',
  roundingMode: 'half-up',
});

/** Settled to the smallest circulating note rather than to a subunit (`FX-07`). */
const SYP = defineCurrency({
  code: 'SYP',
  symbol: 'ل.س',
  decimals: 2,
  roundingIncrement: '100',
  roundingMode: 'half-up',
});

const EUR = defineCurrency({
  code: 'EUR',
  symbol: '€',
  decimals: 2,
  roundingIncrement: '0.01',
  roundingMode: 'half-even',
});

describe('defineCurrency', () => {
  it('refuses an increment finer than the stored precision', () => {
    expect(() =>
      defineCurrency({
        code: 'BAD',
        symbol: 'B',
        decimals: 2,
        roundingIncrement: '0.005',
        roundingMode: 'half-up',
      }),
    ).toThrow(InvalidCurrencyError);
  });

  it('refuses a non-positive increment', () => {
    expect(() =>
      defineCurrency({
        code: 'BAD',
        symbol: 'B',
        decimals: 2,
        roundingIncrement: '0',
        roundingMode: 'half-up',
      }),
    ).toThrow(InvalidCurrencyError);
  });

  it('refuses a rounding mode it does not know, which the library would read as half-up', () => {
    // FX-01 makes the currency list data, so a mode arrives as a stored string.
    for (const roundingMode of ['half_even', 'FLOOR', '']) {
      expect(() =>
        defineCurrency({
          code: 'EUR',
          symbol: '€',
          decimals: 2,
          roundingIncrement: '0.01',
          roundingMode: roundingMode as 'half-even',
        }),
      ).toThrow(InvalidCurrencyError);
    }
  });

  it('freezes the definition', () => {
    expect(Object.isFrozen(USD)).toBe(true);
  });
});

describe('Dec', () => {
  it('cannot be reconfigured, because every amount in the process is computed under it', () => {
    expect(() => Dec.set({ precision: 4 })).toThrow(TypeError);
    expect(() => Dec.config({ rounding: Dec.ROUND_UP })).toThrow(TypeError);
    expect(Dec.precision).toBe(40);
  });

  it('still works the methods that raise its precision for their own working digits', () => {
    // Why it is not simply frozen: these assign to the constructor and restore it.
    expect(new Dec('2').pow('0.5').toDecimalPlaces(6).toFixed()).toBe('1.414214');
    expect(new Dec('100').log(10).toFixed()).toBe('2');
  });
});

describe('money', () => {
  it('parses an exact decimal string without loss', () => {
    expect(toDecimalString(money('0.1', 'USD'))).toBe('0.1');
    expect(toDecimalString(money('12345678901234.5678', 'USD'))).toBe('12345678901234.5678');
  });

  it('rejects anything that is not an exact decimal', () => {
    expect(() => money('1,50', 'USD')).toThrow(InvalidAmountError);
    expect(() => money('1e5', 'USD')).toThrow(InvalidAmountError);
    expect(() => money('', 'USD')).toThrow(InvalidAmountError);
    expect(() => money('abc', 'USD')).toThrow(InvalidAmountError);
  });

  it('refuses surrounding whitespace with its own error, not the library’s', () => {
    // A boundary turns InvalidAmountError into a refusal a person can read; the
    // library's untyped error would have escaped it as a crash.
    for (const padded of [' 1.5', '1.5\n', '\t2']) {
      expect(() => money(padded, 'USD')).toThrow(InvalidAmountError);
    }
  });

  it('adds without the error a float would introduce', () => {
    // 0.1 + 0.2 is the canonical float failure. It must be exactly 0.3 here.
    const result = add(money('0.1', 'USD'), money('0.2', 'USD'));
    expect(toDecimalString(result)).toBe('0.3');
  });

  it('refuses to combine two currencies at run time', () => {
    const usd = money('1.00', 'USD');
    const syp = money('1.00', 'SYP');
    // @ts-expect-error — and refuses at compile time, which is the point of the type parameter.
    expect(() => add(usd, syp)).toThrow(CurrencyMismatchError);
  });

  it('sums an empty list to zero of the stated currency', () => {
    expect(equals(sum([], 'USD'), zero('USD'))).toBe(true);
  });
});

describe('round', () => {
  // Shaped for FX-07, and deliberately not named for it: this proves the arithmetic of rounding, not that a residual reaches a rounding account. A test name is
  // the claim that the feature behaves as specified, and `check:coverage` would
  // count this as that proof the day its unit is delivered.
  it('settles USD to the cent and hands back the residual', () => {
    const { value, residual } = round(money('10.004', 'USD'), USD);
    expect(toDecimalString(value)).toBe('10');
    expect(toDecimalString(residual)).toBe('0.004');
  });

  it('settles SYP to the nearest hundred', () => {
    expect(toDecimalString(round(money('12345', 'SYP'), SYP).value)).toBe('12300');
    expect(toDecimalString(round(money('12350', 'SYP'), SYP).value)).toBe('12400');
    expect(toDecimalString(round(money('12351', 'SYP'), SYP).value)).toBe('12400');
  });

  it('applies half-even where the currency asks for it', () => {
    expect(toDecimalString(round(money('1.005', 'EUR'), EUR).value)).toBe('1');
    expect(toDecimalString(round(money('1.015', 'EUR'), EUR).value)).toBe('1.02');
  });

  it('returns a value and residual that add back to the original exactly', () => {
    const original = money('12345.6789', 'SYP');
    const { value, residual } = round(original, SYP);
    expect(equals(add(value, residual), original)).toBe(true);
  });

  it('leaves an already settled amount alone, with a zero residual', () => {
    const settled = money('12300', 'SYP');
    const { value, residual } = round(settled, SYP);
    expect(equals(value, settled)).toBe(true);
    expect(toDecimalString(residual)).toBe('0');
  });
});

describe('divide', () => {
  // Shaped for PUR-04, and deliberately not named for it: spreading a cost over free goods is a purchasing rule this division only serves. A test name is
  // the claim that the feature behaves as specified, and `check:coverage` would
  // count this as that proof the day its unit is delivered.
  it('spreads an invoice cost across paid and free quantities', () => {
    // Receiving 100 paid plus 10 free at a total cost of 1000 must yield a unit
    // cost of 1000/110, not 1000/100.
    const unitCost = divide(money('1000.00', 'USD'), '110');
    expect(unitCost.amount.toDecimalPlaces(6).toFixed()).toBe('9.090909');
    expect(toDecimalString(divide(money('1000.00', 'USD'), '100'))).toBe('10');
  });

  it('refuses division by zero', () => {
    expect(() => divide(money('1.00', 'USD'), '0')).toThrow(InvalidAmountError);
  });
});

describe('allocate', () => {
  it('splits an amount that does not divide evenly, without losing a cent', () => {
    const parts = allocate(money('100.00', 'USD'), ['1', '1', '1'], USD);
    expect(parts.map(toDecimalString)).toEqual(['33.34', '33.33', '33.33']);
    expect(toDecimalString(sum(parts, 'USD'))).toBe('100');
  });

  it('splits a cost in proportion to value', () => {
    // The arithmetic under PUR-06's landed cost; the feature itself is not proven here.
    const freight = money('75.00', 'USD');
    const parts = allocate(freight, ['1200.00', '800.00', '500.00'], USD);
    expect(toDecimalString(sum(parts, 'USD'))).toBe('75');
    expect(parts.map(toDecimalString)).toEqual(['36', '24', '15']);
  });

  it('honours a zero weight', () => {
    const parts = allocate(money('10.00', 'USD'), ['1', '0', '1'], USD);
    expect(parts.map(toDecimalString)).toEqual(['5', '0', '5']);
  });

  it('splits a negative total the same way it splits a positive one', () => {
    const parts = allocate(money('-100.00', 'USD'), ['1', '1', '1'], USD);
    expect(parts.map(toDecimalString)).toEqual(['-33.34', '-33.33', '-33.33']);
    expect(toDecimalString(sum(parts, 'USD'))).toBe('-100');
  });

  it('respects a coarse rounding increment', () => {
    const parts = allocate(money('10000', 'SYP'), ['1', '1', '1'], SYP);
    expect(parts.map(toDecimalString)).toEqual(['3400', '3300', '3300']);
    expect(toDecimalString(sum(parts, 'SYP'))).toBe('10000');
  });

  it('refuses an unsettled total rather than inventing a residual', () => {
    expect(() => allocate(money('100.005', 'USD'), ['1', '1'], USD)).toThrow(UnroundedAmountError);
  });

  it('refuses weights that sum to zero', () => {
    expect(() => allocate(money('10.00', 'USD'), ['0', '0'], USD)).toThrow(AllocationError);
  });

  it('refuses a negative weight', () => {
    expect(() => allocate(money('10.00', 'USD'), ['1', '-1'], USD)).toThrow(AllocationError);
  });

  it('is deterministic for identical inputs', () => {
    // PRC-10 needs a split that does not depend on anything but its inputs.
    const once = allocate(money('100.00', 'USD'), ['7', '11', '13'], USD).map(toDecimalString);
    const twice = allocate(money('100.00', 'USD'), ['7', '11', '13'], USD).map(toDecimalString);
    expect(once).toEqual(twice);
  });
});

describe('isRounded', () => {
  it('recognises settled and unsettled amounts', () => {
    expect(isRounded(money('12300', 'SYP'), SYP)).toBe(true);
    expect(isRounded(money('12350', 'SYP'), SYP)).toBe(false);
    expect(isRounded(money('1.23', 'USD'), USD)).toBe(true);
    expect(isRounded(money('1.234', 'USD'), USD)).toBe(false);
  });
});

describe('subtract', () => {
  it('returns zero for an amount less itself', () => {
    const a = money('987.65', 'USD');
    expect(toDecimalString(subtract(a, a))).toBe('0');
  });

  it('keeps precision the decimal library would otherwise lose to a float', () => {
    const result = subtract(money('0.3', 'USD'), money('0.1', 'USD'));
    expect(result.amount.equals(new Dec('0.2'))).toBe(true);
  });
});
