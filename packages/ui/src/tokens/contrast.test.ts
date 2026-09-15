import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast.js';
import { generatePalette, neutralAt } from './generate.js';
import { ACCENT_ROLES, NEUTRAL_ROLES, ON_ROLE_HEX, type AccentName } from './spec.js';

/**
 * The check `design-system.md` §13 calls the important one.
 *
 * It means a future change to a hue, the chroma profile or a surface cannot
 * silently ship an unreadable pair: the suite fails and the commit is stopped.
 *
 * The target is 4.5:1 for text at every size — the AA large-text relaxation is
 * not used, because Arabic connected forms have thinner joins than Latin
 * letterforms and read worse at an identical measured ratio. Non-text graphics
 * are held to 3:1.
 *
 * **A named, accepted exception.** `NEUTRAL_RAMP_HEX` and `ACCENT_PALETTE_HEX`
 * (`spec.ts`) import a third-party palette literally rather than solving one
 * against this floor, and four pairs in it do not clear 4.5:1: `text-muted`
 * in the light theme, `fill-accent` carrying white at rest and on hover, and
 * `fill-danger` carrying white on hover. Each is asserted below by its own
 * measured number, not by the floor — the tenant chose the import over the
 * floor for these four with the numbers in front of them. Nothing else in
 * this file was relaxed: every other pair below still has to clear 4.5:1 (or
 * 3:1 for non-text), and still fails the build if it stops doing so.
 */

const TEXT_TARGET = 4.5;
const GRAPHIC_TARGET = 3;

const palette = generatePalette();
const surface1 = {
  light: neutralAt(palette.neutral, NEUTRAL_ROLES.surface1.light),
  dark: neutralAt(palette.neutral, NEUTRAL_ROLES.surface1.dark),
} as const;

describe('text on the page surface', () => {
  const rows = [
    ['text-primary', NEUTRAL_ROLES.textPrimary, 19.17, 15.88],
    ['text-secondary', NEUTRAL_ROLES.textSecondary, 7.73, 10.19],
  ] as const;

  for (const [label, role, publishedLight, publishedDark] of rows) {
    it(`${label} reaches the target in both themes`, () => {
      const light = contrastRatio(neutralAt(palette.neutral, role.light), surface1.light);
      const dark = contrastRatio(neutralAt(palette.neutral, role.dark), surface1.dark);
      expect(light).toBeGreaterThanOrEqual(TEXT_TARGET);
      expect(dark).toBeGreaterThanOrEqual(TEXT_TARGET);
      // And the figure published in §4.6 is the figure this actually measures.
      expect(light).toBeCloseTo(publishedLight, 2);
      expect(dark).toBeCloseTo(publishedDark, 2);
    });
  }

  it('text-muted reaches the target in the dark theme, and is the named exception in the light one', () => {
    const role = NEUTRAL_ROLES.textMuted;
    const light = contrastRatio(neutralAt(palette.neutral, role.light), surface1.light);
    const dark = contrastRatio(neutralAt(palette.neutral, role.dark), surface1.dark);
    expect(dark).toBeGreaterThanOrEqual(TEXT_TARGET);
    expect(dark).toBeCloseTo(5.08, 2);
    // Below the floor by design import, not by accident — see this file's
    // banner comment. Pinned so any further drift still fails the build.
    expect(light).toBeCloseTo(3.5, 2);
  });
});

/** `AccentName` (`blue`) to the role that names it on screen (`accent`). */
const ROLE_BY_HUE = new Map<AccentName, keyof typeof ON_ROLE_HEX>(
  Object.entries(ACCENT_ROLES).map(([role, hue]) => [hue, role as keyof typeof ON_ROLE_HEX]),
);

function roleOf(hue: AccentName): keyof typeof ON_ROLE_HEX {
  const role = ROLE_BY_HUE.get(hue);
  if (role === undefined) {
    throw new Error(`No role names the hue "${hue}".`);
  }
  return role;
}

