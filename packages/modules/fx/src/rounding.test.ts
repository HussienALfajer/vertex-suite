import type { BranchId } from '@vertex/contracts';
import {
  Dec,
  isOk,
  money,
  plusMillis,
  toDecimalString,
  type Money,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import { ROUNDING_ACCOUNT, type RateQuote, type RateStamp } from './contract.js';
import { DAY, installFx, NOON_IN_DAMASCUS, type Installed } from './edition.fixture.js';

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

/** Dollars to the euro, quoted the way a stronger currency is. */
const EUROS: RateQuote = { form: 'functional-per-unit', buy: '1.07', sell: '1.09' };

let fx: Installed;
let aleppo: BranchId;

beforeEach(async () => {
  fx = installFx();
  taken(await fx.admin.seed(fx.system));
  aleppo = fx.openBranch();
  taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
  taken(await fx.rateAdmin.record(fx.by, aleppo, 'EUR', EUROS));
});

async function stampFor(currency: string): Promise<RateStamp> {
  const prepared = taken(
    await fx.stamps.prepare(fx.by, { branch: aleppo, currency, direction: 'received' }),
  );
  return fx.asCaller(fx.by, (session) => fx.stamps.stamp(fx.by, session, prepared));
}

function shown(amount: Money): string {
  return `${toDecimalString(amount)} ${amount.currency}`;
}

describe('Per-currency rounding rules — FX-07', () => {
  it('settles an amount onto the step its own currency can be handed over in', async () => {
    // The pound settles to the ten-pound note, which the owner states is the
    // smallest in circulation; the dollar settles to the cent.
    const pounds = taken(await fx.rounding.settle(fx.by, money('13127', 'SYP')));
    const dollars = taken(await fx.rounding.settle(fx.by, money('10.3664', 'USD')));

    expect(shown(pounds.value)).toBe('13130 SYP');
    expect(shown(dollars.value)).toBe('10.37 USD');
  });

  it('hands back the residual with the account it is posted to, so no total drifts', async () => {
    const settled = taken(await fx.rounding.settle(fx.by, money('13127', 'SYP')));

    // `FX-07` requires the residual to reach a rounding account. `FIN` posts it
    // in `U06`; what `FX` owes is the figure and the account, and the figure is
    // exactly what settling moved — not an independently rounded one.
    expect(settled.residual).toEqual({
      account: ROUNDING_ACCOUNT,
      point: 'settlement',
      amount: money('-3', 'SYP'),
    });
    expect(ROUNDING_ACCOUNT).toBe('fx.rounding');
    expect(toDecimalString(settled.value) + toDecimalString(settled.residual.amount)).toBe(
      '13130-3',
    );
  });

  it('settles by the rule the owner revised, and not by the one the product shipped', async () => {
    // `FX-01` makes the rounding rule data. A shop that starts taking the
    // hundred-pound note as its smallest revises the currency, and the next
    // amount settles differently — with nothing rebuilt and nothing redeployed.
    taken(await fx.admin.revise(fx.by, 'SYP', { roundingIncrement: '100', roundingMode: 'down' }));

    const settled = taken(await fx.rounding.settle(fx.by, money('13199', 'SYP')));

    expect(shown(settled.value)).toBe('13100 SYP');
    expect(shown(settled.residual.amount)).toBe('99 SYP');
  });

  it('refuses an amount in a currency the tenant does not keep', async () => {
    expect(refused(await fx.rounding.settle(fx.by, money('10', 'GBP'))).code).toBe(
      'fx.currency-not-found',
    );
    expect(refused(await fx.rounding.settle(fx.byOther, money('10', 'USD'))).code).toBe(
      'fx.currency-not-found',
    );
  });

  it('states a document in the books at the rate it was stamped with, to the ledger’s precision', async () => {
    const stamp = await stampFor('SYP');

    const valued = taken(
      await fx.rounding.value(fx.by, {
        stamp,
        total: money('1310000', 'SYP'),
        lines: [money('655000', 'SYP'), money('655000', 'SYP')],
      }),
    );

    // The dollar is stored to four places (`FX-02`): the books carry what the
    // cent cannot, which is where the residual of `FX-07` comes from at all.
    expect(shown(valued.total)).toBe('100 USD');
    expect(valued.lines.map(shown)).toEqual(['50 USD', '50 USD']);
    expect(shown(valued.residual.amount)).toBe('0 USD');
    expect(valued.residual.point).toBe('ledger');
  });

  it('makes the rounding difference a balancing figure, never an independent one', async () => {
    const stamp = await stampFor('SYP');

    // Three lines that do not divide evenly by the rate: each one's own
    // equivalent is carried to four places, and the sum of the three is not
    // what the document's own total comes to.
    const valued = taken(
      await fx.rounding.value(fx.by, {
        stamp,
        total: money('100000', 'SYP'),
        lines: [money('33333', 'SYP'), money('33333', 'SYP'), money('33334', 'SYP')],
      }),
    );

    const sumOfLines = valued.lines.reduce((total, line) => total.plus(line.amount), new Dec(0));
    expect(valued.total.amount.minus(sumOfLines).toFixed()).toBe(
      toDecimalString(valued.residual.amount),
    );
    // The document's own total is the figure the books take; the lines are what
    // they add up to, and the difference between the two is what is posted.
    expect(shown(valued.total)).toBe('7.6336 USD');
    expect(valued.lines.map(shown)).toEqual(['2.5445 USD', '2.5445 USD', '2.5446 USD']);
    expect(shown(valued.residual.amount)).toBe('0 USD');
  });

  it('posts the difference the books cannot carry, and posts exactly that', async () => {
    const stamp = await stampFor('SYP');

    // Eight, fourteen and thirty-one pounds, at 13,100 to the dollar. Each line
    // rounds up to its own fourth place and the total rounds down to its own,
    // so the three lines come to a ten-thousandth more than the document does.
    const valued = taken(
      await fx.rounding.value(fx.by, {
        stamp,
        total: money('53', 'SYP'),
        lines: [money('8', 'SYP'), money('14', 'SYP'), money('31', 'SYP')],
      }),
    );

    expect(valued.lines.map(shown)).toEqual(['0.0006 USD', '0.0011 USD', '0.0024 USD']);
    expect(shown(valued.total)).toBe('0.004 USD');
    // The document's total minus what the lines come to, to the last place —
    // not a figure rounded into existence on its own, which would be a second
    // rounding of an amount that is already the difference between two.
    expect(shown(valued.residual.amount)).toBe('-0.0001 USD');
    expect(valued.residual.point).toBe('ledger');

    // The entry balances by construction: the lines and the residual are the
    // total, exactly, with no tolerance anywhere.
    const posted = [...valued.lines, valued.residual.amount].reduce(
      (running, one) => running.plus(one.amount),
      new Dec(0),
    );
    expect(posted.toFixed()).toBe(toDecimalString(valued.total));
  });

  it('keeps the residual within what rounding can account for, and never more', async () => {
    const stamp = await stampFor('SYP');
    // Seventeen lines, each ending in a figure the rate cannot divide cleanly.
    const lines = Array.from({ length: 17 }, (_, index) =>
      money(String(10_007 + index * 13), 'SYP'),
    );
    const total = money(
      lines.reduce((sum, line) => sum.plus(line.amount), new Dec(0)).toFixed(),
      'SYP',
    );

    const valued = taken(await fx.rounding.value(fx.by, { stamp, total, lines }));

    // Every line's own rounding can be out by at most half of the last place
    // the books keep, and so can the total's. Anything beyond that is not a
    // rounding difference and must not be posted as one.
    const bound = new Dec('0.00005').times(lines.length + 1);
    expect(valued.residual.amount.amount.absoluteValue().lessThanOrEqualTo(bound)).toBe(true);
    expect(valued.residual.amount.amount.isZero()).toBe(false);
  });

  it('refuses a document whose lines do not come to its total', async () => {
    const stamp = await stampFor('SYP');

    // A difference that is not rounding must never be posted as though it were.
    // The residual is a balancing figure, and a balancing figure over lines that
    // were already wrong would bury the caller's arithmetic in a rounding
    // account where nobody would ever look for it.
    const refusal = refused(
      await fx.rounding.value(fx.by, {
        stamp,
        total: money('1310000', 'SYP'),
        lines: [money('655000', 'SYP'), money('654000', 'SYP')],
      }),
    );

    expect(refusal.code).toBe('fx.lines-do-not-total');
    expect(refusal.values).toEqual({ total: '1310000', lines: '1309000', currency: 'SYP' });
  });

  it('refuses a document in a currency the stamp was not taken for', async () => {
    const stamp = await stampFor('SYP');

    expect(
      refused(
        await fx.rounding.value(fx.by, {
          stamp,
          total: money('100', 'EUR'),
          lines: [money('100', 'EUR')],
        }),
      ).code,
    ).toBe('fx.stamp-currency-mismatch');
  });

  it('does not require the document to be settled first, because they are two points', async () => {
    const stamp = await stampFor('SYP');

    // 13,127 pounds is not a whole number of ten-pound notes, and it is a
    // perfectly good invoice total: it settles at the till, which is the other
    // point. A rule that ran both points at once would settle figures nobody
    // was handing over, and `FX-07` says the points are defined ones.
    const valued = taken(
      await fx.rounding.value(fx.by, {
        stamp,
        total: money('13127', 'SYP'),
        lines: [money('13127', 'SYP')],
      }),
    );

    // 13,127 ÷ 13,100, at the four places the books keep.
    expect(shown(valued.total)).toBe('1.0021 USD');
  });
});

describe('Presentation currency switching — FX-03', () => {
  it('shows a figure in any enabled currency, at a stated rate, with the rate shown', async () => {
    const presented = taken(
      await fx.presentation.present(fx.by, aleppo, money('100', 'USD'), 'SYP'),
    );

    expect(shown(presented.amount)).toBe('1300000 SYP');
    expect(presented.rate).toMatchObject({
      currency: 'SYP',
      functional: 'USD',
      // The exact middle of the day's two rates, and said to be the middle: a
      // figure on a screen is neither being received nor paid out, and
      // presenting it at either side would show a profit that is not there.
      basis: 'mid',
      rate: '13000',
      day: '2026-09-17',
      lastKnown: null,
    });
  });

  it('takes the mid to the last place a rate is kept, from a board that does not halve evenly', async () => {
    const presented = taken(
      await fx.presentation.present(fx.by, aleppo, money('100', 'USD'), 'EUR'),
    );

    // (0.934579439252 + 0.917431192661) / 2 is 0.9260053159565, and the half it
    // cannot keep falls exactly between two twelfth places. Half to even, so it
    // stays on the six: a mid is nobody's amount, and a rule that leaned would
    // lean the same way on every currency in the shop, every day.
    expect(presented.rate?.rate).toBe('0.926005315956');
  });

  it('shows a figure of any currency in the books’ own currency', async () => {
    const presented = taken(
      await fx.presentation.present(fx.by, aleppo, money('1300000', 'SYP'), 'USD'),
    );

    expect(shown(presented.amount)).toBe('100 USD');
    expect(presented.rate).toMatchObject({ basis: 'mid', rate: '13000' });
  });

  it('presents to the precision the currency is stored at, not to the note it settles to', async () => {
    // A report total in pounds is not money anybody is handing over, so it is
    // not moved onto the ten-pound note: doing that would misstate the report
    // by up to five pounds a line. `design-system.md` §12 says the same thing
    // from the other end — `<Money>` never exceeds the stored precision.
    const presented = taken(await fx.presentation.present(fx.by, aleppo, money('1', 'USD'), 'SYP'));

    expect(shown(presented.amount)).toBe('13000 SYP');
    const awkward = taken(
      await fx.presentation.present(fx.by, aleppo, money('0.0001', 'USD'), 'SYP'),
    );
    expect(shown(awkward.amount)).toBe('1.3 SYP');
  });

  it('answers a figure already in the currency asked for, with no rate to state', async () => {
    const presented = taken(
      await fx.presentation.present(fx.by, aleppo, money('100', 'USD'), 'USD'),
    );

    // Nothing was converted, so there is no rate to show — which is what lets a
    // screen loop over every enabled currency without a case of its own.
    expect(shown(presented.amount)).toBe('100 USD');
    expect(presented.rate).toBeNull();
  });

  it('presents a document at its own stamped rate, and never at today’s', async () => {
    const stamp = await stampFor('SYP');
    // The day's rate is corrected after the document was issued.
    taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
        form: 'units-per-functional',
        buy: '26000',
        sell: '25000',
      }),
    );

    const presented = taken(
      await fx.presentation.presentStamped(fx.by, money('1310000', 'SYP'), 'USD', stamp),
    );

    // 13,100 — the rate the document was priced at — not today's 25,500 mid.
    expect(shown(presented.amount)).toBe('100 USD');
    expect(presented.rate).toMatchObject({ basis: 'stamped', rate: '13100', side: 'buy' });
  });

  it('refuses to show a document in a currency the shop no longer takes', async () => {
    const stamp = await stampFor('SYP');
    taken(await fx.admin.disable(fx.by, 'SYP'));

    // The document stays readable in the currency it was written in — last
    // year's invoices are still in pounds — but nothing offers to restate a
    // figure *into* a currency the shop has stopped taking, because nobody is
    // reading a total in one.
    expect(
      taken(await fx.presentation.presentStamped(fx.by, money('1310000', 'SYP'), 'USD', stamp))
        .amount.currency,
    ).toBe('USD');
    expect(
      refused(await fx.presentation.presentStamped(fx.by, money('100', 'USD'), 'SYP', stamp)).code,
    ).toBe('fx.currency-disabled');
  });

  it('refuses a document shown at a stamp that was taken for another currency', async () => {
    const stamp = await stampFor('SYP');

    expect(
      refused(await fx.presentation.presentStamped(fx.by, money('100', 'EUR'), 'USD', stamp)).code,
    ).toBe('fx.stamp-currency-mismatch');
  });

  it('shows a document the day its rate is from, which is not always the day it was issued', async () => {
    // A till that could not reach the store node issued this on the eighteenth
    // at the seventeenth's rate. A screen showing the document has to say the
    // seventeenth — `FX-04` puts that date on every currency-sensitive screen,
    // and the document's own date is the one thing that would not say it.
    const homs = fx.openBranch();
    const till = fx.openRegister(homs);
    taken(await fx.rateAdmin.record(fx.by, homs, 'SYP', POUNDS));
    taken(await fx.rateAdmin.record(fx.by, homs, 'EUR', EUROS));
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, DAY));
    const at = fx.at(till.device);
    const confirmation = taken(await fx.rateAdmin.confirmLastKnown(at, homs));
    const prepared = taken(
      await fx.stamps.prepare(at, { branch: homs, currency: 'SYP', direction: 'received' }),
    );
    const stamp = await fx.asCaller(at, (session) => fx.stamps.stamp(at, session, prepared));
    expect(stamp.day).toBe('2026-09-18');

    const presented = taken(
      await fx.presentation.presentStamped(at, money('1310000', 'SYP'), 'USD', stamp),
    );

    expect(shown(presented.amount)).toBe('100 USD');
    expect(presented.rate).toMatchObject({
      basis: 'stamped',
      rate: '13100',
      day: '2026-09-17',
      lastKnown: confirmation.id,
    });
  });

  it('refuses a stamp whose rate is per a unit of some other currency', async () => {
    const stamp = await stampFor('SYP');

    // The rate on a stamp means "so many pounds per one unit of *this*", and
    // which currency that is, is on the stamp. Converting it against a different
    // one would be arithmetic in units the figure beside it does not name — and
    // the rate shown would be a true sentence about a number nobody computed.
    const stale = { ...stamp, functional: 'EUR' };

    expect(
      refused(await fx.presentation.presentStamped(fx.by, money('1310000', 'SYP'), 'USD', stale))
        .code,
    ).toBe('fx.stamp-functional-mismatch');
  });

  it('refuses to present a figure between two currencies that are neither of them the books’', async () => {
    // `FX-03` asks for a figure shown "at a stated rate with the rate shown",
    // and there is no single stated rate between the pound and the euro: there
    // are two, through the dollar. Moving value between them is `FX-09`'s, and
    // it is a first-class operation rather than a display.
    const refusal = refused(
      await fx.presentation.present(fx.by, aleppo, money('1000', 'SYP'), 'EUR'),
    );

    expect(refusal.code).toBe('fx.cross-rate-unsupported');
    expect(refusal.values).toEqual({ from: 'SYP', into: 'EUR', functional: 'USD' });
  });

  it('refuses a currency the shop no longer takes, and one it never did', async () => {
    taken(await fx.admin.disable(fx.by, 'TRY'));

    expect(
      refused(await fx.presentation.present(fx.by, aleppo, money('100', 'USD'), 'TRY')).code,
    ).toBe('fx.currency-disabled');
    expect(
      refused(await fx.presentation.present(fx.by, aleppo, money('100', 'USD'), 'GBP')).code,
    ).toBe('fx.currency-not-found');
  });

  it('refuses rather than presenting at yesterday’s rate when today has none', async () => {
    const homs = fx.openBranch();

    expect(
      refused(await fx.presentation.present(fx.by, homs, money('100', 'USD'), 'SYP')).code,
    ).toBe('fx.rate-missing');
  });

  it('marks a presentation made under a last-known rate, as every currency-sensitive screen must', async () => {
    const homs = fx.openBranch();
    const till = fx.openRegister(homs);
    taken(await fx.rateAdmin.record(fx.by, homs, 'SYP', POUNDS));
    taken(await fx.rateAdmin.record(fx.by, homs, 'EUR', EUROS));
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, DAY));
    const at = fx.at(till.device);
    const confirmation = taken(await fx.rateAdmin.confirmLastKnown(at, homs));

    const presented = taken(await fx.presentation.present(at, homs, money('100', 'USD'), 'SYP'));

    // `FX-04` has the rate's date shown on every currency-sensitive screen, and
    // a figure converted for display is one.
    expect(presented.rate).toMatchObject({
      basis: 'mid',
      rate: '13000',
      day: '2026-09-17',
      lastKnown: confirmation.id,
    });
  });
});

describe('A stamp belongs to the tenant whose command is holding it — FX-05', () => {
  it('raises rather than valuing one tenant’s document at another tenant’s stamp', async () => {
    const stamp = await stampFor('SYP');
    // A stamp is not read back out of the store when a document is valued: a
    // caller building a document holds one that is not committed yet, which is
    // the whole point of `prepare` and `stamp` being apart. So what can be
    // checked about it is checked, and the tenant is the one that matters.
    const theirs = { ...stamp, tenant: fx.otherTenant };

    await expect(
      fx.rounding.value(fx.by, {
        stamp: theirs,
        total: money('1310000', 'SYP'),
        lines: [money('1310000', 'SYP')],
      }),
    ).rejects.toThrow(/tenant/i);

    await expect(
      fx.presentation.presentStamped(fx.by, money('1310000', 'SYP'), 'USD', theirs),
    ).rejects.toThrow(/tenant/i);
  });

  it('raises the same way the stamp was written, so there is one rule and not three', async () => {
    const prepared = taken(
      await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'SYP', direction: 'received' }),
    );

    await expect(
      fx.asCaller(fx.byOther, (session) => fx.stamps.stamp(fx.byOther, session, prepared)),
    ).rejects.toThrow(/tenant/i);
  });
});
