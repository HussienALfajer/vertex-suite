import type { BranchId } from '@vertex/contracts';
import {
  isOk,
  localDateOf,
  plusMillis,
  type LocalDate,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import { FX_PERMISSIONS, type RateQuote } from './contract.js';
import { DAY, installFx, NOON_IN_DAMASCUS, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code}`);
}

function refused<T>(result: Result<T, Refusal>): Refusal {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error;
}

function day(value: string): LocalDate {
  return value as LocalDate;
}

/** Pounds to the dollar, the way the market quotes a weaker currency. */
const POUNDS: RateQuote = { form: 'units-per-functional', buy: '13100', sell: '12900' };

/**
 * Dollars to the euro, the way it quotes a stronger one: the shop receives euros
 * at 1.07 dollars each and pays them out at 1.09.
 */
const EUROS: RateQuote = { form: 'functional-per-unit', buy: '1.07', sell: '1.09' };

const LIRA: RateQuote = { form: 'units-per-functional', buy: '41.5', sell: '41.2' };

let fx: Installed;
let aleppo: BranchId;

beforeEach(async () => {
  fx = installFx();
  taken(await fx.admin.seed(fx.system));
  aleppo = fx.openBranch();
});

describe('Daily rates — FX-04', () => {
  it('records a buy and a sell rate for a currency, at one branch, for its today', async () => {
    const revision = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    expect(revision).toMatchObject({
      tenant: fx.tenant,
      branch: aleppo,
      currency: 'SYP',
      functional: 'USD',
      day: '2026-09-17',
      sequence: 1,
      buy: '13100',
      sell: '12900',
      quoted: POUNDS,
      supersedes: null,
      adoptedFrom: null,
      recordedBy: fx.by.actor,
      recordedAt: NOON_IN_DAMASCUS,
    });
    expect(taken(await fx.rates.current(fx.by, aleppo, 'SYP'))).toEqual({
      revision,
      lastKnown: null,
    });
  });

  it('expresses every rate as units of the currency per one unit of the functional currency', async () => {
    // The euro is typed the way the market quotes it — dollars to the euro — and
    // recorded the one way every rate is read: euros to the dollar.
    const euro = taken(await fx.rateAdmin.record(fx.by, aleppo, 'EUR', EUROS));

    expect(euro.buy).toBe('0.934579439252');
    expect(euro.sell).toBe('0.917431192661');
    // What was typed is kept beside it, because nobody typed 0.934579439252.
    expect(euro.quoted).toEqual(EUROS);
  });

  it('keeps a rate to twelve places and never more, the same on every machine', async () => {
    const lira = taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'TRY', {
        form: 'functional-per-unit',
        buy: '0.03',
        sell: '0.03',
      }),
    );

    // One third of a hundred, to twelve places, rounded once when it was typed
    // and stored as that — never recomputed where it is read.
    expect(lira.buy).toBe('33.333333333333');
    expect(lira.sell).toBe('33.333333333333');
  });

  it('counts today in the branch’s own time zone, so one moment is two days in two branches', async () => {
    const london = fx.openBranch({ timeZone: 'UTC' });
    // 22:00 UTC is one in the morning of the eighteenth in Damascus.
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, 13 * 3_600_000));

    const inAleppo = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    const inLondon = taken(await fx.rateAdmin.record(fx.by, london, 'SYP', POUNDS));

    expect(inAleppo.day).toBe('2026-09-18');
    expect(inLondon.day).toBe('2026-09-17');
    expect(taken(await fx.rates.board(fx.by, aleppo)).day).toBe('2026-09-18');
  });

  it('keeps each branch’s rates its own', async () => {
    const homs = fx.openBranch();
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    expect(refused(await fx.rates.current(fx.by, homs, 'SYP')).code).toBe('fx.rate-missing');
  });

  it('corrects a mistyped rate with a new revision the same day, and keeps the one it replaced', async () => {
    const mistyped = taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', { ...POUNDS, buy: '1310', sell: '1290' }),
    );
    fx.clock.advance(60_000);

    const corrected = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    expect(corrected).toMatchObject({ sequence: 2, supersedes: mistyped.id, buy: '13100' });
    expect(taken(await fx.rates.current(fx.by, aleppo, 'SYP')).revision).toEqual(corrected);
    // Nothing rewrote the first: a document stamped with it still reads what it was
    // stamped with (FX-05).
    expect(await fx.rates.revisions(fx.by, aleppo, 'SYP', day('2026-09-17'))).toEqual([
      mistyped,
      corrected,
    ]);
  });

  it('files a rate under the day it was recorded, and a new day starts with no rate at all', async () => {
    // 23:59 in Damascus.
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, 11 * 3_600_000 + 59 * 60_000));
    const lastOfTheDay = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    fx.clock.advance(2 * 60_000);

    const missing = refused(await fx.rates.current(fx.by, aleppo, 'SYP'));
    const firstOfTheNext = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    expect(lastOfTheDay.day).toBe('2026-09-17');
    expect(missing.values['day']).toBe('2026-09-18');
    expect(firstOfTheNext).toMatchObject({ day: '2026-09-18', sequence: 1, supersedes: null });
    expect(await fx.rates.revisions(fx.by, aleppo, 'SYP', day('2026-09-17'))).toEqual([
      lastOfTheDay,
    ]);
  });

  it('refuses a missing rate for today with what is missing, rather than reusing yesterday’s', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    fx.clock.advance(DAY);

    const missing = refused(await fx.rates.current(fx.by, aleppo, 'SYP'));

    expect(missing.code).toBe('fx.rate-missing');
    expect(missing.values).toEqual({ branch: aleppo, currency: 'SYP', day: '2026-09-18' });
    const board = taken(await fx.rates.board(fx.by, aleppo));
    expect(board.lines.find((line) => line.currency.code === 'SYP')?.revision).toBeNull();
  });

  it('refuses a receiving rate below the paying one, whichever form it was typed in', async () => {
    // The board of an exchange office read as the pound's own: the dollar's buy
    // typed where the pound's belongs. Every exchange at these rates would lose.
    const backwards = refused(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', { ...POUNDS, buy: '12900', sell: '13100' }),
    );
    expect(backwards.code).toBe('fx.rate-spread-inverted');
    expect(backwards.values).toEqual({ buy: '12900', sell: '13100' });

    // The euro inverts on the way in, so its typed figures run the other way.
    expect(
      refused(
        await fx.rateAdmin.record(fx.by, aleppo, 'EUR', { ...EUROS, buy: '1.09', sell: '1.07' }),
      ).code,
    ).toBe('fx.rate-spread-inverted');

    // A shop that takes no spread at all is making no mistake.
    expect(
      taken(
        await fx.rateAdmin.record(fx.by, aleppo, 'SYP', {
          ...POUNDS,
          buy: '13000',
          sell: '13000',
        }),
      ).sell,
    ).toBe('13000');
  });

  it('refuses a rate that is not a positive exact decimal, whatever it arrived as', async () => {
    const figures: readonly unknown[] = ['0', '-13100', '13,100', ' 13100', '1.31e4', '', 13100];
    for (const buy of figures) {
      const quote = { ...POUNDS, buy } as RateQuote;
      expect(
        refused(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', quote)).code,
        JSON.stringify(buy),
      ).toBe('fx.rate-invalid');
    }
  });

  it('refuses a rate finer than twelve places, or too large to be carried inverted', async () => {
    const fine = refused(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', { ...POUNDS, sell: '12900.0000000000001' }),
    );
    expect(fine.code).toBe('fx.rate-too-precise');
    expect(fine.values).toEqual({ side: 'sell', rate: '12900.0000000000001', decimals: 12 });

    // One over ten trillion is nothing at twelve places: a rate of zero.
    expect(
      refused(
        await fx.rateAdmin.record(fx.by, aleppo, 'EUR', {
          form: 'functional-per-unit',
          buy: '10000000000000',
          sell: '10000000000000',
        }),
      ).code,
    ).toBe('fx.rate-invalid');
  });

  it('refuses a form of quote it does not know', async () => {
    const quote = { ...POUNDS, form: 'pounds-per-dollar' } as unknown as RateQuote;

    expect(refused(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', quote)).code).toBe(
      'fx.rate-form-unknown',
    );
  });

  it('refuses a rate for the functional currency, for one the shop does not take, and for one it lacks', async () => {
    taken(await fx.admin.disable(fx.by, 'TRY'));

    expect(refused(await fx.rateAdmin.record(fx.by, aleppo, 'USD', POUNDS)).code).toBe(
      'fx.currency-is-functional',
    );
    expect(refused(await fx.rateAdmin.record(fx.by, aleppo, 'TRY', LIRA)).code).toBe(
      'fx.currency-disabled',
    );
    expect(refused(await fx.rateAdmin.record(fx.by, aleppo, 'GBP', POUNDS)).code).toBe(
      'fx.currency-not-found',
    );
    expect(refused(await fx.rates.current(fx.by, aleppo, 'USD')).code).toBe(
      'fx.currency-is-functional',
    );
  });

  it('refuses a rate for a tenant whose currencies were never set up', async () => {
    const theirs = fx.openBranch({ tenant: fx.otherTenant });

    expect(refused(await fx.rateAdmin.record(fx.byOther, theirs, 'SYP', POUNDS)).code).toBe(
      'fx.functional-currency-unset',
    );
  });

  it('refuses a branch it cannot find, and one taken out of use', async () => {
    const homs = fx.openBranch();
    fx.shutBranch(homs);

    expect(refused(await fx.rateAdmin.record(fx.by, homs, 'SYP', POUNDS)).code).toBe(
      'fx.branch-inactive',
    );
    const elsewhere = fx.openBranch({ tenant: fx.otherTenant });
    expect(refused(await fx.rateAdmin.record(fx.by, elsewhere, 'SYP', POUNDS)).code).toBe(
      'fx.branch-not-found',
    );
  });

  it('writes nothing when a command refuses', async () => {
    const before = new Map(fx.store.committed());

    refused(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', { ...POUNDS, buy: '0' }));
    refused(await fx.rateAdmin.record(fx.by, aleppo, 'USD', POUNDS));
    refused(await fx.rateAdmin.adopt(fx.by, aleppo));

    expect(fx.store.committed()).toEqual(before);
  });

  it('shows a branch its board for today, one line per currency it takes other than the functional one', async () => {
    const euro = taken(await fx.rateAdmin.record(fx.by, aleppo, 'EUR', EUROS));

    const board = taken(await fx.rates.board(fx.by, aleppo));

    expect(board).toMatchObject({ branch: aleppo, day: '2026-09-17' });
    expect(board.functional.code).toBe('USD');
    expect(board.lines.map((line) => line.currency.code)).toEqual(['EUR', 'SYP', 'TRY']);
    expect(board.lines.map((line) => line.revision)).toEqual([euro, null, null]);
  });
});

describe('Suggested rates, adopted as a branch’s own — FX-04', () => {
  it('adopts the tenant’s suggested rates as the branch’s own, every currency in one action', async () => {
    const pounds = taken(await fx.rateAdmin.suggest(fx.by, 'SYP', POUNDS));
    const euros = taken(await fx.rateAdmin.suggest(fx.by, 'EUR', EUROS));
    expect(pounds).toMatchObject({
      currency: 'SYP',
      functional: 'USD',
      buy: '13100',
      sell: '12900',
    });

    const board = taken(await fx.rates.board(fx.by, aleppo));
    expect(board.lines.map((line) => line.suggestion?.id ?? null)).toEqual([
      euros.id,
      pounds.id,
      null,
    ]);

    const adopted = taken(await fx.rateAdmin.adopt(fx.by, aleppo));

    expect(adopted.map((one) => [one.currency, one.adoptedFrom])).toEqual([
      ['EUR', euros.id],
      ['SYP', pounds.id],
    ]);
    expect(taken(await fx.rates.current(fx.by, aleppo, 'EUR')).revision).toMatchObject({
      buy: euros.buy,
      sell: euros.sell,
      quoted: EUROS,
      day: '2026-09-17',
      branch: aleppo,
    });
  });

  it('keeps an adopted rate as it was when the suggestion is revised afterwards', async () => {
    taken(await fx.rateAdmin.suggest(fx.by, 'SYP', POUNDS));
    const [adopted] = taken(await fx.rateAdmin.adopt(fx.by, aleppo));
    fx.clock.advance(3_600_000);

    const revised = taken(
      await fx.rateAdmin.suggest(fx.by, 'SYP', { ...POUNDS, buy: '13300', sell: '13100' }),
    );

    expect(taken(await fx.rates.current(fx.by, aleppo, 'SYP')).revision).toEqual(adopted);
    const line = taken(await fx.rates.board(fx.by, aleppo)).lines.find(
      (one) => one.currency.code === 'SYP',
    );
    expect(line?.suggestion).toEqual(revised);
    expect(revised.supersedes).toBe(adopted?.adoptedFrom);
  });

  it('records nothing new when the same suggestion is adopted twice', async () => {
    taken(await fx.rateAdmin.suggest(fx.by, 'SYP', POUNDS));
    const first = taken(await fx.rateAdmin.adopt(fx.by, aleppo));
    const before = new Map(fx.store.committed());

    expect(taken(await fx.rateAdmin.adopt(fx.by, aleppo))).toEqual(first);
    expect(fx.store.committed()).toEqual(before);
  });

  it('adopts only what was suggested on the branch’s today, and says so when that is nothing', async () => {
    taken(await fx.rateAdmin.suggest(fx.by, 'SYP', POUNDS));
    fx.clock.advance(DAY);

    const nothing = refused(await fx.rateAdmin.adopt(fx.by, aleppo));

    expect(nothing.code).toBe('fx.suggested-rate-missing');
    expect(nothing.values).toEqual({ branch: aleppo, day: '2026-09-18' });
    expect(refused(await fx.rates.current(fx.by, aleppo, 'SYP')).code).toBe('fx.rate-missing');
  });

  it('refuses a suggestion that is not a rate, as it refuses a rate', async () => {
    expect(
      refused(await fx.rateAdmin.suggest(fx.by, 'SYP', { ...POUNDS, buy: '12900', sell: '13100' }))
        .code,
    ).toBe('fx.rate-spread-inverted');
    expect(refused(await fx.rateAdmin.suggest(fx.by, 'USD', POUNDS)).code).toBe(
      'fx.currency-is-functional',
    );
  });

  it('reads a suggestion’s day in each branch’s own zone', async () => {
    const london = fx.openBranch({ timeZone: 'UTC' });
    // Published at 22:30 UTC on the seventeenth: already the eighteenth in
    // Damascus, still the seventeenth in London.
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, 13.5 * 3_600_000));
    taken(await fx.rateAdmin.suggest(fx.by, 'SYP', POUNDS));
    // Two hours later it is the eighteenth in both — and in London the suggestion
    // is yesterday's.
    fx.clock.advance(2 * 3_600_000);

    expect(localDateOf(fx.clock.now(), 'UTC')).toBe('2026-09-18');
    expect(taken(await fx.rateAdmin.adopt(fx.by, aleppo))).toHaveLength(1);
    expect(refused(await fx.rateAdmin.adopt(fx.by, london)).code).toBe('fx.suggested-rate-missing');
  });
});

describe('Who may enter, suggest and confirm rates', () => {
  it('asks the right each command declares, at the place it acts in, before anything else', async () => {
    const { rate, suggestedRate, lastKnownRate } = FX_PERMISSIONS;
    const nowhere = fx.openBranch({ tenant: fx.otherTenant });
    const before = new Map(fx.store.committed());

    const commands: readonly [
      string,
      () => Promise<Result<unknown, Refusal>>,
      string,
      object | undefined,
    ][] = [
      [
        'record',
        () => fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS),
        rate.record,
        { branch: aleppo },
      ],
      ['adopt', () => fx.rateAdmin.adopt(fx.by, aleppo), rate.record, { branch: aleppo }],
      [
        'suggest',
        () => fx.rateAdmin.suggest(fx.by, 'SYP', POUNDS),
        suggestedRate.suggest,
        undefined,
      ],
      [
        'confirmLastKnown',
        () => fx.rateAdmin.confirmLastKnown(fx.by, aleppo),
        lastKnownRate.confirm,
        { branch: aleppo },
      ],
      // Refused before the branch is looked for: somebody who may not act learns
      // nothing about whether a branch exists.
      [
        'record elsewhere',
        () => fx.rateAdmin.record(fx.by, nowhere, 'SYP', POUNDS),
        rate.record,
        { branch: nowhere },
      ],
    ];

    for (const [name, run, right, where] of commands) {
      const asked: { right: string; where: object | undefined }[] = [];
      fx.answers((_by, one, place) => {
        asked.push({ right: one, where: place });
        return false;
      });

      const refusal = refused(await run());

      expect(refusal.code, name).toBe('fx.not-permitted');
      expect(refusal.values, name).toEqual({ right });
      expect(asked, name).toEqual([{ right, where }]);
    }

    expect(fx.store.committed()).toEqual(before);
  });

  it('seeds entering rates to the manager, suggesting them to the owner, and marks confirming a last-known rate sensitive', () => {
    const declared = new Map(fx.registry.permissions.map((one) => [one.id, one]));
    const { rate, suggestedRate, lastKnownRate } = FX_PERMISSIONS;

    expect(declared.get(rate.view)?.seededFor).toContain('cashier');
    expect(declared.get(rate.record)?.seededFor).toEqual(['manager']);
    expect(declared.get(suggestedRate.suggest)?.seededFor).toEqual([]);
    expect(declared.get(lastKnownRate.confirm)).toMatchObject({
      seededFor: ['manager', 'floor-supervisor'],
      sensitive: true,
    });
    expect(declared.get(rate.record)?.sensitive).toBeUndefined();
    expect([rate.record, suggestedRate.suggest, lastKnownRate.confirm]).toEqual([
      'fx.rate.create',
      'fx.suggested-rate.create',
      'fx.last-known-rate.confirm',
    ]);
  });
});

describe('A branch’s day only ever moves forward — FX-04', () => {
  /**
   * The hole this closes, which two rights opened together.
   *
   * A branch's rate is filed under the branch's own day, read from the branch's
   * time zone — which was revised under `sys.branch.edit`, the right a manager
   * is seeded. So a manager holding that and `fx.rate.create` could move the
   * shop's calendar backwards, file a rate under a day that had closed, and move
   * it back: `FX-04`'s "two rates per currency per day" became two rates for
   * whichever day they chose, and every document stamped on the real day
   * (`FX-05`) now sat beside a rate recorded after it.
   *
   * `SYS` answered the first half by putting the zone behind a right of its own.
   * This is the other half, and the one that does not depend on who holds what:
   * a rate is refused for a day the branch has already traded past, however its
   * day came to move — a rezoning, a machine clock stepped backwards, or a
   * daylight change that hands the same hour back.
   */
  it('refuses a rate for a day before the last one this branch recorded, and writes nothing', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    const committed = new Map(fx.store.committed());

    // Damascus keeps UTC+3 and Honolulu is UTC-10, so the moment that is noon
    // on the seventeenth in Aleppo is still the sixteenth there.
    fx.rezoneBranch(aleppo, 'Pacific/Honolulu');

    const refusal = refused(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    expect(refusal.code).toBe('fx.rate-day-behind');
    expect(refusal.values).toEqual({
      branch: aleppo,
      day: '2026-09-16',
      latest: '2026-09-17',
    });
    expect(fx.store.committed()).toEqual(committed);
  });

  it('refuses it when the clock steps backwards, which takes no rights at all', async () => {
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    // A store node whose machine clock was corrected the wrong way, or an hour
    // handed back at the end of summer time. Nobody had to be granted anything.
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, -DAY));

    expect(refused(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS)).code).toBe(
      'fx.rate-day-behind',
    );
  });

  it('measures the day against the branch rather than against the currency', async () => {
    // A day the branch has traded in is a day that is over, whichever currency
    // proved it — otherwise the rule would be escaped by recording the currency
    // nobody had entered yet.
    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, DAY));
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'EUR', EUROS));
    fx.clock.set(NOON_IN_DAMASCUS);

    expect(refused(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS)).code).toBe(
      'fx.rate-day-behind',
    );
  });

  it('still corrects today’s rate, and still records tomorrow’s', async () => {
    // The rule forbids going back, and `FX-04` requires both of these: a
    // mistyped rate is corrected by a new revision the same day, and the next
    // day is entered as usual.
    const first = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    const corrected = taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'SYP', { ...POUNDS, buy: '13150' }),
    );

    expect(corrected.sequence).toBe(2);
    expect(corrected.supersedes).toBe(first.id);

    fx.clock.set(plusMillis(NOON_IN_DAMASCUS, DAY));
    expect(taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS)).day).toBe('2026-09-18');
  });

  it('refuses an adoption into a day that has closed, and writes nothing', async () => {
    // Adopting the tenant's suggestion records the branch's rates, so it is the
    // same act by another door — and a door the rule would be useless without.
    taken(await fx.rateAdmin.suggest(fx.by, 'SYP', POUNDS));
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'EUR', EUROS));
    const committed = new Map(fx.store.committed());
    fx.rezoneBranch(aleppo, 'Pacific/Honolulu');

    expect(refused(await fx.rateAdmin.adopt(fx.by, aleppo)).code).toBe('fx.rate-day-behind');
    expect(fx.store.committed()).toEqual(committed);
  });

  it('holds the rule to the branch whose day moved, and to its tenant', async () => {
    const homs = fx.openBranch();
    const elsewhere = fx.openBranch({ tenant: fx.otherTenant });
    taken(await fx.admin.seed(fx.byOther));
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    fx.rezoneBranch(aleppo, 'Pacific/Honolulu');
    fx.rezoneBranch(elsewhere, 'Pacific/Honolulu');

    // Neither of them left the seventeenth, and neither of them holds Aleppo's
    // rates: a branch's rates are its own, and so is the day it is on.
    expect(taken(await fx.rateAdmin.record(fx.by, homs, 'SYP', POUNDS)).day).toBe('2026-09-17');
    expect(taken(await fx.rateAdmin.record(fx.byOther, elsewhere, 'SYP', POUNDS)).day).toBe(
      '2026-09-16',
    );
  });
});
