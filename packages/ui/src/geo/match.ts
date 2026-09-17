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

/**
 * Letters written more than one way that a search should treat as one.
 *
 * Decomposed first, because a composed letter is not a mark: `é` and `أ` kept
 * their accent and hamza through `NFC`, so "cafe" missed "café" and "احمد"
 * missed "أحمد". Then the Arabic letters people spell interchangeably when
 * typing quickly: the hamza seats of alef, a final taa marbuta written as haa,
 * and an alef maksura written as yaa.
 */
/** Code points rather than letters, so that a character's identity is not left to a font. */
const SPELLINGS: ReadonlyMap<number, number> = new Map([
  [0x0623, 0x0627], // alef with hamza above, as alef
  [0x0625, 0x0627], // alef with hamza below, as alef
  [0x0622, 0x0627], // alef with madda, as alef
  [0x0671, 0x0627], // alef wasla, as alef
  [0x0629, 0x0647], // taa marbuta, as haa
  [0x0649, 0x064a], // alef maksura, as yaa
]);

export function fold(value: string): string {
  const bare = value.normalize('NFD').replace(DECORATION, '').normalize('NFC');
  let spelled = '';
  for (const letter of bare) {
    const code = letter.codePointAt(0) ?? 0;
    spelled += String.fromCodePoint(SPELLINGS.get(code) ?? code);
  }
  return spelled.trim().toLowerCase();
}

/** True when the needle appears anywhere in any of the place's own words. */
export function matchesPlace(query: string, ...words: readonly (string | undefined)[]): boolean {
  const needle = fold(query);
  if (needle === '') return false;
  return words.some((word) => word !== undefined && fold(word).includes(needle));
}
