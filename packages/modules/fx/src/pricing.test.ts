import type { BranchId } from '@vertex/contracts';
import { isOk, money, toDecimalString, type Refusal, type Result } from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import { ROUNDING_ACCOUNT, type RateQuote } from './contract.js';
import { DAY, installFx, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code}`);
}

function refused<T>(result: Result<T, Refusal>): Refusal {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error;
}

/** Pounds to the dollar: received at 13,100 and paid out at 12,900. */
const POUNDS: RateQuote = { form: 'units-per-functional', buy: '13100', sell: '12900' };

let fx: Installed;
let aleppo: BranchId;

beforeEach(async () => {
  fx = installFx();
  taken(await fx.admin.seed(fx.system));
  aleppo = fx.openBranch();
});

describe('A functional-currency price restated as what a customer pays — PRC-02 FX-06 FX-07', () => {
  it('applies the buy side, because a customer paying the shelf price is the shop receiving that currency', async () => {
    const revision = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    const converted = taken(await fx.pricing.convert(fx.by, aleppo, money('1.25', 'USD'), 'SYP'));

    // 1.25 × 13,100 = 16,375: exactly what the till would take for the dollar
    // price at today's received side. The mid (13,000) would print 16,250 on
    // the shelf and the till would then ask 125 more for the same item.
    expect(toDecimalString(converted.exact)).toBe('16375');
    expect(converted.rate).toEqual({
      currency: 'SYP',
      functional: 'USD',
      side: 'buy',
      rate: revision.buy,
      revision: revision.id,
      sequence: 1,
      day: '2026-09-17',
      recordedAt: revision.recordedAt,
    });
  });

  it('settles once, onto the currency’s own step and direction, and hands back what settling moved', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    const converted = taken(await fx.pricing.convert(fx.by, aleppo, money('1.25', 'USD'), 'SYP'));

    // The seeded pound settles half-up to the ten-pound note: 16,375 → 16,380.
    expect(`${toDecimalString(converted.amount)} ${converted.amount.currency}`).toBe('16380 SYP');
    expect(converted.rounding).toEqual({ increment: '10', mode: 'half-up' });
    expect(converted.residual).toEqual({
      account: ROUNDING_ACCOUNT,
      point: 'settlement',
      amount: money('-5', 'SYP'),
    });
  });

  it('follows the owner’s revised rounding rule rather than any figure of its own', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    taken(await fx.admin.revise(fx.by, 'SYP', { roundingIncrement: '100', roundingMode: 'floor' }));

    const converted = taken(await fx.pricing.convert(fx.by, aleppo, money('0.37', 'USD'), 'SYP'));

    // 0.37 × 13,100 = 4,847, floored to the hundred-pound note.
    expect(toDecimalString(converted.exact)).toBe('4847');
    expect(toDecimalString(converted.amount)).toBe('4800');
    expect(converted.rounding).toEqual({ increment: '100', mode: 'floor' });
  });

  it('keeps a fractional rate exact until the one rounding point', async () => {
    taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
        form: 'units-per-functional',
        buy: '13104.5',
        sell: '12900',
      }),
    );

    const converted = taken(await fx.pricing.convert(fx.by, aleppo, money('2.99', 'USD'), 'SYP'));

    expect(toDecimalString(converted.exact)).toBe('39182.455');
    expect(toDecimalString(converted.amount)).toBe('39180');
    expect(toDecimalString(converted.residual.amount)).toBe('2.455');
  });

  it('uses the latest correction of the day and names it', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    const corrected = taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
        form: 'units-per-functional',
        buy: '13200',
        sell: '13000',
      }),
    );

    const converted = taken(await fx.pricing.convert(fx.by, aleppo, money('1', 'USD'), 'SYP'));

    expect(converted.rate).toMatchObject({ revision: corrected.id, sequence: 2, rate: '13200' });
    expect(toDecimalString(converted.amount)).toBe('13200');
  });

  it('refuses when today has no rate, and never reaches back to yesterday’s', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    fx.clock.advance(DAY);

    expect(refused(await fx.pricing.convert(fx.by, aleppo, money('1', 'USD'), 'SYP'))).toEqual({
      code: 'fx.rate-missing',
      values: { branch: aleppo, currency: 'SYP', day: '2026-09-18' },
    });
  });

  it('never prices on a register’s confirmed last-known rate — that exception is for trading at a cut-off till', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    fx.clock.advance(DAY);
    const till = fx.openRegister(aleppo);
    const atTill = fx.at(till.device);
    taken(await fx.rateAdmin.confirmLastKnown(atTill, aleppo));
    // The till itself trades on yesterday's rate…
    expect(taken(await fx.rates.current(atTill, aleppo, 'SYP')).lastKnown).not.toBeNull();

    // …and a price frozen from there would be yesterday's rate stored as today's.
    expect(refused(await fx.pricing.convert(atTill, aleppo, money('1', 'USD'), 'SYP')).code).toBe(
      'fx.rate-missing',
    );
  });

  it('refuses a branch that is withdrawn, unknown, or another tenant’s', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    const theirs = fx.openBranch({ tenant: fx.otherTenant });

    expect(refused(await fx.pricing.convert(fx.by, theirs, money('1', 'USD'), 'SYP')).code).toBe(
      'fx.branch-not-found',
    );
    fx.shutBranch(aleppo);
    expect(refused(await fx.pricing.convert(fx.by, aleppo, money('1', 'USD'), 'SYP')).code).toBe(
      'fx.branch-inactive',
    );
  });

  it('converts only out of the functional currency, into a currency the shop takes', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    expect(refused(await fx.pricing.convert(fx.by, aleppo, money('1', 'EUR'), 'SYP')).code).toBe(
      'fx.cross-rate-unsupported',
    );
    expect(refused(await fx.pricing.convert(fx.by, aleppo, money('1', 'USD'), 'USD')).code).toBe(
      'fx.currency-is-functional',
    );
    taken(await fx.admin.disable(fx.by, 'SYP'));
    expect(refused(await fx.pricing.convert(fx.by, aleppo, money('1', 'USD'), 'SYP')).code).toBe(
      'fx.currency-disabled',
    );
  });
});

describe('Many prices restated at one reading of today’s rate — PRC-03 FX-06 FX-07', () => {
  it('settles each price exactly as a single conversion would, all at one revision', async () => {
    const revision = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    const amounts = [money('1.25', 'USD'), money('0.37', 'USD'), money('10', 'USD')];

    const all = taken(await fx.pricing.convertAll(fx.by, aleppo, amounts, 'SYP'));

    expect(all.map((one) => toDecimalString(one.amount))).toEqual(['16380', '4850', '131000']);
    for (const [at, amount] of amounts.entries()) {
      const one = taken(await fx.pricing.convert(fx.by, aleppo, amount, 'SYP'));
      expect(all[at]).toEqual(one);
    }
    expect(new Set(all.map((one) => one.rate.revision))).toEqual(new Set([revision.id]));
  });

  it('refuses the whole batch as a single conversion would be refused, and converts none', async () => {
    expect(
      refused(await fx.pricing.convertAll(fx.by, aleppo, [money('1', 'USD')], 'SYP')).code,
    ).toBe('fx.rate-missing');
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    expect(
      refused(
        await fx.pricing.convertAll(fx.by, aleppo, [money('1', 'USD'), money('1', 'EUR')], 'SYP'),
      ).code,
    ).toBe('fx.cross-rate-unsupported');
    expect(taken(await fx.pricing.convertAll(fx.by, aleppo, [], 'SYP'))).toEqual([]);
  });

  it('answers the rate a conversion would use now, and follows the day’s correction', async () => {
    expect(refused(await fx.pricing.rate(fx.by, aleppo, 'SYP')).code).toBe('fx.rate-missing');
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    const corrected = taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
        form: 'units-per-functional',
        buy: '13200',
        sell: '13000',
      }),
    );

    const rate = taken(await fx.pricing.rate(fx.by, aleppo, 'SYP'));

    expect(rate).toEqual(
      taken(await fx.pricing.convert(fx.by, aleppo, money('1', 'USD'), 'SYP')).rate,
    );
    expect(rate).toMatchObject({ revision: corrected.id, side: 'buy', rate: '13200' });
    fx.clock.advance(DAY);
    expect(refused(await fx.pricing.rate(fx.by, aleppo, 'SYP')).code).toBe('fx.rate-missing');
  });

  it('refuses more prices than one conversion takes, as a defect in the caller', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    const many = Array.from({ length: 5_001 }, () => money('1', 'USD'));
    await expect(fx.pricing.convertAll(fx.by, aleppo, many, 'SYP')).rejects.toThrow(RangeError);
  });
});
