import { describe, expect, it } from 'vitest';

import {
  compareInstants,
  fixedClock,
  instant,
  instantFrom,
  localDateOf,
  manualClock,
  millisBetween,
  offsetClock,
  plusMillis,
  systemClock,
  timeZoneNamed,
  toDate,
  toISOString,
} from './clock.js';
import { InvalidInstantError, InvalidTimeZoneError } from './errors.js';

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
