import {
  addDays,
  instant,
  isOk,
  localDate,
  type LocalDate,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FIN_PERMISSION_SEEDS,
  FIN_PERMISSIONS,
  type AccountingPeriod,
  type FiscalYear,
} from './contract.js';
import { installFin, type Installed } from './edition.fixture.js';
import { yearState } from './index.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code}`);
}

function refusalOf(result: Result<unknown, Refusal>): Refusal {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error;
}

/** A day written the way an accountant writes one. */
function day(text: string): LocalDate {
  const value = localDate(text);
  if (value === null) throw new Error(`"${text}" is not a day.`);
  return value;
}

/** Each period as `opens…closes`, which is the whole of what a division of a year is. */
function spans(year: FiscalYear): readonly string[] {
  return year.periods.map((one) => `${one.opensOn}…${one.closesOn}`);
}

function periodOf(year: FiscalYear, ordinal: number): AccountingPeriod {
  const found = year.periods.find((one) => one.ordinal === ordinal);
  if (found === undefined) throw new Error(`The year has no period ${String(ordinal)}.`);
  return found;
}

/**
 * Every day of every year accounted for exactly once, end to end: each period
 * opens the day after the one before it closes, and each year spans its own
 * periods. It is what a calendar has to be for `FIN-05` to mean anything — a
 * day in a gap belongs to no period, so nothing could say whether it is closed.
 */
function isContiguous(years: readonly FiscalYear[]): boolean {
  const periods = years.flatMap((year) => year.periods);
  const joined = periods.every((period, index) => {
    const previous = periods[index - 1];
    return (
      period.opensOn <= period.closesOn &&
      (previous === undefined || addDays(previous.closesOn, 1) === period.opensOn)
    );
  });
  return (
    joined &&
    years.every(
      (year) =>
        year.periods.at(0)?.opensOn === year.opensOn &&
        year.periods.at(-1)?.closesOn === year.closesOn,
    )
  );
}

let fin: Installed;

beforeEach(() => {
  fin = installFin();
});

