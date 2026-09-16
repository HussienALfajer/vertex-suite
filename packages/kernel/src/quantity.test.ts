import { describe, expect, it } from 'vitest';

import { InvalidAmountError } from './errors.js';
import {
  addQuantity,
  defineUnit,
  InvalidUnitError,
  quantity,
  quantityToDecimalString,
  subtractQuantity,
  UnitMismatchError,
  zeroQuantity,
} from './quantity.js';

const KILOGRAM = defineUnit({ code: 'KG', kind: 'weight', decimals: 3 });

describe('defineUnit', () => {
  it('refuses a counting unit with decimal places', () => {
    expect(() => defineUnit({ code: 'PC', kind: 'count', decimals: 2 })).toThrow(InvalidUnitError);
  });

  it('refuses a measuring unit stored at zero decimal places', () => {
    // Stored at zero, a weight renders as a count — which §12 forbids, and
    // which would quietly turn 0.4 kg of tomatoes into nothing at all.
    expect(() => defineUnit({ code: 'KG', kind: 'weight', decimals: 0 })).toThrow(InvalidUnitError);
  });

  it('refuses a kind it does not know, which the rules below would read as a measure', () => {
    expect(() => defineUnit({ code: 'X', kind: 'Weight' as 'weight', decimals: 3 })).toThrow(
      InvalidUnitError,
    );
  });

  it('freezes the definition', () => {
    expect(Object.isFrozen(KILOGRAM)).toBe(true);
  });
});

describe('quantity', () => {
  it('parses an exact decimal without loss', () => {
    expect(quantityToDecimalString(quantity('0.125', 'KG'))).toBe('0.125');
  });

  it('rejects anything that is not an exact decimal', () => {
    expect(() => quantity('1,5', 'KG')).toThrow(InvalidAmountError);
    expect(() => quantity('1e3', 'KG')).toThrow(InvalidAmountError);
  });

  it('refuses to combine two units', () => {
    const kilos = quantity('1', 'KG');
    const pieces = quantity('1', 'PC');
    // @ts-expect-error — and refuses at compile time, which is the point.
    expect(() => addQuantity(kilos, pieces)).toThrow(UnitMismatchError);
  });

  it('adds and subtracts exactly', () => {
    expect(quantityToDecimalString(addQuantity(quantity('0.1', 'KG'), quantity('0.2', 'KG')))).toBe(
      '0.3',
    );
    const a = quantity('12.345', 'KG');
    expect(quantityToDecimalString(subtractQuantity(a, a))).toBe('0');
  });

  it('starts at zero in a stated unit', () => {
    expect(quantityToDecimalString(zeroQuantity('KG'))).toBe('0');
  });
});
