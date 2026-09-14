import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defineCurrency, incrementOf, type Currency } from './currency.js';
import { Dec } from './decimal.js';
import {
  add,
  allocate,
  equals,
  isRounded,
  money,
  round,
  subtract,
  sum,
  toDecimalString,
  type Money,
} from './money.js';

/**
 * Example-based tests check the cases we thought of. These check the properties
 * that must hold for every case, including the ones we did not.
 *
 * The invariants below are not stylistic. Each one is the difference between a
 * ledger that balances and a shop owner asking where the money went.
 */

const USD = defineCurrency({
  code: 'USD',
  symbol: '$',
  decimals: 2,
  roundingIncrement: '0.01',
  roundingMode: 'half-up',
});

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

const currencies: Currency[] = [USD, SYP, EUR];
const runs = { numRuns: 500 };

/** An amount that is already a whole number of the currency's increments. */
function settledIn(currency: Currency): fc.Arbitrary<Money> {
  const increment = incrementOf(currency);
  return fc
    .integer({ min: -1_000_000, max: 1_000_000 })
    .map((units) => money(new Dec(units).times(increment), currency.code));
}

/** Any amount at all, settled or not, at up to six decimal places. */
function anyAmountIn(currency: Currency): fc.Arbitrary<Money> {
  return fc
    .tuple(fc.integer({ min: -10_000_000, max: 10_000_000 }), fc.integer({ min: 0, max: 6 }))
    .map(([digits, scale]) =>
      money(new Dec(digits).dividedBy(new Dec(10).pow(scale)), currency.code),
    );
}

const weightsArbitrary = fc
  .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 12 })
  .filter((values) => values.some((value) => value > 0))
  .map((values) => values.map((value) => String(value)));

const currencyArbitrary = fc.constantFrom(...currencies);

/** A currency paired with an arbitrary amount denominated in it. */
const anyAmount = currencyArbitrary.chain((currency) =>
  fc.tuple(fc.constant(currency), anyAmountIn(currency)),
);

/** A currency paired with an amount already settled onto its increment. */
const settledAmount = currencyArbitrary.chain((currency) =>
  fc.tuple(fc.constant(currency), settledIn(currency)),
);

/** A currency, a settled amount in it, and a set of allocation weights. */
const settledAmountWithWeights = currencyArbitrary.chain((currency) =>
  fc.tuple(fc.constant(currency), settledIn(currency), weightsArbitrary),
);

describe('arithmetic', () => {
  it('addition is commutative', () => {
    fc.assert(
      fc.property(anyAmountIn(USD), anyAmountIn(USD), (a, b) => {
        expect(equals(add(a, b), add(b, a))).toBe(true);
      }),
      runs,
    );
  });

  it('addition is associative', () => {
    fc.assert(
      fc.property(anyAmountIn(USD), anyAmountIn(USD), anyAmountIn(USD), (a, b, c) => {
        expect(equals(add(add(a, b), c), add(a, add(b, c)))).toBe(true);
      }),
      runs,
    );
  });

  it('an amount less itself is exactly zero', () => {
    fc.assert(
      fc.property(anyAmountIn(USD), (a) => {
        expect(toDecimalString(subtract(a, a))).toBe('0');
      }),
      runs,
    );
  });

  it('a value survives a round trip through its decimal string', () => {
    fc.assert(
      fc.property(anyAmountIn(USD), (a) => {
        expect(equals(a, money(toDecimalString(a), a.currency))).toBe(true);
      }),
      runs,
    );
  });
});

describe('round — the FX-07 invariants', () => {
  it('value plus residual is exactly the original amount', () => {
    fc.assert(
      fc.property(anyAmount, ([currency, original]) => {
        const { value, residual } = round(original, currency);
        expect(equals(add(value, residual), original)).toBe(true);
      }),
      runs,
    );
  });

  it('the settled value is always a whole number of increments', () => {
    fc.assert(
      fc.property(anyAmount, ([currency, original]) => {
        expect(isRounded(round(original, currency).value, currency)).toBe(true);
      }),
      runs,
    );
  });

  it('the residual is always smaller than one increment', () => {
    fc.assert(
      fc.property(anyAmount, ([currency, original]) => {
        const { residual } = round(original, currency);
        expect(residual.amount.absoluteValue().lessThan(incrementOf(currency))).toBe(true);
      }),
      runs,
    );
  });

  it('settling an already settled amount changes nothing', () => {
    fc.assert(
      fc.property(settledAmount, ([currency, settled]) => {
        const { value, residual } = round(settled, currency);
        expect(equals(value, settled)).toBe(true);
        expect(residual.amount.isZero()).toBe(true);
      }),
      runs,
    );
  });
});

describe('allocate — the invariants that keep a ledger balanced', () => {
  it('the parts always add back to exactly the total', () => {
    fc.assert(
      fc.property(settledAmountWithWeights, ([currency, total, weights]) => {
        const parts = allocate(total, weights, currency);
        expect(equals(sum(parts, total.currency), total)).toBe(true);
      }),
      runs,
    );
  });

  it('produces exactly one part per weight', () => {
    fc.assert(
      fc.property(settledAmountWithWeights, ([currency, total, weights]) => {
        expect(allocate(total, weights, currency)).toHaveLength(weights.length);
      }),
      runs,
    );
  });

  it('every part is itself a settled amount', () => {
    fc.assert(
      fc.property(settledAmountWithWeights, ([currency, total, weights]) => {
        for (const part of allocate(total, weights, currency)) {
          expect(isRounded(part, currency)).toBe(true);
        }
      }),
      runs,
    );
  });

  it('no part is more than one increment away from its exact share', () => {
    fc.assert(
      fc.property(settledAmountWithWeights, ([currency, total, weights]) => {
        const parsed = weights.map((weight) => new Dec(weight));
        const totalWeight = parsed.reduce((acc, weight) => acc.plus(weight), new Dec(0));
        const increment = incrementOf(currency);

        allocate(total, weights, currency).forEach((part, index) => {
          const weight = parsed[index];
          if (weight === undefined) return;
          const ideal = total.amount.times(weight).dividedBy(totalWeight);
          expect(part.amount.minus(ideal).absoluteValue().lessThan(increment)).toBe(true);
        });
      }),
      runs,
    );
  });

  it('is deterministic — the same inputs always give the same split (PRC-10)', () => {
    fc.assert(
      fc.property(settledAmountWithWeights, ([currency, total, weights]) => {
        const first = allocate(total, weights, currency).map(toDecimalString);
        const second = allocate(total, weights, currency).map(toDecimalString);
        expect(first).toEqual(second);
      }),
      runs,
    );
  });
});