describe('Fiscal calendar and period closing — FIN-05', () => {
  it('seeds the current calendar year, divided into twelve open monthly periods', async () => {
    expect(await fin.calendar.years(fin.by)).toEqual([]);

    const [year, ...others] = taken(await fin.calendarAdmin.seed(fin.system));

    expect(others).toEqual([]);
    expect(year).toBeDefined();
    expect(year?.opensOn).toBe('2026-01-01');
    expect(year?.closesOn).toBe('2026-12-31');
    expect(spans(year!)).toEqual([
      '2026-01-01…2026-01-31',
      '2026-02-01…2026-02-28',
      '2026-03-01…2026-03-31',
      '2026-04-01…2026-04-30',
      '2026-05-01…2026-05-31',
      '2026-06-01…2026-06-30',
      '2026-07-01…2026-07-31',
      '2026-08-01…2026-08-31',
      '2026-09-01…2026-09-30',
      '2026-10-01…2026-10-31',
      '2026-11-01…2026-11-30',
      '2026-12-01…2026-12-31',
    ]);
    expect(year?.periods.map((one) => one.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    for (const period of year?.periods ?? []) {
      // "each open or closed": a period is open until somebody closes it, and
      // nothing has been posted into a calendar installed a moment ago.
      expect(period.closed).toBeNull();
      expect(period.posted).toBe(false);
      expect(period.year).toBe(year?.id);
    }
    expect(await fin.calendar.years(fin.by)).toEqual([year]);
  });

  it('counts the year at the branch the tenant opened first, not at the machine the store node runs on', async () => {
    // A quarter past midnight on the first of January in Damascus, which is
    // still the evening of the thirty-first where the clock reads UTC.
    fin.clock.set(instant(Date.UTC(2026, 11, 31, 21, 15)));
    fin.openBranch({ timeZone: 'Asia/Damascus' });
    // Opened later, and in another zone: the first branch is the tenant's day.
    fin.openBranch({ timeZone: 'UTC' });

    expect(taken(await fin.calendarAdmin.seed(fin.system))[0]?.opensOn).toBe('2027-01-01');

    const elsewhere = installFin();
    elsewhere.clock.set(instant(Date.UTC(2026, 11, 31, 21, 15)));
    elsewhere.openBranch({ timeZone: 'UTC' });
    expect(taken(await elsewhere.calendarAdmin.seed(elsewhere.system))[0]?.opensOn).toBe(
      '2026-01-01',
    );

    // A shop set up before its first branch is opened is counted where the
    // product is first sold, which is the zone a branch is opened in anyway.
    const unplaced = installFin();
    unplaced.clock.set(instant(Date.UTC(2026, 11, 31, 21, 15)));
    expect(taken(await unplaced.calendarAdmin.seed(unplaced.system))[0]?.opensOn).toBe(
      '2027-01-01',
    );
  });

  it('seeds once: a replayed seed installs nothing over the calendar already there', async () => {
    const first = taken(await fin.calendarAdmin.seed(fin.system));
    taken(await fin.calendarAdmin.close(fin.by, periodOf(first[0]!, 1).id));

    const again = taken(await fin.calendarAdmin.seed(fin.system));

    expect(again.map((one) => one.id)).toEqual(first.map((one) => one.id));
    expect(periodOf(again[0]!, 1).closed).not.toBeNull();
  });

  it('appends the next year the day after the last one ends, in the shape of the one before it', async () => {
    const [first] = taken(await fin.calendarAdmin.seed(fin.system));

    const second = taken(await fin.calendarAdmin.append(fin.by));
    expect(second.opensOn).toBe('2027-01-01');
    expect(second.closesOn).toBe('2027-12-31');
    expect(second.periods).toHaveLength(12);

    // A shape of its own, for a tenant that keeps its books by quarter.
    const third = taken(await fin.calendarAdmin.append(fin.by, { months: 12, monthsPerPeriod: 3 }));
    expect(spans(third)).toEqual([
      '2028-01-01…2028-03-31',
      '2028-04-01…2028-06-30',
      '2028-07-01…2028-09-30',
      '2028-10-01…2028-12-31',
    ]);
    // And the one after it follows the shape it found, not the shape it began with.
    const fourth = taken(await fin.calendarAdmin.append(fin.by));
    expect(fourth.periods).toHaveLength(4);

    const years = await fin.calendar.years(fin.by);
    expect(years.map((one) => one.id)).toEqual([first!.id, second.id, third.id, fourth.id]);
    expect(isContiguous(years)).toBe(true);

    // And a day is looked for in whichever year covers it, not in the first.
    expect(taken(await fin.calendar.postingPeriodOn(fin.by, day('2028-05-20')))).toMatchObject({
      year: third.id,
      ordinal: 2,
    });
  });

  it('divides a year that opens on the last day of a month without losing a day of it', async () => {
    const [seeded] = taken(await fin.calendarAdmin.seed(fin.system));

    // The thirty-first of January plus one month is the twenty-eighth of
    // February, so the months a year of these is divided into are of unequal
    // length — and still have to meet exactly and add up to the year. A period
    // measured from the one before it instead of from the day the year opened
    // would lose those days, three of them by March.
    const year = taken(
      await fin.calendarAdmin.redefine(fin.by, seeded!.id, {
        opensOn: day('2026-01-31'),
        months: 12,
        monthsPerPeriod: 1,
      }),
    );

    expect(spans(year).slice(0, 4)).toEqual([
      '2026-01-31…2026-02-27',
      '2026-02-28…2026-03-30',
      '2026-03-31…2026-04-29',
      '2026-04-30…2026-05-30',
    ]);
    expect(year.closesOn).toBe('2027-01-30');
    expect(isContiguous([year])).toBe(true);
    expect(taken(await fin.calendarAdmin.append(fin.by)).opensOn).toBe('2027-01-31');
  });

  it('refuses to append a year to a calendar that was never installed', async () => {
    expect(refusalOf(await fin.calendarAdmin.append(fin.by))).toEqual({
      code: 'fin.calendar-unseeded',
      values: {},
    });
  });

  it('redefines the year of a shop whose books run from April, while nothing is posted into it', async () => {
    const [seeded] = taken(await fin.calendarAdmin.seed(fin.system));

    const year = taken(
      await fin.calendarAdmin.redefine(fin.by, seeded!.id, {
        opensOn: day('2026-04-01'),
        months: 12,
        monthsPerPeriod: 3,
      }),
    );

    expect(year.id).toBe(seeded!.id);
    expect(spans(year)).toEqual([
      '2026-04-01…2026-06-30',
      '2026-07-01…2026-09-30',
      '2026-10-01…2026-12-31',
      '2027-01-01…2027-03-31',
    ]);
    expect(year.closesOn).toBe('2027-03-31');
    // The year that follows begins where the redefined one ends.
    expect(taken(await fin.calendarAdmin.append(fin.by)).opensOn).toBe('2027-04-01');
  });

  it('refuses to redefine a year once anything has been posted into it', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    const march = periodOf(year!, 3);

    expect(taken(await fin.post(day('2026-03-14'))).entry.period).toBe(march.id);

    const posted = (await fin.calendar.years(fin.by))[0]!;
    expect(periodOf(posted, 3).posted).toBe(true);
    expect(periodOf(posted, 4).posted).toBe(false);
    expect(
      refusalOf(
        await fin.calendarAdmin.redefine(fin.by, year!.id, {
          opensOn: day('2026-01-01'),
          months: 12,
          monthsPerPeriod: 3,
        }),
      ),
    ).toEqual({ code: 'fin.fiscal-year-posted', values: { year: year!.id, period: march.id } });
  });

  it('refuses to redefine any year but the last, which is the only one with nothing after it', async () => {
    const [first] = taken(await fin.calendarAdmin.seed(fin.system));
    const second = taken(await fin.calendarAdmin.append(fin.by));

    expect(
      refusalOf(
        await fin.calendarAdmin.redefine(fin.by, first!.id, {
          opensOn: day('2026-01-01'),
          months: 6,
          monthsPerPeriod: 1,
        }),
      ),
    ).toEqual({ code: 'fin.fiscal-year-not-last', values: { year: first!.id, last: second.id } });
  });

  it('refuses to redefine a year holding a closed period, which would reopen it with nobody asked', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    const january = periodOf(year!, 1);
    taken(await fin.calendarAdmin.close(fin.by, january.id));

    expect(
      refusalOf(
        await fin.calendarAdmin.redefine(fin.by, year!.id, {
          opensOn: day('2026-01-01'),
          months: 12,
          monthsPerPeriod: 3,
        }),
      ),
    ).toEqual({ code: 'fin.period-closed', values: { period: january.id } });
  });

  it('refuses a year that is not a whole number of months divided evenly into periods', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    const redefine = (definition: unknown) =>
      fin.calendarAdmin.redefine(
        fin.by,
        year!.id,
        definition as Parameters<typeof fin.calendarAdmin.redefine>[2],
      );

    for (const months of [0, -12, 1.5, 25, '12', null]) {
      expect(
        refusalOf(await redefine({ opensOn: day('2026-01-01'), months, monthsPerPeriod: 1 })).code,
        String(months),
      ).toBe('fin.fiscal-year-months-invalid');
    }
    for (const monthsPerPeriod of [0, -1, 5, 2.5, 13, '3', undefined]) {
      expect(
        refusalOf(await redefine({ opensOn: day('2026-01-01'), months: 12, monthsPerPeriod })).code,
        String(monthsPerPeriod),
      ).toBe('fin.months-per-period-invalid');
    }
    expect(
      refusalOf(await redefine({ opensOn: '2026-02-30', months: 12, monthsPerPeriod: 1 })),
    ).toEqual({ code: 'fin.day-invalid', values: { day: '2026-02-30' } });

    // A command that reached this module with no definition at all is answered
    // like any other, field by field, rather than thrown at.
    for (const nothing of [null, undefined, 'a year']) {
      expect(refusalOf(await redefine(nothing)).code, String(nothing)).toBe(
        'fin.fiscal-year-months-invalid',
      );
    }
  });

  it('refuses a year the calendar has no days left for, rather than raising at the end of time', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));

    // A day that is a day, and an opening day no year fits after: the last
    // year a day can be written for is 9999. Every figure a person types is
    // answered as data, and running off the end of the calendar is no
    // exception to that.
    expect(
      refusalOf(
        await fin.calendarAdmin.redefine(fin.by, year!.id, {
          opensOn: day('9999-06-01'),
          months: 12,
          monthsPerPeriod: 1,
        }),
      ),
    ).toEqual({ code: 'fin.day-invalid', values: { day: '9999-06-01' } });

    // And the same at the far end of a calendar that reaches as far as one can.
    const last = taken(
      await fin.calendarAdmin.redefine(fin.by, year!.id, {
        opensOn: day('9999-01-01'),
        months: 11,
        monthsPerPeriod: 11,
      }),
    );
    expect(last.closesOn).toBe('9999-11-30');
    expect(refusalOf(await fin.calendarAdmin.append(fin.by))).toEqual({
      code: 'fin.day-invalid',
      values: { day: '9999-11-30' },
    });
  });

  it('refuses a redefined year that would leave a gap after the year before it', async () => {
    taken(await fin.calendarAdmin.seed(fin.system));
    const second = taken(await fin.calendarAdmin.append(fin.by));

    expect(
      refusalOf(
        await fin.calendarAdmin.redefine(fin.by, second.id, {
          opensOn: day('2027-02-01'),
          months: 12,
          monthsPerPeriod: 1,
        }),
      ),
    ).toEqual({
      code: 'fin.fiscal-year-gap',
      values: { year: second.id, opensOn: '2027-02-01', follows: '2027-01-01' },
    });
  });

  it('reads a year as closed once every period in it is, and as open until then', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    expect(yearState(year!)).toBe('open');

    for (const period of year!.periods.slice(0, -1)) {
      taken(await fin.calendarAdmin.close(fin.by, period.id));
    }
    expect(yearState((await fin.calendar.years(fin.by))[0]!)).toBe('open');

    taken(await fin.calendarAdmin.close(fin.by, periodOf(year!, 12).id));
    expect(yearState((await fin.calendar.years(fin.by))[0]!)).toBe('closed');

    taken(await fin.calendarAdmin.reopen(fin.by, periodOf(year!, 7).id, 'جرد متأخر'));
    expect(yearState((await fin.calendar.years(fin.by))[0]!)).toBe('open');
  });

  it('blocks every posting dated within a closed period, and only within it', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    const march = periodOf(year!, 3);

    expect(taken(await fin.calendar.postingPeriodOn(fin.by, day('2026-03-31'))).id).toBe(march.id);

    const closed = taken(await fin.calendarAdmin.close(fin.by, march.id));
    expect(closed.closed).toEqual({ by: fin.by.actor, at: fin.clock.now() });

    for (const within of ['2026-03-01', '2026-03-14', '2026-03-31']) {
      expect(refusalOf(await fin.calendar.postingPeriodOn(fin.by, day(within))), within).toEqual({
        code: 'fin.period-closed',
        values: { day: within, period: march.id },
      });
    }
    // The day on either side of it is untouched, and nothing was marked as
    // posted by a posting that was refused.
    expect(taken(await fin.calendar.postingPeriodOn(fin.by, day('2026-02-28'))).ordinal).toBe(2);
    expect(taken(await fin.calendar.postingPeriodOn(fin.by, day('2026-04-01'))).ordinal).toBe(4);
    expect(refusalOf(await fin.post(day('2026-03-14'))).code).toBe('fin.period-closed');
    expect(periodOf((await fin.calendar.years(fin.by))[0]!, 3).posted).toBe(false);
  });

  it('answers a day the calendar does not cover, and a day that is not a day at all', async () => {
    expect(refusalOf(await fin.calendar.postingPeriodOn(fin.by, day('2026-03-14')))).toEqual({
      code: 'fin.calendar-unseeded',
      values: { day: '2026-03-14' },
    });

    taken(await fin.calendarAdmin.seed(fin.system));
    for (const outside of ['2025-12-31', '2027-01-01']) {
      expect(refusalOf(await fin.calendar.postingPeriodOn(fin.by, day(outside))), outside).toEqual({
        code: 'fin.day-outside-calendar',
        values: { day: outside },
      });
    }
    // Arriving off a wire, out of `SYN-02`'s replay, or from a screen nobody
    // checked: the brand is gone at run time.
    for (const nonsense of ['', '14/03/2026', '2026-3-14', '2026-02-30', 20260314, null]) {
      expect(
        refusalOf(await fin.calendar.postingPeriodOn(fin.by, nonsense as LocalDate)).code,
        String(nonsense),
      ).toBe('fin.day-invalid');
    }
  });

  it('closes a period and reopens it against a written reason, keeping the reopening in its own log', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    const march = periodOf(year!, 3);
    const closed = taken(await fin.calendarAdmin.close(fin.by, march.id));
    expect(await fin.calendar.reopenings(fin.by)).toEqual([]);

    expect(refusalOf(await fin.calendarAdmin.reopen(fin.by, march.id, ' . '))).toEqual({
      code: 'fin.reopen-reason-required',
      values: { period: march.id },
    });

    fin.clock.advance(60_000);
    const reopened = taken(
      await fin.calendarAdmin.reopen(fin.by, march.id, '  فاتورة وصلت متأخرة  '),
    );

    expect(reopened.closed).toBeNull();
    expect(taken(await fin.calendar.postingPeriodOn(fin.by, day('2026-03-14'))).id).toBe(march.id);
    const [entry, ...rest] = await fin.calendar.reopenings(fin.by);
    expect(rest).toEqual([]);
    expect(entry).toEqual({
      id: entry?.id,
      tenant: fin.tenant,
      year: year!.id,
      period: march.id,
      undone: closed.closed,
      reason: 'فاتورة وصلت متأخرة',
      by: fin.by.actor,
      at: fin.clock.now(),
    });
    expect(await fin.calendar.reopenings(fin.by, periodOf(year!, 4).id)).toEqual([]);
  });

  it('answers a period already in the state asked for as done, and logs no second reopening', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    const march = periodOf(year!, 3);

    // Never closed: reopening it is a button pressed twice, or a command
    // `SYN-02` replays, and neither may fail or leave a trace.
    expect(taken(await fin.calendarAdmin.reopen(fin.by, march.id, 'لا شيء')).closed).toBeNull();
    expect(await fin.calendar.reopenings(fin.by)).toEqual([]);

    const closed = taken(await fin.calendarAdmin.close(fin.by, march.id));
    fin.clock.advance(60_000);
    expect(taken(await fin.calendarAdmin.close(fin.by, march.id)).closed).toEqual(closed.closed);

    taken(await fin.calendarAdmin.reopen(fin.by, march.id, 'خطأ'));
    taken(await fin.calendarAdmin.reopen(fin.by, march.id, 'خطأ'));
    expect(await fin.calendar.reopenings(fin.by)).toHaveLength(1);
  });

  it('refuses a year and a period no tenant of the caller’s has', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    const march = periodOf(year!, 3);
    taken(await fin.calendarAdmin.seed(fin.byOther));

    expect(
      refusalOf(
        await fin.calendarAdmin.redefine(fin.byOther, year!.id, {
          opensOn: day('2026-01-01'),
          months: 12,
          monthsPerPeriod: 1,
        }),
      ),
    ).toEqual({ code: 'fin.fiscal-year-not-found', values: { year: year!.id } });
    expect(refusalOf(await fin.calendarAdmin.close(fin.byOther, march.id))).toEqual({
      code: 'fin.period-not-found',
      values: { period: march.id },
    });
    expect(refusalOf(await fin.calendarAdmin.reopen(fin.byOther, march.id, 'سبب')).code).toBe(
      'fin.period-not-found',
    );
    // One tenant's closing says nothing about another's day.
    taken(await fin.calendarAdmin.close(fin.by, march.id));
    expect(taken(await fin.calendar.postingPeriodOn(fin.byOther, day('2026-03-14'))).id).not.toBe(
      march.id,
    );
  });

  it('hands out a calendar nothing outside this module can edit', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));

    expect(Object.isFrozen(year)).toBe(true);
    expect(Object.isFrozen(year?.periods)).toBe(true);
    expect(Object.isFrozen(periodOf(year!, 1))).toBe(true);
    const closed = taken(await fin.calendarAdmin.close(fin.by, periodOf(year!, 1).id));
    expect(Object.isFrozen(closed)).toBe(true);
    expect(Object.isFrozen(closed.closed)).toBe(true);
  });
});

