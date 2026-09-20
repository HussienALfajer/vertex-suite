/**
 * Values as they may actually arrive, judged.
 *
 * Every field this module is handed is read as `unknown` before it is believed:
 * the type is gone at run time, and a command reaches `FIN` off a wire, out of
 * a queue `SYN-02` replays, and from a screen somebody wrote in a hurry. The
 * two judgements below are the ones more than one part of the module makes, so
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
