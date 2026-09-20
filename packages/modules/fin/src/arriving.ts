import {
  Dec,
  isId,
  localDate,
  ok,
  parseId,
  refuse,
  type Id,
  type LocalDate,
  type Money,
  type Refusal,
  type Result,
} from '@vertex/kernel';

/**
 * Values as they may actually arrive, judged.
 *
 * Every field this module is handed is read as `unknown` before it is believed:
 * the type is gone at run time, and a command reaches `FIN` off a wire, out of
 * a queue `SYN-02` replays, and from a screen somebody wrote in a hurry. The
 * judgements below are the ones more than one part of the module makes, so
 * they are made in one place — a name accepted here and refused there is the
 * kind of disagreement nobody finds by reading.
 */

/**
 * What arrived, for a refusal to show: the value itself when it can be shown,
 * and otherwise what kind of thing it was — an object rendered by its default
 * form says nothing to the person reading the refusal.
 */
export function shown(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
    case 'undefined':
    case 'object':
    case 'function':
      return typeof value;
  }
}

/**
 * Something a person wrote, trimmed — or null, for anything that is not.
 *
 * Letters, and not punctuation or a bare figure standing in for words. The
 * standard the exemption comments in `tools/` and the override reason in `FX`
 * are held to, and here because an account named `5400` is an account with no
 * name — the code already says that — and a period reopened "for `.`" is a
 * reason nobody can review.
 */
export function written(value: unknown): string | null {
  if (typeof value !== 'string' || !/\p{L}/u.test(value)) return null;
  return value.trim();
}

/**
 * A day as it may actually arrive: the brand is gone at run time, and a day
 * reaches this module from a screen, off a wire and out of `SYN-02`'s replay.
 * One spelling only — see `localDate` in `@vertex/kernel`.
 */
export function dayArriving(day: unknown): Result<LocalDate, Refusal<'fin.day-invalid'>> {
  const read = localDate(day as string);
  return read === null ? refuse('fin.day-invalid', { day: shown(day) }) : ok(read);
}

/**
 * An identifier as it may actually arrive, read in the one case every record is
 * filed under — a UUID is case-insensitive by specification, and stored lower.
 * Null for anything that names nothing.
 */
export function idArriving<Kind extends string>(value: unknown): Id<Kind> | null {
  return typeof value === 'string' && isId(value) ? parseId<Kind>(value) : null;
}

/**
 * A caller's reference to its own document, in one spelling: trimmed, and —
 * when it is an identifier — in the case every record is filed under. Empty
 * for anything that is not a reference at all.
 *
 * `SYS` reads a document reference the same way, for the same reason: the same
 * sale replayed with its identifier upper-cased must find the entry it already
 * has, and the journal asked about it in either spelling must answer the same.
 */
export function referenceArriving(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return idArriving(trimmed) ?? trimmed;
}

/**
 * Money as it may actually arrive, or null for anything that is not.
 *
 * The kernel's `Money` is an object holding a decimal, and off a wire it comes
 * back as an object holding the decimal's insides: `{ d, e, s }`, which adds
 * nothing to anything. So what is accepted is a finite decimal the kernel
 * recognises as one, and a currency code that is a string; a figure that
 * arrived any other way is refused where it arrived, never carried into a line.
 */
export function moneyArriving(value: unknown): Money | null {
  if (typeof value !== 'object' || value === null) return null;
  const { amount, currency } = value as { readonly amount?: unknown; readonly currency?: unknown };
  if (typeof currency !== 'string' || !Dec.isDecimal(amount) || !amount.isFinite()) return null;
  return { amount, currency };
}