describe('Who may keep the calendar', () => {
  it('asks the right each command declares, and refuses before anything is written', async () => {
    const [year] = taken(await fin.calendarAdmin.seed(fin.system));
    const march = periodOf(year!, 3);
    const asked: string[] = [];
    fin.answers((by, right, where) => {
      expect(by).toBe(fin.by);
      // Tenant-wide: a calendar is one per tenant, and `FIN-05` closes a period
      // for the whole of it — a branch still open in a closed month would be a
      // set of books that does not add up.
      expect(where).toBeUndefined();
      asked.push(right);
      return false;
    });

    const { fiscalYear, accountingPeriod } = FIN_PERMISSIONS;
    const definition = { opensOn: day('2026-01-01'), months: 12, monthsPerPeriod: 1 };
    const attempts = [
      [fin.calendarAdmin.seed(fin.by), fiscalYear.create],
      [fin.calendarAdmin.append(fin.by), fiscalYear.create],
      [fin.calendarAdmin.redefine(fin.by, year!.id, definition), fiscalYear.edit],
      [fin.calendarAdmin.close(fin.by, march.id), accountingPeriod.close],
      [fin.calendarAdmin.reopen(fin.by, march.id, 'سبب'), accountingPeriod.reopen],
    ] as const;
    for (const [attempt, right] of attempts) {
      expect(refusalOf(await attempt)).toEqual({ code: 'fin.not-permitted', values: { right } });
    }
    expect(asked).toEqual(attempts.map(([, right]) => right));
    expect(await fin.calendar.years(fin.by)).toEqual([year]);
  });

  it('declares every right it asks, and reserves reopening a closed period to the owner', () => {
    const declared = new Map(FIN_PERMISSION_SEEDS.map((one) => [one.id, one]));
    const { fiscalYear, accountingPeriod } = FIN_PERMISSIONS;

    expect(
      [...declared.keys()].filter((id) => /^fin\.(fiscal-year|accounting-period)\./.test(id)),
    ).toEqual([
      'fin.fiscal-year.view',
      'fin.fiscal-year.create',
      'fin.fiscal-year.edit',
      'fin.accounting-period.close',
      'fin.accounting-period.reopen',
    ]);
    expect(declared.get(fiscalYear.view)?.seededFor).toEqual(['manager', 'accountant']);
    for (const right of [fiscalYear.create, fiscalYear.edit, accountingPeriod.close]) {
      expect(declared.get(right)?.seededFor).toEqual(['accountant']);
      expect(declared.get(right)?.sensitive).toBeUndefined();
    }
    // Nobody is seeded it: the owner holds every right this edition declares by
    // construction, and naming them here would be a second statement of that.
    expect(declared.get(accountingPeriod.reopen)).toEqual({
      id: accountingPeriod.reopen,
      seededFor: [],
      sensitive: true,
    });
    expect(fin.registry.module('FIN')?.permissions.map((one) => one.id)).toEqual([
      ...declared.keys(),
    ]);
  });
});
