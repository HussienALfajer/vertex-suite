import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  compareInstants,
  fixedClock,
  instant,
  instantFrom,
  localDate,
  localDateFrom,
  localDateOf,
  manualClock,
  millisBetween,
  offsetClock,
  partsOfDay,
  plusMillis,
  systemClock,
  timeZoneNamed,
  toDate,
  toISOString,
} from './clock.js';
import { InvalidDayError, InvalidInstantError, InvalidTimeZoneError } from './errors.js';

const NOON = instant(Date.UTC(2026, 8, 15, 12, 0, 0));

describe('instant', () => {
  it('is whole milliseconds', () => {
    expect(() => instant(1.5)).toThrow(InvalidInstantError);
    expect(() => instant(Number.NaN)).toThrow(InvalidInstantError);
  });

  it('refuses a value no date can represent', () => {
    expect(() => instant(8_640_000_000_000_001)).toThrow(InvalidInstantError);
  });

  it('refuses an invalid Date instead of carrying NaN forward', () => {
    expect(() => instantFrom(new Date('not a date'))).toThrow(InvalidInstantError);
  });

  it('round-trips through Date', () => {
    expect(instantFrom(toDate(NOON))).toBe(NOON);
  });

  it('renders as ISO 8601 in UTC', () => {
    expect(toISOString(NOON)).toBe('2026-09-15T12:00:00.000Z');
  });

  it('orders and measures', () => {
    const later = plusMillis(NOON, 1_500);
    expect(compareInstants(NOON, later)).toBe(-1);
    expect(compareInstants(later, NOON)).toBe(1);
    expect(compareInstants(NOON, NOON)).toBe(0);
    expect(millisBetween(NOON, later)).toBe(1_500);
    expect(millisBetween(later, NOON)).toBe(-1_500);
  });
});

describe('clocks', () => {
  it('reads the machine clock', () => {
    const before = Date.now();
    const observed = systemClock.now();
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(Number.isInteger(observed)).toBe(true);
  });

  it('stands still when fixed', () => {
    const clock = fixedClock(NOON);
    expect(clock.now()).toBe(NOON);
    expect(clock.now()).toBe(NOON);
  });

  it('applies a correction without touching the machine clock', () => {
    // A register an hour behind the store node stamps the shop's time, while
    // the operating system's clock — which the cashier cannot change anyway —
    // is left exactly as it was.
    const device = fixedClock(NOON);
    expect(offsetClock(device, 3_600_000).now()).toBe(plusMillis(NOON, 3_600_000));
  });

  it('refuses a fractional correction', () => {
    expect(() => offsetClock(systemClock, 0.5)).toThrow(InvalidInstantError);
  });

  it('can be driven backwards, because a real one is', () => {
    const clock = manualClock(NOON);
    clock.advance(-5_000);
    expect(clock.now()).toBe(plusMillis(NOON, -5_000));
    clock.set(NOON);
    expect(clock.now()).toBe(NOON);
  });
});

describe('timeZoneNamed', () => {
  it('names a zone the runtime knows, in its canonical spelling', () => {
    expect(timeZoneNamed('Asia/Damascus')).toBe('Asia/Damascus');
    expect(timeZoneNamed('asia/damascus')).toBe('Asia/Damascus');
    expect(timeZoneNamed('utc')).toBe('UTC');
  });

  it('answers null for a name that is not a zone, rather than throwing', () => {
    for (const name of ['Mars/Olympus', '', ' Asia/Damascus', 'Asia/Damascus\n']) {
      expect(timeZoneNamed(name), JSON.stringify(name)).toBeNull();
    }
    expect(timeZoneNamed(3 as unknown as string)).toBeNull();
  });
});

describe('localDateOf', () => {
  // Damascus has kept UTC+3 all year since the end of 2022, so the day turns at
  // 21:00 UTC in September and in January alike.
  const DAMASCUS = 'Asia/Damascus';

  it('reads the day an instant falls on where the shop is, not where the machine is', () => {
    expect(localDateOf(instant(Date.UTC(2026, 8, 17, 20, 59, 59, 999)), DAMASCUS)).toBe(
      '2026-09-17',
    );
    expect(localDateOf(instant(Date.UTC(2026, 8, 17, 21, 0, 0)), DAMASCUS)).toBe('2026-09-18');
    expect(localDateOf(instant(Date.UTC(2026, 8, 17, 21, 0, 0)), 'UTC')).toBe('2026-09-17');
  });

  it('turns the day at the same hour in winter, with no daylight rule the country abolished', () => {
    expect(localDateOf(instant(Date.UTC(2026, 0, 15, 21, 0, 0)), DAMASCUS)).toBe('2026-01-16');
  });

  it('writes a day that sorts as text in the order the days came', () => {
    const days = [
      Date.UTC(2026, 11, 31, 12),
      Date.UTC(2027, 0, 1, 12),
      Date.UTC(2027, 0, 10, 12),
    ].map((ms) => localDateOf(instant(ms), 'UTC'));
    expect([...days].sort()).toEqual(days);
    expect(days[1]).toBe('2027-01-01');
  });

  it('refuses a year that has no four-digit form, instead of writing another day', () => {
    const beforeTheEra = new Date(0);
    beforeTheEra.setUTCFullYear(-5, 0, 1);
    expect(() => localDateOf(instantFrom(beforeTheEra), 'UTC')).toThrow(InvalidInstantError);
    expect(() => localDateOf(instant(Date.UTC(12000, 0, 1)), 'UTC')).toThrow(InvalidInstantError);
  });

  it('raises for a zone it does not know, which a checked name never is', () => {
    expect(() => localDateOf(NOON, 'Mars/Olympus')).toThrow(InvalidTimeZoneError);
  });
});

