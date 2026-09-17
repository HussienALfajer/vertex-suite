import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { emitJson, emitPrimitives } from './emit.js';
import { emitFonts, emitTailwind, tailwindColourAlias } from './emit-integration.js';
import { emitTheme } from './emit-theme.js';
import { generatePalette } from './generate.js';
import { TYPE_SCALE } from './scale.js';
import { ACCENT_TOKENS, BORDERS, NEUTRAL_FILLS, SURFACES, TEXT } from './semantic.js';

/**
 * The failure this suite exists for is a silent one.
 *
 * Tailwind builds a colour utility by prefixing the colour's name. A colour
 * named `text-primary` therefore has to be written `text-text-primary`, and
 * `text-primary` matches **nothing** — which does not error, does not warn, and
 * does not appear in the stylesheet. The element simply inherits whatever its
 * parent had, and a negative amount ships in the ordinary text colour instead
 * of the danger colour. A screenshot looks fine. A unit test on class names
 * looks fine. Only the browser knows.
 */

const UTILITY_PREFIXES = ['text-', 'bg-', 'border-', 'fill-', 'stroke-', 'ring-', 'shadow-'];

const semanticColourTokens = [
  ...Object.keys(SURFACES),
  ...Object.keys(TEXT),
  ...Object.keys(BORDERS),
  ...Object.keys(NEUTRAL_FILLS),
  ...ACCENT_TOKENS.flatMap(({ tokens }) => Object.keys(tokens)),
];

describe('the committed generated files', () => {
  it('are exactly what the generator emits today', () => {
    // They are committed so that a consumer never runs a generator, which also
    // means a generator change that nobody re-ran ships the old tokens with
    // every test here green. `pnpm --filter @vertex/ui tokens` rewrites them.
    const palette = generatePalette();
    const committed = (name: string): string =>
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), name), 'utf8');

    expect(committed('palette.generated.css')).toBe(emitPrimitives(palette));
    expect(committed('palette.generated.json')).toBe(emitJson(palette));
    expect(committed('theme.generated.css')).toBe(emitTheme());
    expect(committed('fonts.generated.css')).toBe(emitFonts());
    expect(committed('tailwind.generated.css')).toBe(emitTailwind());
  });
});

describe('tailwindColourAlias', () => {
  it('never produces an alias that repeats a utility prefix', () => {
    // `text-primary` → `fg`, so the utility is `text-fg` and not `text-text-primary`.
    for (const token of semanticColourTokens) {
      const alias = tailwindColourAlias(token);
      for (const prefix of ['text-', 'bg-', 'border-']) {
        expect(alias.startsWith(prefix), `${token} → ${alias}`).toBe(false);
      }
    }
  });

  it('is injective, so two tokens can never collapse onto one utility', () => {
    const aliases = semanticColourTokens.map((token) => tailwindColourAlias(token));
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it('leaves a token that already reads well under every prefix alone', () => {
    expect(tailwindColourAlias('surface-1')).toBe('surface-1');
    expect(tailwindColourAlias('fill-primary')).toBe('fill-primary');
    expect(tailwindColourAlias('on-primary')).toBe('on-primary');
  });

  it('maps the four shapes that would otherwise double', () => {
    expect(tailwindColourAlias('text-primary')).toBe('fg');
    expect(tailwindColourAlias('text-danger')).toBe('fg-danger');
    expect(tailwindColourAlias('border')).toBe('line');
    expect(tailwindColourAlias('border-strong')).toBe('line-strong');
    expect(tailwindColourAlias('bg-success')).toBe('tint-success');
    expect(tailwindColourAlias('on-bg-success')).toBe('on-tint-success');
  });
});

describe('the emitted theme', () => {
  const css = emitTailwind();

  it('declares a colour for every semantic colour token', () => {
    for (const token of semanticColourTokens) {
      const alias = tailwindColourAlias(token);
      expect(css, token).toContain(`--color-${alias}: var(--vx-${token});`);
    }
  });

  it('gives every size of the scale its own line height, so a text utility sets both — §5.2', () => {
    // Emitted only as `--leading-*`, the line heights reached no utility, and a
    // 26px Arabic page title sat on the body's 22px line.
    for (const role of Object.keys(TYPE_SCALE)) {
      expect(css, role).toContain(`--text-${role}--line-height: var(--vx-line-height-${role});`);
    }
  });

  it('declares no colour whose name would double a prefix', () => {
    const names = [...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1] ?? '');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      for (const prefix of UTILITY_PREFIXES) {
        if (prefix === 'fill-') continue; // `bg-fill-primary` is deliberate and reads correctly.
        expect(name.startsWith(prefix), name).toBe(false);
      }
    }
  });
});
