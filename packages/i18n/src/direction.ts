/**
 * Which way a locale is written.
 *
 * `SYS-01` makes Arabic the primary interface with English optional, and
 * `design-system.md` §9 makes direction a consequence of the locale rather
 * than a flag beside it — `ar` is right-to-left because it is Arabic, not
 * because something was switched on. This is where that consequence is drawn,
 * once, so that every surface that has to state a direction — the document
 * element, a printed receipt, an exported document — draws the same one.
 *
 * A stated table rather than `Intl.Locale.prototype.textInfo`. That property is
 * the principled source and it does return the right answer on Node 24, but
 * TypeScript 6.0 does not declare it even under `lib: ESNext`, so reaching it
 * would take an assertion over an API this workspace cannot type-check. Between
 * an unchecked assertion and a table of fourteen language subtags that a test
 * can enumerate exhaustively, the table is the one that cannot quietly become
 * wrong.
 */
export type Direction = 'rtl' | 'ltr';

/**
 * Scripts written right to left, by their ISO 15924 subtag.
 *
 * Checked before the language, because the script subtag overrides it: Kurdish
 * is `ckb-Arab` in Iraq and `ku-Latn` in Turkey, and the same language is
 * written in both directions depending on which.
 */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
  'adlm',
  'arab',
  'aran',
  'hebr',
  'mand',
  'nkoo',
  'rohg',
  'samr',
  'syrc',
  'thaa',
  'yezi',
]);

/**
 * Languages written right to left when no script subtag says otherwise.
 *
 * `iw` and `ji` are the superseded tags for Hebrew and Yiddish; they still
 * arrive from older systems, and an import that renders backwards is a worse
 * outcome than two extra entries.
 */
const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  'ar',
  'ckb',
  'dv',
  'fa',
  'he',
  'iw',
  'ji',
  'nqo',
  'ps',
  'sd',
  'syr',
  'ug',
  'ur',
  'yi',
]);

/** True when the subtag is a script: four letters, in the position after the language. */
function isScript(subtag: string): boolean {
  return subtag.length === 4 && /^[a-z]{4}$/.test(subtag);
}

/**
 * A singleton — one character — opens an extension or the private-use
 * section, and nothing after it is a script. `en-u-nu-arab` asks for
 * Arabic-Indic digits in English, and `arab` there is a numbering system, not
 * the script the interface is written in; `formattingLocale` produces exactly
 * that tag for the numeral setting, so the shape is not hypothetical.
 */
function isSingleton(subtag: string): boolean {
  return subtag.length === 1;
}

/**
 * The direction a locale is written in.
 *
 * Unknown and malformed tags read as left-to-right. That is the safe default in
 * both senses: it is what the overwhelming majority of unrecognised tags
 * actually are, and a Latin interface rendered right-to-left is a stranger
 * failure to diagnose than the reverse.
 */
export function directionOf(locale: string): Direction {
  const subtags = locale.trim().toLowerCase().split(/[-_]/);
  const language = subtags[0] ?? '';

  // Only the part of the tag before the first singleton can carry a script:
  // language, extlangs, script, region and variants, in that order (BCP 47).
  const core = subtags.slice(1);
  const extensionsFrom = core.findIndex(isSingleton);
  const script = (extensionsFrom === -1 ? core : core.slice(0, extensionsFrom)).find(isScript);
  if (script !== undefined) {
    return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  }

  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}
