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

export interface TranslatorOptions {
  readonly locale: string;
  readonly catalogue: Catalogue;
  readonly terms?: Terminology;
  readonly tenantTerms?: Terminology;
  /**
   * Called when a key is missing. Defaults to throwing in development and
   * returning the key in production, because a missing string must be loud
   * while it can still be fixed and harmless once a shop is trading.
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

export class Translator {
  readonly locale: string;
  readonly #catalogue: Catalogue;
  readonly #terms: Terminology;
  readonly #onMissing: (key: string) => string;
  readonly #cache = new Map<string, IntlMessageFormat>();

  constructor(options: TranslatorOptions) {
    this.locale = options.locale;
    this.#catalogue = options.catalogue;
    // The tenant's renamings sit above the product's own terms, so a tenant
    // that overrides nothing still gets a complete vocabulary.
    this.#terms = { ...options.terms, ...options.tenantTerms };
    this.#onMissing =
      options.onMissing ??
      ((key) => {
        throw new MissingMessageError(key);
      });
  }

  /** The tenant's name for a concept, or the product's own. */
  term(name: string): string {
    return this.#terms[name] ?? name;
  }

  /**
   * Formats a message.
   *
   * `{term:x}` placeholders resolve before ICU parsing, so a renamed concept
   * reaches the plural and select rules as its renamed form rather than as a
   * literal the rules cannot see.
   */
  format(key: string, values: MessageValues = {}): string {
    const raw = this.#catalogue[key];
    if (raw === undefined) return this.#onMissing(key);

    const resolved = raw.replace(TERM_PATTERN, (_, name: string) => this.term(name));

    let formatter = this.#cache.get(resolved);
    if (formatter === undefined) {
      formatter = new IntlMessageFormat(resolved, this.locale);
      this.#cache.set(resolved, formatter);
    }

    const output = formatter.format(values);
    return typeof output === 'string' ? output : String(output);
  }

  /** True when the catalogue can answer for this key. */
  has(key: string): boolean {
    return key in this.#catalogue;
  }
}
