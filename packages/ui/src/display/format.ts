import { partsOfDay, type LocalDate } from '@vertex/kernel';

/**
 * Exact formatting for the display contracts of §12.
 *
 * The rule that shapes this file: a figure is never converted to a JavaScript
 * float on its way to the screen. `Intl.NumberFormat` accepts a decimal string
 * and formats it exactly, and that is the only path used here — passing
 * `Number(…)` would reintroduce, at the last possible moment, exactly the error
 * the kernel exists to prevent.
 */

export interface FormattedFigure {
  /** The figure as the locale writes it. */
  readonly text: string;
  /** True when the stored value carried more precision than was displayed. */
  readonly isRounded: boolean;
}

/** `Intl.NumberFormat` has accepted string input since ES2023; the lib types lag. */
interface StringFormatter {
  format: (value: string) => string;
}

export function formatExact(
  decimalString: string,
  decimals: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): FormattedFigure {
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...options,
  }) as unknown as StringFormatter;

  return {
    text: formatter.format(decimalString),
    isRounded: decimalPlacesOf(decimalString) > decimals,
  };
}

/** The decimal places actually present in an exact decimal string. */
export function decimalPlacesOf(decimalString: string): number {
  const dot = decimalString.indexOf('.');
  if (dot === -1) return 0;
  return decimalString.length - dot - 1;
}

/**
 * The marks `Intl` puts between the parts of an Arabic date.
 *
 * `ar` writes `19‏/09‏/2026` with a right-to-left mark in front of each slash,
 * which is right inside an Arabic sentence written by `Intl` and wrong
 * everywhere this product puts a date: inside an isolated left-to-right span
 * the marks are strong right-to-left characters in a left-to-right run, and the
 * bidirectional algorithm reorders whatever they touch — a date reads
 * `19 2026/09/`. Without them the run is digits and separators, which the
 * algorithm keeps together in either direction. Built from code points rather
 * than written as literals, because an invisible character in source is one
 * nobody can see was put there.
 */
const DIRECTION_MARKS = new RegExp(
  `[${[0x200e, 0x200f, 0x061c].map((code) => String.fromCodePoint(code)).join('')}]`,
  'gu',
);

/** The day, month and year, as the reader's own locale writes them. */
const DAY_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

/**
 * How much of a moment is written down.
 *
 * `date` drops the clock entirely, which is a different thing from a
 * `LocalDate`: this is still an instant, and which day it fell on depends on
 * the zone it is read in.
 */
export type MomentPrecision = 'date' | 'minute' | 'second';

/**
 * Why these two functions exist beside `DateTime` rather than only inside it.
 *
 * The same reason `formatExact` exists beside `Money`: a figure inside a
 * **sentence** cannot be an element — ICU interpolates text, and a message
 * split into fragments around a component has had its word order decided by
 * whoever wrote the code rather than by whoever translates it (§12). `DateTime`
 * renders these; a screen that puts a date inside a message calls them, and the
 * two cannot disagree about how this product writes a date.
 */

/**
 * A calendar day as the reader's locale writes it, in their own digits.
 *
 * Formatted in UTC, which is not a zone this day is in — it has none — but the
 * one arithmetic-free way to ask `Intl` to write these three figures. Any other
 * zone would shift midnight and print the day before.
 */
export function formatDay(day: LocalDate, locale: string): string {
  const { year, month, day: date } = partsOfDay(day);
  return new Intl.DateTimeFormat(locale, { ...DAY_PARTS, timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, date)))
    .replace(DIRECTION_MARKS, '');
}

/** A moment, in a stated zone, as the reader's locale writes it. */
export interface MomentFormat {
  readonly locale: string;
  /** An IANA zone. Required: a timestamp without a zone is a guess (§12). */
  readonly timeZone: string;
  readonly precision?: MomentPrecision;
}

/**
 * An instant as the reader's locale writes it, in the zone it is read in.
 *
 * The zone reaches the text itself rather than a label beside it — `Intl`'s own
 * `timeZoneName` — wherever a clock is shown, because a sentence saying when
 * somebody did something is read by whoever is reconciling what two branches
 * did on the same afternoon. At `date` precision there is no clock to place, so
 * the caller that needs the zone named puts it beside the text; `DateTime` is
 * the caller that does.
 */
export function formatMoment(value: Date, { locale, timeZone, precision }: MomentFormat): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...DAY_PARTS,
    ...(precision === 'date'
      ? {}
      : {
          hour: '2-digit',
          minute: '2-digit',
          ...(precision === 'second' ? { second: '2-digit' } : {}),
          timeZoneName: 'short',
        }),
  })
    .format(value)
    .replace(DIRECTION_MARKS, '');
}
