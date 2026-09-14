import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { emitTheme } from './emit-theme.js';
import { DENSITIES, SIZE_TOKENS, TYPE_SCALE, WEIGHTS, WEIGHTS_DARK_COMPENSATED } from './scale.js';

const here = dirname(fileURLToPath(import.meta.url));
const theme = emitTheme();
const primitives = readFileSync(resolve(here, 'palette.generated.css'), 'utf8');

/** Every custom property this stylesheet defines. */
function defined(css: string): Set<string> {
  return new Set([...css.matchAll(/--vx-([a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? ''));
}

/** Every custom property this stylesheet reads. */
function referenced(css: string): Set<string> {
  return new Set([...css.matchAll(/var\(--vx-([a-z0-9-]+)/g)].map((m) => m[1] ?? ''));
}

/** The declarations inside the first block matching a selector. */
function block(css: string, selector: string): Map<string, string> {
  const index = css.indexOf(selector);
  if (index === -1) throw new Error(`No block for ${selector}`);
  const open = css.indexOf('{', index);
  const close = css.indexOf('\n}', open);
  const body = css.slice(open + 1, close);
  return new Map(
    [...body.matchAll(/--vx-([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ]),
  );
}

const themeTokens = defined(theme);
const primitiveTokens = defined(primitives);

describe('the token graph closes', () => {
  it('every token the theme reads is defined somewhere', () => {
    // This is the check that would have caught `fill-accent` being used by the
    // focus ring of §7.3 while being defined nowhere at all.
    const available = new Set([...themeTokens, ...primitiveTokens]);
    const dangling = [...referenced(theme)].filter((name) => !available.has(name));
    expect(dangling).toEqual([]);
  });

  it('no screen-facing token reaches past the semantic layer to a primitive', () => {
    // §3.1: a screen names the semantic layer only. The theme is the one place
    // permitted to name a primitive, and it does so to alias it.
    expect(themeTokens.has('neutral-900')).toBe(false);
  });
});

describe('every fill has exactly one on', () => {
  // §4.4 calls adding one without the other a review finding. Here it is a
  // failing build, which is the difference between a convention and a rule.
  const INVERTING_FILLS = ['primary', 'accent', 'success', 'danger', 'warning', 'info', 'brand'];

  for (const role of INVERTING_FILLS) {
    it(`fill-${role} has on-${role}`, () => {
      expect(themeTokens.has(`fill-${role}`), `fill-${role}`).toBe(true);
      expect(themeTokens.has(`on-${role}`), `on-${role}`).toBe(true);
    });
  }

  it('no on-* exists without its fill', () => {
    const orphans = [...themeTokens]
      .filter((name) => name.startsWith('on-') && !name.startsWith('on-bg-'))
      .map((name) => name.slice('on-'.length))
      .filter((role) => !themeTokens.has(`fill-${role}`));
    expect(orphans).toEqual([]);
  });
});

describe('the dark theme is an equal, not an afterthought', () => {
  const light = block(theme, ':root {');
  const dark = block(theme, ":root[data-theme='dark'] {");

  it('redefines every neutral token of §4.4, and every shadow', () => {
    // Listed rather than matched by prefix, because the list is the published
    // table: one token set, two value sets. Dark is not a filter over light.
    const mustInvert = [
      'surface-0',
      'surface-1',
      'surface-2',
      'surface-3',
      'text-primary',
      'text-secondary',
      'text-muted',
      'text-disabled',
      'border',
      'border-strong',
      'fill-primary',
      'fill-secondary',
      'fill-ghost-hover',
      'fill-field',
      'on-primary',
      'shadow-sm',
      'shadow-md',
      'shadow-lg',
      'shadow-dialog',
    ];
    for (const name of mustInvert) {
      expect(light.has(name), `light/${name}`).toBe(true);
      expect(dark.has(name), `dark/${name}`).toBe(true);
    }
  });

  it('steps body weights down one named weight and leaves the small scale alone', () => {
    for (const [name, value] of Object.entries(WEIGHTS)) {
      expect(dark.get(`weight-${name}`) ?? light.get(`weight-${name}`)).toBe(String(value));
    }
    for (const [name, value] of Object.entries(WEIGHTS_DARK_COMPENSATED)) {
      expect(dark.get(`weight-body-${name}`), name).toBe(String(value));
    }
  });

  it('does not restate the accent aliases, because the primitive already switches', () => {
    expect(dark.has('fill-accent')).toBe(false);
  });
});

describe('density', () => {
  for (const density of DENSITIES) {
    it(`${density} defines every size and type token at its published value`, () => {
      const declarations = block(theme, `[data-density='${density}'] {`);

      for (const [name, byDensity] of Object.entries(SIZE_TOKENS)) {
        expect(declarations.get(name), `${density}/${name}`).toBe(
          `${String(byDensity[density])}px`,
        );
      }
      for (const [role, sizes] of Object.entries(TYPE_SCALE)) {
        const [size, leading] = sizes[density];
        expect(declarations.get(`font-size-${role}`), `${density}/${role}`).toBe(
          `${String(size)}px`,
        );
        expect(declarations.get(`line-height-${role}`), `${density}/${role}`).toBe(
          `${String(leading)}px`,
        );
      }
    });
  }

  it('touch is never smaller than comfortable on any control', () => {
    // §6.1: a subtree may raise density but never lower it below touch on a
    // touch surface, which only holds if touch really is the largest.
    for (const [name, byDensity] of Object.entries(SIZE_TOKENS)) {
      expect(byDensity.touch, name).toBeGreaterThanOrEqual(byDensity.comfortable);
      expect(byDensity.comfortable, name).toBeGreaterThanOrEqual(byDensity.compact);
    }
  });

  it('every interactive height clears the 48px floor on touch', () => {
    expect(SIZE_TOKENS['h-control']?.touch).toBeGreaterThanOrEqual(48);
  });
});

describe('motion', () => {
  it('collapses to nothing for both the system preference and the tenant setting', () => {
    expect(theme).toContain('@media (prefers-reduced-motion: reduce)');
    expect(theme).toContain("[data-reduce-motion='true']");
    const reduced = block(theme, "[data-reduce-motion='true'] {");
    for (const name of ['dur-snap', 'dur-base', 'dur-slow']) {
      expect(reduced.get(name), name).toBe('0ms');
    }
  });
});
