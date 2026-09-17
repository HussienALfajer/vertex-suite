import type { BranchId } from '@vertex/contracts';
import { Dec, isOk, plusMillis, type LocalDate, type Refusal, type Result } from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FX_PERMISSIONS,
  type CashDirection,
  type PreparedStamp,
  type RateQuote,
  type RateStamp,
  type Stamping,
} from './contract.js';
import { DAY, installFx, NOON_IN_DAMASCUS, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code}`);
}

function refused<T>(result: Result<T, Refusal>): Refusal {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error;
}

function present<T>(value: T | null): T {
  if (value === null) throw new Error('Expected a record; the store had none.');
  return value;
}

function day(value: string): LocalDate {
  return value as LocalDate;
}

/** Pounds to the dollar: the shop receives at 13,100 and pays out at 12,900. */
const POUNDS: RateQuote = { form: 'units-per-functional', buy: '13100', sell: '12900' };

/** Dollars to the euro, the way the market quotes a stronger currency. */
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

/** What a document's own module does: prepare the stamp, then write it with the document. */
async function stampOf(
  currency: string,
  direction: CashDirection,
  more: Partial<Stamping> = {},
): Promise<RateStamp> {
  const prepared = taken(
    await fx.stamps.prepare(fx.by, { branch: aleppo, currency, direction, ...more }),
  );
  return fx.asCaller(fx.by, (session) => fx.stamps.stamp(fx.by, session, prepared));
}

/**
 * A report, played by the test.
 *
 * It reads each document's stamp and states what the document was worth in the
 * functional currency. `FX-05`'s acceptance criterion is a claim about exactly
 * this number, and the only thing that decides it is the rate the stamp carries.
 */
function report(lines: readonly { readonly amount: string; readonly stamp: RateStamp }[]) {
  return lines.map(({ amount, stamp }) => new Dec(amount).dividedBy(stamp.rate).toFixed(4));
}

describe('Rate history and stamping — FX-05', () => {
  it('stores the rate a transaction used on the transaction, copied and not pointed at', async () => {
    const revision = taken(await fx.rates.current(fx.by, aleppo, 'SYP')).revision;

    const stamp = await stampOf('SYP', 'received');

    expect(stamp).toMatchObject({
      tenant: fx.tenant,
      branch: aleppo,
      currency: 'SYP',
      functional: 'USD',
      day: '2026-09-17',
      direction: 'received',
      side: 'buy',
      // The figure itself, on the stamp. A stamp that only named the revision
      // would be a stamp that reads whatever the revision reads today, which is
      // the thing this feature exists to prevent.
      rate: '13100',
      revision: revision.id,
      rateDay: '2026-09-17',
      override: null,
      lastKnown: null,
      stampedBy: fx.by.actor,
      stampedAt: NOON_IN_DAMASCUS,
    });
    expect(present(await fx.stamps.stamped(fx.by, stamp.id))).toEqual(stamp);
  });

  it('writes the stamp inside the transaction the caller is already in, and rolls back with it', async () => {
    const prepared = taken(
      await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'SYP', direction: 'received' }),
    );

    // The caller's command fails after stamping — a credit limit reached, a
    // till already closed, anything. A stamp that had committed on its own would
    // outlive the document it was taken for.
    await expect(
      fx.asCaller(fx.by, (session) => {
        fx.stamps.stamp(fx.by, session, prepared);
        throw new Error('the caller’s command failed after it stamped');
      }),
    ).rejects.toThrow('the caller’s command failed after it stamped');

    expect(await fx.stamps.stamped(fx.by, prepared.stamp.id)).toBeNull();
  });

  it('commits the stamp with the caller’s own writes, in one transaction and not two', async () => {
    const prepared = taken(
      await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'SYP', direction: 'paid-out' }),
    );
    const committedBefore = fx.store.committed().size;

    const stamp = await fx.asCaller(fx.by, (session) => {
      // Whatever the caller came to write. The point is that it and the stamp
      // land together: a document naming a stamp that is not there, or a stamp
      // for a document that is not there, are both unreadable a year later.
      session.put('sal/invoice/1', { stamp: prepared.stamp.id });
      return fx.stamps.stamp(fx.by, session, prepared);
    });

    expect(fx.store.committed().size).toBe(committedBefore + 2);
    expect(present(await fx.stamps.stamped(fx.by, stamp.id)).rate).toBe('12900');
  });

  it('returns identical numbers when a historical report is re-run, whatever today’s rate is', async () => {
    // Three documents of the seventeenth — one of them issued after the day's
    // rate was corrected, which is `FX-04`'s mistyped rate being put right.
    const received = await stampOf('SYP', 'received');
    const paidOut = await stampOf('SYP', 'paid-out');
    taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
        form: 'units-per-functional',
        buy: '13400',
        sell: '13200',
      }),
    );
    const afterTheCorrection = await stampOf('SYP', 'received');

    const lines = [
      { amount: '1310000', stamp: received },
      { amount: '645000', stamp: paidOut },
      { amount: '1340000', stamp: afterTheCorrection },
    ];
    const asIssued = report(lines);
    expect(asIssued).toEqual(['100.0000', '50.0000', '100.0000']);

    // Two days pass and the pound halves against the dollar.
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, DAY));
    taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
        form: 'units-per-functional',
        buy: '20000',
        sell: '19500',
      }),
    );
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, 2 * DAY));
    taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
        form: 'units-per-functional',
        buy: '26000',
        sell: '25000',
      }),
    );

    // Read back out of the store rather than from the objects held above, so
    // this is the report a year later reading what a year later has.
    const reread = await Promise.all(
      lines.map(async (line) => ({
        amount: line.amount,
        stamp: present(await fx.stamps.stamped(fx.by, line.stamp.id)),
      })),
    );
    expect(report(reread)).toEqual(asIssued);
  });

  it('keeps the revision a stamp names readable after the day’s rate is corrected', async () => {
    const stamp = await stampOf('SYP', 'received');

    taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
        form: 'units-per-functional',
        buy: '13400',
        sell: '13200',
      }),
    );

    // The rate in force moved on; the one this document used did not, and is
    // still there to be shown beside it.
    expect(taken(await fx.rates.current(fx.by, aleppo, 'SYP')).revision.buy).toBe('13400');
    const revisions = await fx.rates.revisions(fx.by, aleppo, 'SYP', day('2026-09-17'));
    expect(revisions.find((one) => one.id === stamp.revision)?.buy).toBe('13100');
  });

  it('carries the rate’s own day when a register is trading on a last-known rate', async () => {
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

    // The day traded is the eighteenth and the rate is the seventeenth's. Both
    // are on the stamp, because `FX-04` has sync flag this document for review
    // and a document that did not say would have to be guessed at.
    expect(stamp).toMatchObject({
      day: '2026-09-18',
      rateDay: '2026-09-17',
      rate: '13100',
      lastKnown: confirmation.id,
    });
  });

  it('refuses to stamp what has no rate, rather than stamping yesterday’s', async () => {
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, DAY));

    const refusal = refused(
      await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'SYP', direction: 'received' }),
    );

    expect(refusal.code).toBe('fx.rate-missing');
    expect(refusal.values).toEqual({ branch: aleppo, currency: 'SYP', day: '2026-09-18' });
  });

  it('refuses the functional currency, a branch it cannot find, and one out of use', async () => {
    expect(
      refused(
        await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'USD', direction: 'received' }),
      ).code,
    ).toBe('fx.currency-is-functional');

    const elsewhere = fx.openBranch({ tenant: fx.otherTenant });
    expect(
      refused(
        await fx.stamps.prepare(fx.by, {
          branch: elsewhere,
          currency: 'SYP',
          direction: 'received',
        }),
      ).code,
    ).toBe('fx.branch-not-found');

    fx.shutBranch(aleppo);
    expect(
      refused(
        await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'SYP', direction: 'received' }),
      ).code,
    ).toBe('fx.branch-inactive');
  });

  it('writes nothing at all until the caller stamps', async () => {
    const before = new Map(fx.store.committed());

    taken(
      await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'SYP', direction: 'received' }),
    );

    // Preparing is a read. A document that is abandoned half-written leaves no
    // stamp behind, because the stamp was never anywhere but in the caller's
    // own transaction.
    expect(fx.store.committed()).toEqual(before);
  });
});

describe('Correct rate selection — FX-06', () => {
  it('applies the buy rate on receipt and the sell rate on disbursement, with nobody choosing', async () => {
    const received = await stampOf('SYP', 'received');
    const paidOut = await stampOf('SYP', 'paid-out');

    expect([received.side, received.rate]).toEqual(['buy', '13100']);
    expect([paidOut.side, paidOut.rate]).toEqual(['sell', '12900']);
  });

  it('applies it in the currency’s own terms, whichever form the board was typed in', async () => {
    // The euro board was typed as dollars to the euro. Which side is which does
    // not turn on how it was written down.
    const received = await stampOf('EUR', 'received');
    const paidOut = await stampOf('EUR', 'paid-out');

    expect([received.side, received.rate]).toEqual(['buy', '0.934579439252']);
    expect([paidOut.side, paidOut.rate]).toEqual(['sell', '0.917431192661']);
  });

  it('shows the rate it is about to apply before the caller has written anything', async () => {
    const prepared = taken(
      await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'SYP', direction: 'received' }),
    );

    // "The applied rate is always visible": visible to the screen that is about
    // to commit, not only to a reader of what was committed.
    expect(prepared.stamp).toMatchObject({ side: 'buy', rate: '13100', rateDay: '2026-09-17' });
    expect(prepared.override).toBeNull();
  });

  it('refuses an override to somebody without the right, and applies nothing in its place', async () => {
    const before = new Map(fx.store.committed());
    let asked: { right: string; where?: unknown } | null = null;
    fx.answers((_by, right, where) => {
      if (right !== FX_PERMISSIONS.rate.override) return true;
      asked = { right, where };
      return false;
    });

    const refusal = refused(
      await fx.stamps.prepare(fx.by, {
        branch: aleppo,
        currency: 'SYP',
        direction: 'received',
        override: { form: 'units-per-functional', rate: '13050', reason: 'سعر الصراف' },
      }),
    );

    expect(refusal.code).toBe('fx.not-permitted');
    expect(refusal.values).toEqual({ right: FX_PERMISSIONS.rate.override });
    expect(asked).toEqual({ right: FX_PERMISSIONS.rate.override, where: { branch: aleppo } });
    // Not quietly stamped at the board's rate instead: somebody who asked for
    // one rate and got another would not know to look.
    expect(fx.store.committed()).toEqual(before);
  });

  it('applies an override, and logs it beside the stamp with both figures', async () => {
    const revision = taken(await fx.rates.current(fx.by, aleppo, 'SYP')).revision;

    const stamp = await stampOf('SYP', 'received', {
      override: { form: 'units-per-functional', rate: '13050', reason: 'سعر الصراف في السوق' },
    });

    expect(stamp).toMatchObject({ side: 'buy', rate: '13050', revision: revision.id });

    const logged = await fx.stamps.overrides(fx.by, aleppo, day('2026-09-17'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      tenant: fx.tenant,
      stamp: stamp.id,
      branch: aleppo,
      currency: 'SYP',
      day: '2026-09-17',
      side: 'buy',
      // Both figures, because an override that only recorded what was applied
      // would not say what was refused, and that is the whole of the review.
      automatic: '13100',
      applied: '13050',
      quoted: { form: 'units-per-functional', rate: '13050' },
      reason: 'سعر الصراف في السوق',
      revision: revision.id,
      by: fx.by.actor,
      at: NOON_IN_DAMASCUS,
    });
    expect(stamp.override).toBe(logged[0]?.id);
  });

  it('logs nothing when nobody overrode anything', async () => {
    await stampOf('SYP', 'received');

    expect(await fx.stamps.overrides(fx.by, aleppo, day('2026-09-17'))).toEqual([]);
  });

  it('takes an override in the form the market quotes, and records it both ways', async () => {
    const stamp = await stampOf('EUR', 'received', {
      override: { form: 'functional-per-unit', rate: '1.05', reason: 'اتفاق مع الزبون' },
    });

    // 1.05 dollars to the euro, received: 0.952380952381 euros to the dollar.
    expect(stamp.rate).toBe('0.952380952381');
    const logged = await fx.stamps.overrides(fx.by, aleppo, day('2026-09-17'));
    expect(logged[0]).toMatchObject({
      applied: '0.952380952381',
      quoted: { form: 'functional-per-unit', rate: '1.05' },
    });
  });

  it('refuses an override with nothing written in the reason', async () => {
    for (const reason of ['', '   ', '...', '—']) {
      const refusal = refused(
        await fx.stamps.prepare(fx.by, {
          branch: aleppo,
          currency: 'SYP',
          direction: 'received',
          override: { form: 'units-per-functional', rate: '13050', reason },
        }),
      );
      expect(refusal.code, JSON.stringify(reason)).toBe('fx.override-reason-required');
    }
  });

  it('refuses an override that crosses the day’s other side, which every exchange would lose on', async () => {
    // Receiving pounds at fewer to the dollar than the shop pays them out at.
    const receiving = refused(
      await fx.stamps.prepare(fx.by, {
        branch: aleppo,
        currency: 'SYP',
        direction: 'received',
        override: { form: 'units-per-functional', rate: '12800', reason: 'خطأ' },
      }),
    );
    expect(receiving.code).toBe('fx.override-crosses-spread');
    expect(receiving.values).toEqual({ side: 'buy', applied: '12800', against: '12900' });

    // And paying them out at more to the dollar than it receives them at.
    const paying = refused(
      await fx.stamps.prepare(fx.by, {
        branch: aleppo,
        currency: 'SYP',
        direction: 'paid-out',
        override: { form: 'units-per-functional', rate: '13200', reason: 'خطأ' },
      }),
    );
    expect(paying.code).toBe('fx.override-crosses-spread');
    expect(paying.values).toEqual({ side: 'sell', applied: '13200', against: '13100' });
  });

  it('allows an override that meets the other side exactly, as an entered rate may', async () => {
    // `settleQuote` allows a board with no spread at all, and an override is
    // held to the rule it is held to, not to a stricter one.
    expect(
      (
        await stampOf('SYP', 'received', {
          override: { form: 'units-per-functional', rate: '12900', reason: 'بلا هامش' },
        })
      ).rate,
    ).toBe('12900');
  });

  it('refuses an override that is not a rate at all', async () => {
    for (const rate of ['0', '-13000', 'thirteen', '13000.0000000000001']) {
      const refusal = refused(
        await fx.stamps.prepare(fx.by, {
          branch: aleppo,
          currency: 'SYP',
          direction: 'received',
          override: { form: 'units-per-functional', rate, reason: 'سبب' },
        }),
      );
      expect(['fx.rate-invalid', 'fx.rate-too-precise'], rate).toContain(refusal.code);
    }
  });

  it('refuses an override where there is no rate to override', async () => {
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, DAY));

    // An override replaces the rate that would have applied. Where none would
    // have, there is nothing to replace and no spread to judge it against —
    // and `FX-04` blocks the operation rather than inventing a rate for it.
    expect(
      refused(
        await fx.stamps.prepare(fx.by, {
          branch: aleppo,
          currency: 'SYP',
          direction: 'received',
          override: { form: 'units-per-functional', rate: '13050', reason: 'سبب' },
        }),
      ).code,
    ).toBe('fx.rate-missing');
  });

  it('marks the right to override sensitive, and seeds it to the manager alone', () => {
    const declared = new Map(fx.registry.permissions.map((one) => [one.id, one]));

    expect(FX_PERMISSIONS.rate.override).toBe('fx.rate.override');
    expect(declared.get(FX_PERMISSIONS.rate.override)).toMatchObject({
      seededFor: ['manager'],
      // `SEC-05` re-authorises before it proceeds. A rate typed over the board's
      // at a till is the one figure on the document nobody else checked.
      sensitive: true,
    });
    // The floor supervisor confirms the board's own last-known rate and does
    // not invent one, so this is not theirs the way that one is.
    expect(declared.get(FX_PERMISSIONS.lastKnownRate.confirm)?.seededFor).toContain(
      'floor-supervisor',
    );
  });

  it('asks nothing of a caller who is not overriding, because stamping is a read', async () => {
    // A cashier stamps the rate of every sale they ring up. Whether they may
    // open the rates screen has nothing to do with it — the same reason the
    // rest of this module's reads are unguarded.
    fx.answers(() => false);

    expect((await stampOf('SYP', 'received')).rate).toBe('13100');
  });

  it('stamps under the tenant of the caller and nowhere else', async () => {
    const prepared: PreparedStamp = taken(
      await fx.stamps.prepare(fx.by, { branch: aleppo, currency: 'SYP', direction: 'received' }),
    );

    await expect(
      fx.asCaller(fx.byOther, (session) => fx.stamps.stamp(fx.byOther, session, prepared)),
    ).rejects.toThrow(/tenant/i);
  });
});
