import { InvalidDayError, InvalidInstantError, InvalidTimeZoneError } from './errors.js';

/**
 * Time, as a value, and the clock that produces it.
 *
 * Nothing in this system reads the ambient clock. Every figure that carries a
 * moment — a sale, a shift, a rate revision, an outbox entry — takes it from a
 * `Clock` it was handed, and the lint rules ban `Date.now()` and a
 * zero-argument `new Date()` everywhere except the one implementation below.
 *
 * That is not testing hygiene. A register runs for years on a machine whose
 * clock nobody checks; the store node is the only thing in the shop that knows
 * the real time. Code that reads `Date.now()` directly cannot be corrected when
 * that drift is discovered, because there is no seam to correct it at.
 */

declare const InstantBrand: unique symbol;

/**
 * A moment, as whole milliseconds since the Unix epoch, UTC.
 *
 * A branded number rather than a `Date`: a `Date` is mutable, carries a
 * timezone it does not actually store, and compares by identity. An instant
 * sorts with `<`, serialises as an integer, and cannot be confused with a
 * duration, a count, or any other number, because the brand does not exist
 * anywhere else.
 *
 * Milliseconds are the precision the product needs. Ordering finer than that —
 * two events within the same millisecond — is settled by the monotonic counter
 * inside the identifier (`id.ts`), not by a more precise timestamp.
 */
export type Instant = number & { readonly [InstantBrand]: 'Instant' };

/**
 * The range `Date` itself represents: ±100,000,000 days around the epoch.
 * Beyond it, conversion to a `Date` silently produces an invalid one.
 */
const MAX_EPOCH_MILLIS = 8_640_000_000_000_000;

/** Constructs an instant from whole milliseconds since the epoch. */
export function instant(epochMillis: number): Instant {
  if (!Number.isInteger(epochMillis)) {
    throw new InvalidInstantError(
      `An instant is whole milliseconds since the epoch; received ${String(epochMillis)}.`,
    );
  }
  if (epochMillis < -MAX_EPOCH_MILLIS || epochMillis > MAX_EPOCH_MILLIS) {
    throw new InvalidInstantError(
      `${String(epochMillis)} is outside the range a date can represent.`,
    );
  }
  return epochMillis as Instant;
}

/** The instant a `Date` stands for. Rejects an invalid date rather than propagating `NaN`. */
export function instantFrom(date: Date): Instant {
  const millis = date.getTime();
  if (Number.isNaN(millis)) {
    throw new InvalidInstantError('An invalid Date has no instant.');
  }
  return instant(millis);
}

/**
 * The instant as a `Date`, for the one boundary that requires one: `Intl`, and
 * therefore the `DateTime` display contract of `design-system.md` §12.
 */
export function toDate(value: Instant): Date {
  return new Date(value);
}

/** ISO 8601 in UTC — the form written to logs, the outbox and any wire. */
export function toISOString(value: Instant): string {
  return new Date(value).toISOString();
}

export function compareInstants(a: Instant, b: Instant): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function plusMillis(value: Instant, millis: number): Instant {
  return instant(value + millis);
}

/** How many milliseconds `to` is after `from`. Negative when it is before. */
export function millisBetween(from: Instant, to: Instant): number {
  return to - from;
}

/** A source of the current time. The only way any code in this system learns it. */
export interface Clock {
  now(): Instant;
}

/**
 * The machine's own clock. The single place `Date.now()` is called.
 *
 * On the store node this is the truth. On a register it is a claim, corrected
 * by `offsetClock` rather than by writing to the operating system's clock —
 * which needs administrator rights the cashier does not have, and would drag
 * every other program on the machine along with it.
 */
export const systemClock: Clock = Object.freeze({
  now(): Instant {
    return instant(Date.now());
  },
});

/**
 * A clock that reports another clock's time shifted by a fixed correction.
 *
 * The register measures its offset from the store node during sync and applies
 * it here, so a device whose clock is an hour out still stamps its documents
 * with the shop's time. The offset is a value the caller replaces on the next
 * sync; a clock does not negotiate for itself.
 */
export function offsetClock(base: Clock, offsetMillis: number): Clock {
  if (!Number.isInteger(offsetMillis)) {
    throw new InvalidInstantError(
      `A clock offset is whole milliseconds; received ${String(offsetMillis)}.`,
    );
  }
  return Object.freeze({
    now(): Instant {
      return instant(base.now() + offsetMillis);
    },
  });
}

