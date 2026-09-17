import IntlMessageFormat from 'intl-messageformat';

/**
 * Message resolution, and the terminology layer above it.
 *
 * Two rules from `design-system.md` §12 and `core-features.md` `SYS-08` meet
 * here:
 *
 * - **No user-facing string is a literal in code.** Every label, message and
 *   unit name comes from a catalogue.
 * - **A tenant may rename core concepts** — calling an item a "material" or a
 *   branch a "shop" — without any code change. That is a lookup *above* the
 *   catalogue, not a second catalogue: a tenant overrides a handful of terms,
 *   never a whole language.
 */

/** A flat catalogue: message key to ICU message. */
export type Catalogue = Readonly<Record<string, string>>;

/**
 * A tenant's renamings, keyed by term rather than by message.
 *
 * Terms are the nouns the business argues about — item, branch, supplier — and
 * a message refers to one with `{term:item}`. Overriding the term rewrites
 * every message that names it, which is the whole point: a tenant renames a
 * concept once, not two hundred strings.
 */
export type Terminology = Readonly<Record<string, string>>;

export type MessageValues = Readonly<Record<string, string | number | Date>>;

/**
 * Which digits a figure is **displayed** in.
 *
 * `design-system.md` §5.5: Western digits by default, Arabic-Indic as a
 * per-tenant display setting that never affects a stored value or a parse.
 */
export type Numerals = 'latn' | 'arab';

export interface TranslatorOptions {
  readonly locale: string;
  readonly catalogue: Catalogue;
  readonly terms?: Terminology;
  readonly tenantTerms?: Terminology;
  /** Defaults to `latn`, whatever the locale's own convention is — see `formattingLocale`. */
  readonly numerals?: Numerals;
  /**
   * Called when a key is missing, and what it returns is shown. Defaults to
   * throwing `MissingMessageError`: a missing string must be loud while it can
   * still be fixed. A host that would rather degrade once a shop is trading
   * says so here.
   */
  readonly onMissing?: (key: string) => string;
}

const TERM_PATTERN = /\{term:([a-zA-Z0-9_.-]+)\}/g;

export class MissingMessageError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`No message for "${key}".`);
    this.name = 'MissingMessageError';
    this.key = key;
  }
}

/**
 * The locale to hand to `Intl`, carrying the numeral choice.
 *
 * Stated explicitly for both choices rather than left to the locale. `ar`
 * happens to default to Western digits in current ICU data, but `ar-SY`, `ar-EG`
 * and `ar-SA` default to Arabic-Indic ones — so a translator built for the
 * market this product is sold in printed `١٢` inside a message while the money
 * beside it said `12`.
 *
 * Through `Intl.Locale` rather than by appending `-u-nu-…`: a locale that
 * already carries a Unicode extension (`ar-u-ca-gregory`) would otherwise become
 * a tag with two, which `Intl` refuses with a `RangeError` on every render.
 */
export function formattingLocale(locale: string, numerals: Numerals): string {
  return new Intl.Locale(locale, { numberingSystem: numerals }).toString();
}

export class Translator {
  readonly locale: string;
  readonly numerals: Numerals;
  readonly #options: TranslatorOptions;
  readonly #catalogue: Catalogue;
  readonly #formatting: string;
  readonly #terms: Terminology;
  readonly #onMissing: (key: string) => string;
  readonly #cache = new Map<string, IntlMessageFormat>();

  constructor(options: TranslatorOptions) {
    this.locale = options.locale;
    this.numerals = options.numerals ?? 'latn';
    this.#options = options;
    this.#catalogue = options.catalogue;
    this.#formatting = formattingLocale(options.locale, this.numerals);
    // The tenant's renamings sit above the product's own terms, so a tenant
    // that overrides nothing still gets a complete vocabulary.
    this.#terms = { ...options.terms, ...options.tenantTerms };
    this.#onMissing =
      options.onMissing ??
      ((key) => {
        throw new MissingMessageError(key);
      });
  }

  /**
   * The same catalogue and vocabulary, displaying figures in other digits.
   *
   * What a provider holding the tenant's numeral setting hands its screens, so
   * that a count inside a sentence and the money beside it are written alike.
   */
  withNumerals(numerals: Numerals): Translator {
    return numerals === this.numerals ? this : new Translator({ ...this.#options, numerals });
  }

  /**
   * The tenant's name for a concept, or the product's own.
   *
   * Own keys only. A plain object answers `constructor` and `toString` through
   * its prototype, and a message naming `{term:constructor}` printed a function.
   */
  term(name: string): string {
    return Object.hasOwn(this.#terms, name) ? (this.#terms[name] ?? name) : name;
  }

  /**
   * Formats a message.
   *
   * `{term:x}` placeholders resolve before ICU parsing, so a renamed concept
   * reaches the plural and select rules as its renamed form rather than as a
   * literal the rules cannot see.
   */
  format(key: string, values: MessageValues = {}): string {
    if (!this.has(key)) return this.#onMissing(key);
    const raw = this.#catalogue[key] ?? '';

    const resolved = raw.replace(TERM_PATTERN, (_, name: string) => this.term(name));

    let formatter = this.#cache.get(resolved);
    if (formatter === undefined) {
      formatter = new IntlMessageFormat(resolved, this.#formatting);
      this.#cache.set(resolved, formatter);
    }

    const output = formatter.format(values);
    return typeof output === 'string' ? output : String(output);
  }

  /**
   * True when the catalogue can answer for this key.
   *
   * Own keys, for the reason `term` gives: `has('toString')` was true, and
   * `format('toString')` then failed on a function where a message should be.
   */
  has(key: string): boolean {
    return Object.hasOwn(this.#catalogue, key);
  }
}