describe('localDate', () => {
  it('reads the one spelling a day is written in, and no other', () => {
    expect(localDate('2026-03-14')).toBe('2026-03-14');
    expect(localDate('0001-01-01')).toBe('0001-01-01');
    expect(localDate('9999-12-31')).toBe('9999-12-31');

    for (const text of [
      '',
      '2026-3-14',
      '14-03-2026',
      '2026/03/14',
      ' 2026-03-14',
      '2026-03-14 ',
      '2026-03-14T00:00:00Z',
      '٢٠٢٦-٠٣-١٤',
      '+2026-03-14',
    ]) {
      expect(localDate(text), text).toBeNull();
    }
  });

  it('refuses a day written correctly that no calendar has', () => {
    expect(localDate('2026-02-29')).toBeNull();
    expect(localDate('2024-02-29')).toBe('2024-02-29');
    expect(localDate('2026-02-30')).toBeNull();
    expect(localDate('2026-13-01')).toBeNull();
    expect(localDate('2026-00-10')).toBeNull();
    expect(localDate('2026-04-31')).toBeNull();
    expect(localDate('2026-01-00')).toBeNull();
    expect(localDate('0000-01-01')).toBeNull();
  });

  it('answers null for anything that is not a string at all, which a wire can send', () => {
    const sent: readonly unknown[] = [null, undefined, 20260314, {}, ['2026-03-14']];
    for (const [index, value] of sent.entries()) {
      expect(localDate(value as string), String(index)).toBeNull();
    }
  });
});

describe('localDateFrom and partsOfDay', () => {
  it('writes the day three figures name, zero-padded so that days sort as text', () => {
    expect(localDateFrom(2026, 3, 14)).toBe('2026-03-14');
    expect(localDateFrom(2026, 1, 1)).toBe('2026-01-01');
    // A year below a hundred is that year, not nineteen hundred and it.
    expect(localDateFrom(26, 3, 14)).toBe('0026-03-14');
  });

  it('raises for figures that name no day, rather than rolling over to another', () => {
    expect(() => localDateFrom(2026, 2, 30)).toThrow(InvalidDayError);
    expect(() => localDateFrom(2026, 13, 1)).toThrow(InvalidDayError);
    expect(() => localDateFrom(2026, 0, 1)).toThrow(InvalidDayError);
    expect(() => localDateFrom(2026, 3, 14.5)).toThrow(InvalidDayError);
    expect(() => localDateFrom(0, 1, 1)).toThrow(InvalidDayError);
    expect(() => localDateFrom(10_000, 1, 1)).toThrow(InvalidDayError);
  });

  it('reads back exactly the figures a day was written from', () => {
    expect(partsOfDay(localDateFrom(2026, 3, 14))).toEqual({ year: 2026, month: 3, day: 14 });
    expect(partsOfDay(localDateFrom(26, 12, 31))).toEqual({ year: 26, month: 12, day: 31 });
  });
});

describe('addDays and addMonths', () => {
  const day = (text: string) => {
    const value = localDate(text);
    if (value === null) throw new Error(`"${text}" is not a day.`);
    return value;
  };

  it('moves a day forwards and backwards over the ends of months and years', () => {
    expect(addDays(day('2026-03-14'), 1)).toBe('2026-03-15');
    expect(addDays(day('2026-03-14'), 0)).toBe('2026-03-14');
    expect(addDays(day('2026-03-14'), -1)).toBe('2026-03-13');
    expect(addDays(day('2026-01-31'), 1)).toBe('2026-02-01');
    expect(addDays(day('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(day('2027-01-01'), -1)).toBe('2026-12-31');
    expect(addDays(day('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(day('2026-02-28'), 1)).toBe('2026-03-01');
    expect(addDays(day('2026-01-01'), 365)).toBe('2027-01-01');
  });

  it('moves a day by whole months, clamped to the end of the month it lands in', () => {
    expect(addMonths(day('2026-01-15'), 1)).toBe('2026-02-15');
    expect(addMonths(day('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonths(day('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonths(day('2026-01-31'), 3)).toBe('2026-04-30');
    expect(addMonths(day('2026-03-31'), -1)).toBe('2026-02-28');
    expect(addMonths(day('2026-12-01'), 1)).toBe('2027-01-01');
    expect(addMonths(day('2026-01-01'), 12)).toBe('2027-01-01');
    expect(addMonths(day('2026-06-30'), 0)).toBe('2026-06-30');
  });

  it('never drifts, because a span is always measured from where it started', () => {
    // Stepping one month at a time from the thirty-first loses the days the
    // clamp took: twice by one lands on the twenty-eighth of March, and once by
    // two on the thirty-first, which is the answer a fiscal year needs.
    const start = day('2026-01-31');
    expect(addMonths(addMonths(start, 1), 1)).toBe('2026-03-28');
    expect(addMonths(start, 2)).toBe('2026-03-31');
  });

  it('raises rather than answering with a day outside the years one is written for', () => {
    expect(() => addDays(day('0001-01-01'), -1)).toThrow(InvalidDayError);
    expect(() => addDays(day('9999-12-31'), 1)).toThrow(InvalidDayError);
    expect(() => addMonths(day('9999-12-31'), 1)).toThrow(InvalidDayError);
    expect(() => addDays(day('2026-03-14'), 1.5)).toThrow(InvalidDayError);
    expect(() => addMonths(day('2026-03-14'), Number.NaN)).toThrow(InvalidDayError);
  });
});