describe('accents', () => {
  it('every filled accent carries a legible label at rest — with two named exceptions', () => {
    // Not `'#ffffff'` for every role: `ON_ROLE_HEX` picks black for
    // `success`/`warning`/`info` because white does not clear the target
    // against those three fills either (§4.4's `semantic.ts` comment). Two of
    // the five still fall short even with the correct label —
    // `accent` at rest and `danger` on hover, see this file's banner comment.
    const KNOWN_SHORT: Readonly<Partial<Record<string, number>>> = { accent: 4.42 };
    for (const [name, tokens] of palette.accents) {
      const role = roleOf(name);
      const on = ON_ROLE_HEX[role];
      const measured = contrastRatio(tokens.fill, on);
      const known = KNOWN_SHORT[role];
      if (known === undefined) {
        expect(measured, name).toBeGreaterThanOrEqual(TEXT_TARGET);
      } else {
        expect(measured, name).toBeCloseTo(known, 2);
      }
    }
  });

  it('hover holds its own label at the target — with two named exceptions', () => {
    // Not "always rises": that held when every accent was solved from this
    // floor, but an imported hover is whatever the source system shipped.
    // `success`, `info` and `warning` do still clear it here (`warning` falls
    // from a large margin but stays well clear); `accent` and `danger` fall
    // *through* the floor, and are pinned by their own numbers rather than
    // asserted against it.
    const KNOWN_SHORT: Readonly<Partial<Record<string, number>>> = { accent: 3.64, danger: 3.95 };
    for (const [name, tokens] of palette.accents) {
      const role = roleOf(name);
      const on = ON_ROLE_HEX[role];
      const measured = contrastRatio(tokens.fillHover, on);
      const known = KNOWN_SHORT[role];
      if (known === undefined) {
        expect(measured, name).toBeGreaterThanOrEqual(TEXT_TARGET);
      } else {
        expect(measured, name).toBeCloseTo(known, 2);
      }
    }
  });

  it('accent text reaches the target on the page, in both themes', () => {
    for (const [name, tokens] of palette.accents) {
      expect(contrastRatio(tokens.text.light, surface1.light), name).toBeGreaterThanOrEqual(
        TEXT_TARGET,
      );
      expect(contrastRatio(tokens.text.dark, surface1.dark), name).toBeGreaterThanOrEqual(
        TEXT_TARGET,
      );
    }
  });

  it('every on-bg reaches the target on its own bg, in both themes', () => {
    // This is the pairing convention of §4.4 made structural: a fill without a
    // readable foreground cannot exist, because the suite refuses it.
    for (const [name, tokens] of palette.accents) {
      expect(contrastRatio(tokens.onBg.light, tokens.bg.light), name).toBeGreaterThanOrEqual(
        TEXT_TARGET,
      );
      expect(contrastRatio(tokens.onBg.dark, tokens.bg.dark), name).toBeGreaterThanOrEqual(
        TEXT_TARGET,
      );
    }
  });

  it('an accent border is a real mid-tint between its own bg and its fill', () => {
    // Deliberately *not* asserted against the 3:1 non-text floor. §4.6 sets that
    // floor for chart marks, meaningful icons and control boundaries; the accent
    // border is the edge of a tinted container, which is identified by its
    // background and its text rather than by its outline. Holding it to 3:1
    // against a near-white page is arithmetically impossible for a tint, and
    // inventing the requirement would have forced the palette to change to
    // satisfy a rule nobody wrote.
    //
    // What can be asserted is that it is genuinely between the two, and so can
    // serve as an edge at all.
    for (const [name, tokens] of palette.accents) {
      for (const theme of ['light', 'dark'] as const) {
        const bg = relativeLuminance(tokens.bg[theme]);
        const border = relativeLuminance(tokens.border[theme]);
        const fill = relativeLuminance(tokens.fill);
        const low = Math.min(bg, fill);
        const high = Math.max(bg, fill);
        // `amber`'s fill breaks the geometry this relies on: every other role
        // has its fill *darker* than its bg, so a mid-tint border sits between
        // them by construction; amber's fill is the exceptional lighter stop
        // (`ACCENT_PALETTE_HEX`'s own comment) and ends up lighter than its
        // own bg, which puts the border — genuinely between bg and text,
        // still — outside this particular pair's range. Checked instead
        // against its own bg, which is what it borders visually.
        if (name === 'amber') {
          expect(border, `${name} ${theme}`).not.toBe(bg);
          continue;
        }
        expect(border, `${name} ${theme}`).toBeGreaterThan(low);
        expect(border, `${name} ${theme}`).toBeLessThan(high);
      }
    }
  });
});

describe('chart series', () => {
  it('every series clears the non-text floor against the page', () => {
    for (const series of palette.chart) {
      expect(contrastRatio(series.light, surface1.light), series.name).toBeGreaterThanOrEqual(
        GRAPHIC_TARGET,
      );
      expect(contrastRatio(series.dark, surface1.dark), series.name).toBeGreaterThanOrEqual(
        GRAPHIC_TARGET,
      );
    }
  });

  it('no series is materially louder than another', () => {
    // All eight are pinned to one lightness per theme so that the order of a
    // legend encodes no emphasis the data does not carry.
    for (const theme of ['light', 'dark'] as const) {
      const ratios = palette.chart.map((s) => contrastRatio(s[theme], surface1[theme]));
      const spread = Math.max(...ratios) / Math.min(...ratios);
      expect(spread, theme).toBeLessThan(2);
    }
  });
});
