import type { TenantId } from '@vertex/contracts';
import type { Category, CategoryId, ItemId } from './contract.js';

/**
 * Text as a search compares it (`CAT-15`): one spelling for every way a word
 * reaches a keyboard.
 *
 * - **Diacritics.** A label printed `حَلِيب` and a cashier typing `حليب` mean
 *   the same milk. Compatibility decomposition splits every vowel mark,
 *   shadda, sukun and dagger alef off its letter, and every non-spacing mark
 *   is then dropped — Latin accents with them, so `café` is `cafe`.
 * - **Hamza and alef forms.** The same decomposition turns `أ إ آ` into a bare
 *   alef and `ؤ ئ` into their seats, because Unicode spells each as the seat
 *   plus a combining hamza or madda. Alef wasla and the wavy-hamza alefs have
 *   no decomposition and are folded by name; a hamza on the line is dropped,
 *   since `ماء` is typed `ما` as often as not.
 * - **Taa marbuta and alef maqsura.** `ة` is typed `ه` and `ى` is typed `ي`
 *   constantly, in both directions; each pair is one letter here.
 * - **Keyboards.** A Persian or Urdu layout sends its own yeh and kaf, and an
 *   Arabic one sends Arabic-Indic digits; each is folded to the letter or
 *   digit it stands for. Presentation forms and ligatures (`ﻻ`, `ﷲ`) are
 *   decomposed with everything else.
 * - **Tatweel, direction marks and punctuation** are not part of a word.
 *   Anything that is neither letter nor digit separates words, which is also
 *   what keeps a tab or a newline out of the index lines below.
 *
 * Case is folded first, so that a capital whose lower case decomposes (`İ`)
 * loses its mark with the rest.
 */
export function searchable(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\p{Mn}\p{Cf}\u0640\u0621]/gu, '')
    .replace(/[\u0671-\u0673\u0649\u06cc\u06a9\u0629\u0660-\u0669\u06f0-\u06f9]/gu, folded)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function folded(letter: string): string {
  const point = letter.codePointAt(0) ?? 0;
  if (point >= 0x660 && point <= 0x669) return String(point - 0x660);
  if (point >= 0x6f0 && point <= 0x6f9) return String(point - 0x6f0);
  return FOLDS[letter] ?? letter;
}

// Written as escapes: several of these are drawn identically to the letter
// they fold to, and a table of look-alikes cannot be checked by eye.
const FOLDS: Readonly<Record<string, string>> = {
  '\u0671': '\u0627', // alef wasla → alef
  '\u0672': '\u0627', // alef with wavy hamza above → alef
  '\u0673': '\u0627', // alef with wavy hamza below → alef
  '\u0649': '\u064a', // alef maqsura → yeh
  '\u06cc': '\u064a', // Persian yeh → yeh
  '\u06a9': '\u0643', // keheh → kaf
  '\u0629': '\u0647', // taa marbuta → heh
};

/** The longest term a search accepts: a name and a code, not a paragraph. */
export const SEARCH_LENGTH = 100;
/** How many items one answer carries, unless the caller asks for fewer. */
export const SEARCH_LIMIT = 50;
/** The most one answer may carry: a screen of results, not the catalogue. */
export const SEARCH_LIMIT_MAX = 200;

/**
 * What the index holds of one item: its identity and category, and the three
 * texts a term may be found in, each already `searchable`.
 */
export interface IndexEntry {
  readonly id: ItemId;
  readonly category: CategoryId;
  readonly name: string;
  readonly code: string;
  /**
   * Every active code, as registered and in the form it is unique in, each
   * `searchable` and joined by `|` — a character `searchable` never leaves in
   * a text, so no word can be found across two codes and each can still be
   * compared whole.
   */
  readonly barcodes: string;
}

/**
 * One of the tenant's index shards, as stored: a line per item.
 *
 * Lines rather than an object per item, and that is the whole point of the
 * shape. The index is read in full by every search, and parsing thirty
 * thousand small objects out of JSON costs several times what reading the same
 * characters as one string does — the difference between a comfortable margin
 * under `CAT-15`'s 150 ms and none on a slower till. A line is
 * `id⇥category⇥name⇥code⇥barcodes`; `searchable` guarantees that none of the
 * texts can contain a tab or a newline.
 */
export interface IndexShard {
  readonly tenant: TenantId;
  readonly entries: string;
}

/**
 * Items are spread over a fixed set of shards by the last two hex digits of
 * their identifier, which in a UUIDv7 are random. Enough that writing one item
 * rewrites a few kilobytes rather than the whole index, and that two managers
 * editing two items rarely touch the same record; few enough that reading all
 * of them is one pass over a short list of keys.
 */
export const SHARDS = 256;

export function shardOf(id: ItemId): string {
  return id.slice(-2).toLowerCase();
}

export function shardNames(): readonly string[] {
  return Array.from({ length: SHARDS }, (_, at) => at.toString(16).padStart(2, '0'));
}

export function lineOf(entry: IndexEntry): string {
  return [entry.id, entry.category, entry.name, entry.code, entry.barcodes].join('\t');
}

/** The shard's lines with the item's own replaced by `line`, or removed when it is null. */
export function withLine(entries: string, id: ItemId, line: string | null): string {
  const lines = entries === '' ? [] : entries.split('\n');
  const kept = lines.filter((one) => !one.startsWith(`${id}\t`));
  if (line !== null) kept.push(line);
  return kept.join('\n');
}

