/**
 * Matching what somebody typed against a place's own words.
 *
 * Folded the way `SYS` folds a name, and for the same reason: Arabic is written
 * with marks that two keyboards encode differently, and a search that compared
 * bytes would fail to find a branch whose name is on the screen in front of the
 * person typing it. The **tatweel** goes too — it is a typographic stretch with
 * no sound, inserted for justification, and nobody types it when searching.
 *
 * This asks nothing of anybody. It narrows what the screen already holds, which
 * is why it works with the line down and answers on the keystroke.
 */

/**
 * Marks that are written and never typed into a search box.
 *
 * `\p{Mn}` — every non-spacing mark — rather than a hand-written range of
 * Arabic code points: the ranges are easy to get subtly wrong, the property is
 * maintained by Unicode itself, and a tenant whose names carry marks from
 * another script gets the same courtesy for free. The tatweel joins them
 * explicitly because it is a letter-width stretch rather than a mark: it has no
 * sound, it is inserted to justify a line, and nobody searches for one.
 */
const DECORATION = /[\p{Mn}\u0640]/gu;

export function fold(value: string): string {
  return value.normalize('NFC').replace(DECORATION, '').trim().toLowerCase();
}

/** True when the needle appears anywhere in any of the place's own words. */
export function matchesPlace(query: string, ...words: readonly (string | undefined)[]): boolean {
  const needle = fold(query);
  if (needle === '') return false;
  return words.some((word) => word !== undefined && fold(word).includes(needle));
}
