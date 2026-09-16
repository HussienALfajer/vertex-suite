import { describe, expect, it } from 'vitest';

import { instant, manualClock, plusMillis } from './clock.js';
import { InvalidIdError } from './errors.js';
import { compareIds, createIdGenerator, isId, newId, parseId, timeOf, type Id } from './id.js';

const NOON = instant(Date.UTC(2026, 8, 15, 12, 0, 0));

/**
 * No entropy at all, so that every field except the counter is fixed and the
 * counter's behaviour is the only thing the assertions can be reading.
 */
const noEntropy = (count: number): Uint8Array => new Uint8Array(count);

describe('newId', () => {
  it('issues a canonical UUIDv7', () => {
    const id = newId<'sale'>();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isId(id)).toBe(true);
  });

  it('carries the moment it was issued', () => {
    const before = Date.now();
    const issued = timeOf(newId());
    expect(issued).toBeGreaterThanOrEqual(before);
    expect(issued).toBeLessThanOrEqual(Date.now());
  });

  it('does not repeat itself under load', () => {
    // Ten thousand in a burst is a few milliseconds of one busy register.
    const ids = Array.from({ length: 10_000 }, () => newId());
    expect(new Set(ids).size).toBe(10_000);
  });

  it('issues in an order that sorting reproduces', () => {
    const ids = Array.from({ length: 1_000 }, () => newId());
    const sorted = [...ids].sort(compareIds);
    expect(sorted).toEqual(ids);
  });

  it('keeps an item apart from a customer at compile time', () => {
    const item = newId<'item'>();
    // @ts-expect-error — two strings of the same shape, and the compiler still
    // refuses, which is the entire reason the brand exists.
    const customer: Id<'customer'> = item;
    expect(customer).toBe(item);
  });
});

describe('a generator under a controlled clock', () => {
  it('strictly increases within a single millisecond', () => {
    const generator = createIdGenerator({ clock: manualClock(NOON), randomBytes: noEntropy });
    const ids = Array.from({ length: 50 }, () => generator.next());

    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort(compareIds)).toEqual(ids);
    expect(ids.every((id) => timeOf(id) === NOON)).toBe(true);
  });

  it('does not go backwards when the clock does', () => {
    // An operator corrects the machine clock mid-shift. Every identifier issued
    // after the correction must still sort after the ones issued before it, or
    // the receipts of that shift cannot be put back in order.
    const clock = manualClock(NOON);
    const generator = createIdGenerator({ clock, randomBytes: noEntropy });

    const before = generator.next();
    clock.advance(-60_000);
    const after = generator.next();

    expect(compareIds(before, after)).toBe(-1);
    expect(timeOf(after)).toBe(NOON);
  });

  it('borrows the next millisecond when the counter is exhausted', () => {
    // 4,096 identifiers inside one millisecond is far past anything a shop
    // does, and the behaviour at the boundary is still defined: the timestamp
    // advances by one rather than the counter wrapping onto a value it has
    // already issued.
    const generator = createIdGenerator({ clock: manualClock(NOON), randomBytes: noEntropy });
    const ids = Array.from({ length: 4_097 }, () => generator.next());

    expect(new Set(ids).size).toBe(4_097);
    expect(timeOf(ids[0]!)).toBe(NOON);
    expect(timeOf(ids[4_095]!)).toBe(NOON);
    expect(timeOf(ids[4_096]!)).toBe(plusMillis(NOON, 1));
  });

  it('refuses a clock that reads before 1970 rather than stamping 1970', () => {
    // A machine whose clock battery has died boots into a year the format
    // cannot carry. Issuing anyway would file its sales under the epoch.
    const generator = createIdGenerator({
      clock: manualClock(instant(-5_000)),
      randomBytes: noEntropy,
    });
    expect(() => generator.next()).toThrow(InvalidIdError);
  });

  it('never reuses a value across a stopped clock', () => {
    const generator = createIdGenerator({ clock: manualClock(NOON), randomBytes: noEntropy });
    const ids = Array.from({ length: 5_000 }, () => generator.next());
    expect(new Set(ids).size).toBe(5_000);
  });
});

describe('parseId', () => {
  it('normalises the case of an identifier arriving from outside', () => {
    const id = newId();
    expect(parseId(id.toUpperCase())).toBe(id);
    expect(parseId(` ${id} `)).toBe(id);
  });

  it('refuses anything this system would not have issued', () => {
    // A v4 is a well-formed UUID and is still rejected: it carries no time, so
    // nothing that relies on identifiers sorting would hold for it.
    expect(() => parseId('9f1c2b7e-3c4d-4f8a-9b2e-1d5a6c7e8f90')).toThrow(InvalidIdError);
    expect(() => parseId('not-an-identifier')).toThrow(InvalidIdError);
    expect(isId('9f1c2b7e-3c4d-4f8a-9b2e-1d5a6c7e8f90')).toBe(false);
  });
});