/** A clock stopped at one moment. */
export function fixedClock(at: Instant): Clock {
  return Object.freeze({
    now(): Instant {
      return at;
    },
  });
}

/** A clock a test drives by hand. */
export interface ManualClock extends Clock {
  /** Moves the clock forward, or — deliberately permitted — backwards. */
  advance(millis: number): void;
  set(at: Instant): void;
}

/**
 * A clock under the test's control.
 *
 * It can be moved backwards on purpose: a shop machine's clock does go
 * backwards, when an operator corrects it or when time synchronisation steps
 * it back, and the behaviour of everything downstream of that is a thing this
 * product has to be able to prove rather than hope about.
 */
export function manualClock(at: Instant): ManualClock {
  let current = at;
  return {
    now(): Instant {
      return current;
    },
    advance(millis: number): void {
      current = plusMillis(current, millis);
    },
    set(next: Instant): void {
      current = next;
    },
  };
}

declare const LocalDateBrand: unique symbol;

/**
 * A calendar day as it is somewhere in particular: `2026-09-17`.
 *
 * Branded, like an instant, so that a day cannot be mistaken for any other
 * string. It sorts in date order as text, compares with `===` and serialises as
 * itself — and it is never a moment. "The rate for the seventeenth in Aleppo" is
 * a question about a day on a shop's own calendar, and the same instant is the
 * seventeenth in one branch and the eighteenth in another.
 */
export type LocalDate = string & { readonly [LocalDateBrand]: 'LocalDate' };

/**
 * The years a local date is written for. A year before the first has no
 * four-digit form, and `Intl` writes the fifth year before the era as a bare
 * `6` — a day that would sort, compare and read as a different one.
 */
const FIRST_YEAR = 1;
const LAST_YEAR = 9999;

/**
 * The canonical name of a time zone this runtime knows, or null.
 *
 * Canonical, so that `asia/damascus` typed by one administrator and
 * `Asia/Damascus` by another are stored as one zone. Surrounding whitespace is
 * not forgiven: a name is data somebody chose, and trimming it here would hide
 * whatever put the space there.
 *
 * The answer is this runtime's, from its own time-zone data. A machine whose
 * data is years old can refuse a zone a newer one accepted, or count a day with
 * a daylight rule the country abolished; that is a property of the machine,
 * and the store node's is the one that decides.
 */
export function timeZoneNamed(name: string): string | null {
  const given = name as unknown;
  if (typeof given !== 'string' || given === '' || given.trim() !== given) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: given }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * The calendar day an instant falls on in a time zone.
 *
 * Gregorian and in Western digits whatever the runtime's locale: this is a key
 * that rates are filed under and records are compared by, and a register whose
 * locale wrote the year in Arabic-Indic digits or in another calendar would file
 * the same day under a different key.
 */
export function localDateOf(at: Instant, timeZone: string): LocalDate {
  const moment = new Date(at);
  const year = moment.getUTCFullYear();
  if (year < FIRST_YEAR || year > LAST_YEAR) {
    throw new InvalidInstantError(
      `${toISOString(at)} is outside the years a calendar day is written for.`,
    );
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new InvalidTimeZoneError(`"${timeZone}" is not a time zone this runtime knows.`);
    }
    throw error;
  }

  const parts = formatter.formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((one) => one.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}` as LocalDate;
}

/**
 * A day as it is written, and the only spelling this system accepts: four
 * digits, two and two, zero-padded.
 */
const WRITTEN_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Midnight UTC on a day named by figures, with the figures allowed to run
 * over: month thirteen is January of the next year, and day zero is the last
 * of the month before. That roll-over is what the arithmetic below is built
 * out of, and what the parsing above detects by round-tripping through it.
 *
 * Built by `setUTCFullYear` rather than by `Date.UTC`, which reads a year below
 * one hundred as nineteen hundred and that — so the ninth year of the era would
 * silently become 1909, in a product whose days are compared as text.
 */
function midnightAt(year: number, month: number, day: number): Date {
  const moment = new Date(0);
  moment.setUTCFullYear(year, month - 1, day);
  moment.setUTCHours(0, 0, 0, 0);
  return moment;
}

/** The day a moment falls on in UTC, or null when it is not one this can write. */
function dayAt(moment: Date): LocalDate | null {
  const year = moment.getUTCFullYear();
  if (Number.isNaN(year) || year < FIRST_YEAR || year > LAST_YEAR) return null;
  const month = moment.getUTCMonth() + 1;
  const day = moment.getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(
    2,
    '0',
  )}` as LocalDate;
}

