import type { RecordSession } from './price-lists.js';

/**
 * The keys under one prefix, found by bisection rather than by filtering.
 *
 * Every store this module runs on lists its keys sorted — the PostgreSQL and
 * SQLite drivers keep the listing in order, and the memory store sorts it — and
 * a review of thirty thousand items walks prefixes of a store several times
 * that size a page at a time. Filtering the whole listing for every page was a
 * pass over every record in the shop per page; this is two searches and a
 * slice of the part asked for.
 *
 * `from`, when given, is where to begin within the prefix: the first key at or
 * after it.
 */
export function within(
  session: RecordSession,
  prefix: string,
  from: string = prefix,
): readonly string[] {
  const { keys, start, end } = range(session, prefix, from);
  return start >= end ? [] : keys.slice(start, end);
}

/**
 * Where the keys under a prefix sit in the store's listing, from `from` on —
 * positions rather than a copy, for a walk that stops after a page. Copying
 * everything after a cursor to read the next fifty was a copy of the whole
 * remainder per page, which over a task of a hundred thousand prices is
 * quadratic in exactly the case paging exists for.
 */
export function range(
  session: RecordSession,
  prefix: string,
  from: string = prefix,
): { readonly keys: readonly string[]; readonly start: number; readonly end: number } {
  const keys = session.keys();
  return {
    keys,
    start: firstAtOrAfter(keys, from < prefix ? prefix : from),
    end: firstAtOrAfter(keys, `${prefix}\u{10FFFF}`),
  };
}

/** The keys under a prefix strictly after one of them, in order: the page after a cursor. */
export function* after(
  session: RecordSession,
  prefix: string,
  key: string | null,
): Generator<string> {
  const { keys, start, end } = range(session, prefix, key ?? prefix);
  for (let at = start; at < end; at += 1) {
    const found = keys[at];
    if (found === undefined || found === key) continue;
    yield found;
  }
}

function firstAtOrAfter(keys: readonly string[], key: string): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((keys[middle] ?? '') < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** A sequence as it is written into a key: zero-padded, so text order is number order. */
export const padded = (sequence: number): string => String(sequence).padStart(16, '0');