/**
 * The same word with the definite article, and without it.
 *
 * `الحليب` is how a person says milk and `حليب` is how a label often prints it,
 * so a term that starts with `ال` also matches its stem — when the stem is
 * still a word of three letters or more, so that `اله` (a folded `آلة`) does
 * not become the single letter that is in half the catalogue.
 */
const ARTICLE = '\u0627\u0644';

function spellings(token: string): readonly string[] {
  return token.startsWith(ARTICLE) && token.length >= 5 ? [token, token.slice(2)] : [token];
}

function contains(text: string, forms: readonly string[]): boolean {
  return forms.some((form) => text.includes(form));
}

/**
 * How well an item answers, best first. An exact code or barcode is someone
 * who knows which item they mean; a name that begins with what was typed is
 * the item they are spelling; anything else found in the item itself comes
 * next; an item that answers only because of its category comes last.
 */
const EXACT = 0;
const NAME_START = 1;
const OWN_TEXT = 2;
const THROUGH_CATEGORY = 3;

interface Match {
  readonly id: ItemId;
  readonly rank: number;
  readonly name: string;
}

export interface Matches {
  readonly ids: readonly ItemId[];
  readonly total: number;
}

/**
 * The items a term finds, ranked, and how many there were.
 *
 * Every word of the term must be found — in the item's name, code or active
 * barcodes, or in the name of its category or any category above it — and a
 * word is found when it appears anywhere, so a part of a word finds the whole.
 * A term with no words finds every item, in name order: the list a screen
 * shows before anybody has typed.
 */
export function match(
  shards: readonly string[],
  categories: readonly Category[],
  term: string,
  limit: number,
): Matches {
  const whole = searchable(term);
  const tokens = [...new Set(whole.split(' ').filter((one) => one !== ''))];
  const forms = tokens.map(spellings);
  const names = new Map(categories.map((one) => [one.id, searchable(one.name)]));
  const through = forms.map((one) => categoriesMatching(categories, names, one));
  const found: Match[] = [];
  for (const entries of shards) {
    // A shard in which some word appears nowhere, and which no category could
    // answer for, holds no match; most shards are passed over here.
    if (forms.some((one, at) => through[at]?.size === 0 && !contains(entries, one))) continue;
    for (const line of entries.split('\n')) {
      if (forms.some((one, at) => through[at]?.size === 0 && !contains(line, one))) continue;
      const [id = '', category = '', name = '', code = '', barcodes = ''] = line.split('\t');
      const own = `${name}\t${code}\t${barcodes}`;
      let rank = OWN_TEXT;
      let matched = true;
      for (let at = 0; at < forms.length && matched; at += 1) {
        const one = forms[at] ?? [];
        if (contains(own, one)) continue;
        if (through[at]?.has(category as CategoryId)) rank = THROUGH_CATEGORY;
        else matched = false;
      }
      if (!matched) continue;
      const first = tokens[0];
      if (first !== undefined && rank === OWN_TEXT) {
        if (code === whole || barcodes.split('|').includes(whole)) rank = EXACT;
        else if (name.startsWith(first)) rank = NAME_START;
      }
      found.push({ id: id as ItemId, rank, name });
    }
  }
  return { ids: best(found, limit).map((one) => one.id), total: found.length };
}

/**
 * Best first: by rank, then by name, then by identity so that equal names
 * keep one order. Code-point order is alphabetical order for folded Arabic —
 * the Unicode block follows the hija'i sequence — which a collator would only
 * repeat at many times the cost.
 */
function before(a: Match, b: Match): boolean {
  if (a.rank !== b.rank) return a.rank < b.rank;
  if (a.name !== b.name) return a.name < b.name;
  return a.id < b.id;
}

/**
 * The first `limit` matches in order, without ordering the rest.
 *
 * An empty term matches the whole catalogue, and sorting thirty thousand
 * names to show fifty was most of what such a search cost. Kept here instead
 * is a sorted list no longer than the answer: a match that cannot beat its
 * last entry — nearly every one, once it is full — costs a single comparison.
 */
function best(found: readonly Match[], limit: number): readonly Match[] {
  const kept: Match[] = [];
  for (const one of found) {
    const last = kept.at(-1);
    if (kept.length === limit && last !== undefined && !before(one, last)) continue;
    let low = 0;
    let high = kept.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const probe = kept[middle];
      if (probe !== undefined && before(probe, one)) low = middle + 1;
      else high = middle;
    }
    kept.splice(low, 0, one);
    if (kept.length > limit) kept.pop();
  }
  return kept;
}

/**
 * The categories a word names — itself or through an ancestor, so that
 * `ألبان` finds the milk filed under `ألبان › طازجة`.
 */
function categoriesMatching(
  categories: readonly Category[],
  names: ReadonlyMap<CategoryId, string>,
  forms: readonly string[],
): ReadonlySet<CategoryId> {
  const byId = new Map(categories.map((one) => [one.id, one]));
  const hit = new Set<CategoryId>();
  for (const category of categories) {
    const seen = new Set<CategoryId>();
    for (let cursor: Category | undefined = category; cursor !== undefined;) {
      if (seen.has(cursor.id)) break;
      seen.add(cursor.id);
      if (contains(names.get(cursor.id) ?? '', forms)) {
        hit.add(category.id);
        break;
      }
      cursor = cursor.parent === null ? undefined : byId.get(cursor.parent);
    }
  }
  return hit;
}
