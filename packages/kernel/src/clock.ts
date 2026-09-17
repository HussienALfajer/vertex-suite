import { InvalidInstantError, InvalidTimeZoneError } from './errors.js';

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
