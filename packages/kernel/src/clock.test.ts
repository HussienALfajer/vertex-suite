import { describe, expect, it } from 'vitest';

import {
  compareInstants,
  fixedClock,
  instant,
  instantFrom,
  manualClock,
  millisBetween,
  offsetClock,
  plusMillis,
  systemClock,
  toDate,
  toISOString,
} from './clock.js';
import { InvalidInstantError } from './errors.js';

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
