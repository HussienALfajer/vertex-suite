import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { Translator } from '@vertex/i18n';

import { UI_CATALOGUE } from './catalogue.js';

/**
 * The catalogue against the components, both ways.
 *
 * A component that formats a key the catalogue lacks throws
 * `MissingMessageError` on the one render that reaches it — which, for a
 * mark like `rate.notToday`, is the first day a rate board shows yesterday's
 * rate and not a day anybody tests by hand. A sentence no component formats
 * is a sentence every host carries and nobody reads. Neither fails a type
 * check, because a key is a string; so the source is read, as
 * `resolution.test.ts` reads the back office's config against its imports.
 *
 * What is read is the **first argument** of every `translator.format(`: a
 * literal key, a conditional between two, or a template whose prefix decides
 * a family — `theme.${theme}`. A family is held to have at least one member
 * here; which members it has is the union type's business, and the component
 * test that renders each state of it.
 */

const src = dirname(fileURLToPath(import.meta.url));

/** Shipped source: not a test, not the generated atlas, and not the catalogue itself. */
function* shipped(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* shipped(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|generated)\.tsx?$/.test(entry) || full === join(src, 'catalogue.ts')) continue;
    yield full;
  }
}

/**
 * The first argument of each `translator.format(` call in a source: the text
 * up to the first comma or closing bracket at depth zero, with what sits
 * inside a string skipped so a comma in a sentence does not end it early.
 */
function* firstArguments(source: string): Generator<string> {
  const marker = 'translator.format(';
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) return;
    const start = at + marker.length;
    let depth = 0;
    let quote: string | null = null;
    let index = start;
    for (; index < source.length; index += 1) {
      const char = source[index] ?? '';
      if (quote !== null) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') quote = char;
      else if (char === '(' || char === '{' || char === '[') depth += 1;
      else if (char === ')' || char === '}' || char === ']') {
        if (depth === 0) break;
        depth -= 1;
      } else if (char === ',' && depth === 0) break;
    }
    yield source.slice(start, index);
    from = index;
  }
}

/** A message key: dotted segments, which is what tells one from a state compared against. */
const KEY = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9-]+)+$/;

interface Spoken {
  readonly keys: ReadonlyMap<string, string>;
  readonly families: ReadonlyMap<string, string>;
}

/** Every key and every family prefix the components format, each with a file that does. */
function spoken(): Spoken {
  const keys = new Map<string, string>();
  const families = new Map<string, string>();
  for (const file of shipped(src)) {
    const where = relative(src, file);
    for (const argument of firstArguments(readFileSync(file, 'utf8'))) {
      for (const match of argument.matchAll(/'([^']+)'/g)) {
        const key = match[1] ?? '';
        if (KEY.test(key)) keys.set(key, where);
      }
      for (const match of argument.matchAll(/`([^`$]*)\$\{/g)) {
        families.set(match[1] ?? '', where);
      }
    }
  }
  return { keys, families };
}

describe('the design system’s catalogue — §12', () => {
  const { keys, families } = spoken();
  const catalogue = new Set(Object.keys(UI_CATALOGUE));

  it('reads the components, so the rules below are about something', () => {
    expect(keys.size).toBeGreaterThan(20);
    expect(families.size).toBeGreaterThan(0);
    expect(keys.get('action.close')).toBe(join('components', 'Dialog.tsx'));
    expect(families.get('theme.')).toBe(join('components', 'ThemeSwitch.tsx'));
  });

  it('has a sentence for every key a component formats', () => {
    for (const [key, where] of keys) {
      expect(catalogue.has(key), `${where} formats "${key}", which the catalogue lacks.`).toBe(
        true,
      );
    }
    for (const [prefix, where] of families) {
      const members = [...catalogue].filter((key) => key.startsWith(prefix));
      expect(
        members.length,
        `${where} formats "${prefix}…" and the catalogue has none.`,
      ).toBeGreaterThan(0);
    }
  });

  it('says nothing that no component asks for', () => {
    const prefixes = [...families.keys()];
    for (const key of catalogue) {
      const asked = keys.has(key) || prefixes.some((prefix) => key.startsWith(prefix));
      expect(asked, `"${key}" is in the catalogue and no component formats it.`).toBe(true);
    }
  });

  it('holds only messages ICU can read', () => {
    // Formatted with nothing, which is enough: a malformed message fails while
    // it is being parsed, before any value is looked at. A missing value is a
    // different complaint, in a different error, and is the business of the
    // component that sends it.
    const say = new Translator({ locale: 'ar', catalogue: UI_CATALOGUE });
    const unreadable = [...catalogue].filter((key) => {
      try {
        say.format(key, {});
      } catch (cause) {
        return cause instanceof SyntaxError;
      }
      return false;
    });
    expect(unreadable).toEqual([]);
  });
});
