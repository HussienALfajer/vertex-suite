/**
 * The two functions §12 names beside its components: a date written into a
 * **sentence**.
 *
 * `DateTime` renders both of these, and `display.test.tsx` proves what the
 * component puts on screen. What is proven here is what neither a component
 * test nor a screen test can see, because both run where the machine's own
 * clock happens to agree with the answer.
 *
 * **The machine is moved west first, and that is the whole point of this
 * file.** A calendar day has no zone, so `formatDay` builds its three figures
 * at UTC midnight and asks `Intl` to read them back at UTC. Left to the
 * ambient zone instead, the same code is correct everywhere east of Greenwich
 * — including this product's own market, and including a CI runner set to UTC
 * — and prints **the day before** everywhere west of it. A store node in
 * Denver would have shown a fiscal year opening on 31 December. So the file is
 * run where that is visible; it is isolated to its own worker, so no other
 * suite is moved with it.
 */
process.env['TZ'] = 'America/Denver';

import { describe, expect, it } from 'vitest';

import { localDate, type LocalDate } from '@vertex/kernel';

import { formatDay, formatMoment } from './format.js';

const day = (written: string): LocalDate => {
  const value = localDate(written);
  if (value === null) throw new Error(`"${written}" is not a day.`);
  return value;
};

/** The invisible characters `Intl` puts around an Arabic date's separators. */
const DIRECTION_MARKS = [0x200e, 0x200f, 0x061c].map((code) => String.fromCodePoint(code));

describe('formatDay', () => {
  it('writes the day it was given, wherever the machine reading it stands', () => {
    // The three figures and nothing else. Read in the machine's own zone this
    // would be 19 September, which is not a day anybody wrote down.
    expect(formatDay(day('2026-09-20'), 'en-GB')).toBe('20/09/2026');
    expect(formatDay(day('2026-01-01'), 'en-GB')).toBe('01/01/2026');
    expect(formatDay(day('2026-12-31'), 'en-GB')).toBe('31/12/2026');
  });

  it('writes the figures in the reader’s own digits — §5.5', () => {
    expect(formatDay(day('2026-09-20'), 'ar-u-nu-arab')).toContain('٢٠٢٦');
    expect(formatDay(day('2026-09-20'), 'ar-u-nu-latn')).toContain('2026');
  });

  it('strips the marks that would reorder it inside a right-to-left sentence — §9', () => {
    // `ar` puts a right-to-left mark before each slash. Those marks are strong
    // characters: in the left-to-right run a date is, they pull the year beside
    // the day and push the separators to the far end, so `20/09/2026` reads
    // `20 2026/09/`.
    const written = formatDay(day('2026-09-20'), 'ar');
    expect(written).not.toBe('');
    for (const mark of DIRECTION_MARKS) expect(written.includes(mark)).toBe(false);
  });
});

describe('formatMoment', () => {
  const at = new Date('2026-09-20T22:30:15Z');

  it('writes an instant in the zone it is read in, and says which zone that was', () => {
    // The same instant, two shops: half past one in the morning of the next
    // day in Damascus, half past four the previous afternoon in Denver. A
    // moment with no zone beside it is the pair of figures a reconciliation
    // turns on, written down without the one fact that tells them apart.
    const damascus = formatMoment(at, { locale: 'en-GB', timeZone: 'Asia/Damascus' });
    const denver = formatMoment(at, { locale: 'en-GB', timeZone: 'America/Denver' });

    expect(damascus).toContain('21/09/2026');
    expect(denver).toContain('20/09/2026');
    for (const written of [damascus, denver]) expect(written).toMatch(/GMT|UTC|[+-]\d/u);
    expect(damascus).not.toBe(denver);
  });

  it('shows the clock to the minute, and to the second only when asked', () => {
    const minute = formatMoment(at, { locale: 'en-GB', timeZone: 'Asia/Damascus' });
    const second = formatMoment(at, {
      locale: 'en-GB',
      timeZone: 'Asia/Damascus',
      precision: 'second',
    });

    expect(minute).toContain('01:30');
    expect(minute).not.toContain('01:30:15');
    expect(second).toContain('01:30:15');
  });

  it('drops the clock entirely at date precision, and with it the zone in the text', () => {
    // Which is why `DateTime` puts the zone beside a date-only moment itself:
    // there is no clock left for `Intl` to attach it to, and the day a moment
    // fell on still depends on where it is read.
    const written = formatMoment(at, {
      locale: 'en-GB',
      timeZone: 'Asia/Damascus',
      precision: 'date',
    });

    expect(written).toBe('21/09/2026');
  });

  it('strips the same direction marks a day is stripped of — §9', () => {
    const written = formatMoment(at, { locale: 'ar', timeZone: 'Asia/Damascus' });
    for (const mark of DIRECTION_MARKS) expect(written.includes(mark)).toBe(false);
  });
});
