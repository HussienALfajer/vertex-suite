import { isOnEarth } from './projection.js';

/**
 * A place read out of whatever somebody pasted (`SYS-14`).
 *
 * This is the path most shop owners will actually take. They already have the
 * place open on their phone, they share it the way they share everything else,
 * and what arrives in the back office is a maps link in a message. Typing two
 * numbers off a screen is the slow way round; this makes the fast way work.
 *
 * It resolves **nothing over the network**, which is the whole point: a link
 * whose coordinates are in the text is read from the text, and a link that
 * hides them behind a redirect is reported as exactly that, so the person is
 * told what to do instead of being shown a silent failure.
 */

/** Three outcomes, named, because each one is a different thing to say. */
export type ParsedPlace =
  | { readonly kind: 'point'; readonly lat: string; readonly lng: string }
  /**
   * A shortened link — `maps.app.goo.gl`, `goo.gl/maps`. The coordinates exist
   * only at the other end of a redirect, and following it would be this
   * product asking a third party where a tenant's shop is. It is refused as a
   * matter of design, not of effort, and the screen says how to get the long
   * form instead.
   */
  | { readonly kind: 'shortened' }
  | { readonly kind: 'none' };

const ARABIC_INDIC = 0x0660;
const EXTENDED_ARABIC_INDIC = 0x06f0;

/**
 * The same digits, whichever keyboard typed them.
 *
 * §5.5 makes Arabic-Indic digits a display setting that never affects a stored
 * value — so a field that could not read them back would be a field that
 * refuses what the screen beside it just rendered. The Arabic decimal and
 * thousands separators travel with them.
 */
function westernDigits(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC && code <= ARABIC_INDIC + 9) {
      out += String(code - ARABIC_INDIC);
    } else if (code >= EXTENDED_ARABIC_INDIC && code <= EXTENDED_ARABIC_INDIC + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC);
    } else if (character === '\u066b') {
      out += '.';
    } else if (character === '\u066c') {
      // A thousands separator has no business inside a coordinate, and dropping
      // it is kinder than refusing the paste over a character nobody typed
      // deliberately.
      continue;
    } else if (character === '\u060c') {
      out += ',';
    } else {
      out += character;
    }
  }
  return out;
}

const SHORTENED = /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i;

const NUMBER = String.raw`[+-]?\d{1,3}(?:\.\d+)?`;

/**
 * In order of how sure each one is, because a maps URL contains several numbers
 * and only some of them are the place.
 *
 * `@lat,lng,zoom` is where the map is centred. `!3d…!4d…` is the pin itself,
 * which is the better answer when a URL carries both — so it is tried first.
 */
const PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`),
  new RegExp(String.raw`[?&](?:q|ll|query|center|daddr|destination)=(${NUMBER})\s*,\s*(${NUMBER})`),
  new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`),
  new RegExp(String.raw`^geo:(${NUMBER}),(${NUMBER})`),
  // OpenStreetMap's own links: `#map=17/lat/lng`, and a marker's `mlat`/`mlon`.
  new RegExp(String.raw`#map=\d{1,2}(?:\.\d+)?/(${NUMBER})/(${NUMBER})`),
  new RegExp(String.raw`[?&]mlat=(${NUMBER})&mlon=(${NUMBER})`),
  new RegExp(String.raw`^\s*(${NUMBER})\s*[,;\s]\s*(${NUMBER})\s*$`),
];

/**
 * Trims a decimal the way a person would read it back: no `+`, no leading
 * zeros that carry nothing, and never an empty string where a zero belongs.
 */
function written(value: string): string {
  const signed = value.startsWith('+') ? value.slice(1) : value;
  const negative = signed.startsWith('-');
  const digits = (negative ? signed.slice(1) : signed).replace(/^0+(?=\d)/, '');
  // A sign carried by an all-zero magnitude is not a place a metre west of the
  // prime meridian, it is "-0" — the exact string `sys/place.ts`'s own guard
  // exists to prevent, reachable here first because that guard runs at save,
  // not at paste.
  const isZero = /^0*\.?0*$/.test(digits);
  return `${negative && !isZero ? '-' : ''}${digits}`;
}

/**
 * The text as a person meant it.
 *
 * Two things a paste carries that nobody typed. Invisible format characters —
 * a right-to-left mark copied out of an Arabic interface around a pair of
 * numbers — which neither `trim` nor `\s` removes, so `\u200f33.51, 36.27`
 * read as nothing. And an encoded comma: the links messaging and search apps
 * share write `33.51%2C36.27`, which no pattern here would otherwise see.
 */
function unwrapped(text: string): string {
  const visible = text.replace(/\p{Cf}/gu, '');
  try {
    return decodeURIComponent(visible);
  } catch {
    return visible;
  }
}

export function parsePlace(text: string): ParsedPlace {
  const normalised = westernDigits(unwrapped(text)).trim();
  if (normalised === '') return { kind: 'none' };

  for (const pattern of PATTERNS) {
    const found = pattern.exec(normalised);
    const lat = found?.[1];
    const lng = found?.[2];
    if (lat === undefined || lng === undefined) continue;
    // The store's own refusal is what decides whether a point may be saved
    // (`sys/place.ts`). The check here decides something narrower: whether the
    // picker can put a marker on it at all. A pair it cannot draw is a pair it
    // has not understood, so it keeps looking.
    if (!isOnEarth(Number(lat), Number(lng))) continue;
    return { kind: 'point', lat: written(lat), lng: written(lng) };
  }

  return SHORTENED.test(normalised) ? { kind: 'shortened' } : { kind: 'none' };
}