function orRaise(day: LocalDate | null, what: string): LocalDate {
  if (day === null) {
    throw new InvalidDayError(`${what} is outside the years a calendar day is written for.`);
  }
  return day;
}

/**
 * The day a text names, or null if it names none.
 *
 * Null rather than a throw, for the reason `timeZoneNamed` gives: a day arrives
 * from a person typing it, from a wire, or out of `SYN-02`'s replay, and the
 * module that asked is the one that owns the refusal. Exactly one spelling is
 * accepted — `2026-03-14`, and not `2026-3-14`, a slash, or a trailing space —
 * because a day is a key that records are filed under and compared by, and two
 * spellings of one day are two days.
 *
 * `2026-02-30` is written correctly and names no day; so is `2026-13-01`. Both
 * are rejected, by writing the day back out and requiring it to be the text
 * that came in.
 */
export function localDate(text: string): LocalDate | null {
  const given = text as unknown;
  if (typeof given !== 'string' || !WRITTEN_DAY.test(given)) return null;
  const [year, month, day] = given.split('-');
  return dayAt(midnightAt(Number(year), Number(month), Number(day))) === given
    ? (given as LocalDate)
    : null;
}

/**
 * The day these figures name.
 *
 * Throws where `localDate` answers null, because the figures were computed
 * rather than typed: a caller asking for the thirtieth of February has a defect
 * in the arithmetic that produced it, and rolling silently to the second of
 * March would hide it in a report nobody reconciles for a month.
 */
export function localDateFrom(year: number, month: number, day: number): LocalDate {
  const named = `${String(year)}-${String(month)}-${String(day)}`;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new InvalidDayError(`A calendar day is whole figures; received ${named}.`);
  }
  const written = orRaise(dayAt(midnightAt(year, month, day)), named);
  const parts = partsOfDay(written);
  if (parts.year !== year || parts.month !== month || parts.day !== day) {
    throw new InvalidDayError(`${named} names no day; it would be ${written}.`);
  }
  return written;
}

/** The three figures a calendar day is written from. */
export interface DayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * The figures a day is written from.
 *
 * Read from the text rather than through a `Date`, which is what makes it exact
 * for every year: the brand says the value came from one of the constructors
 * above, and each of those wrote it.
 */
export function partsOfDay(day: LocalDate): DayParts {
  const written = WRITTEN_DAY.exec(day);
  if (written === null) {
    throw new InvalidDayError(`"${day}" was not written as a calendar day.`);
  }
  const [, year, month, date] = written;
  return Object.freeze({ year: Number(year), month: Number(month), day: Number(date) });
}

/** The day a whole number of days after this one. Negative counts backwards. */
export function addDays(day: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) {
    throw new InvalidDayError(`A day moves by whole days; received ${String(days)}.`);
  }
  const parts = partsOfDay(day);
  return orRaise(
    dayAt(midnightAt(parts.year, parts.month, parts.day + days)),
    `${day} plus ${String(days)} day(s)`,
  );
}

/**
 * The day a whole number of months after this one, **clamped** to the end of
 * the month it lands in: the thirty-first of January plus one month is the
 * twenty-eighth of February, and plus two is the thirty-first of March.
 *
 * Clamping is the only total answer, and the clamp is why a range of months is
 * always computed from the day it started at and never by stepping one month at
 * a time. Stepping drifts — January the thirty-first stepped twice is the
 * twenty-eighth of March, a whole month short — and a fiscal year whose periods
 * drift is a set of books with three days belonging to nothing.
 */
export function addMonths(day: LocalDate, months: number): LocalDate {
  if (!Number.isInteger(months)) {
    throw new InvalidDayError(`A day moves by whole months; received ${String(months)}.`);
  }
  const parts = partsOfDay(day);
  const target = midnightAt(parts.year, parts.month + months, 1);
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  // Day zero of the month after is the last day of this one, February in a
  // leap year included.
  const last = midnightAt(year, month + 1, 0).getUTCDate();
  return orRaise(
    dayAt(midnightAt(year, month, Math.min(parts.day, last))),
    `${day} plus ${String(months)} month(s)`,
  );
}
