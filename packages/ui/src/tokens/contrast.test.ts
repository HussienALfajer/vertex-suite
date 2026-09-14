import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast.js';
import { generatePalette, neutralAt } from './generate.js';
import { NEUTRAL_ROLES } from './spec.js';

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
    ['text-primary', NEUTRAL_ROLES.textPrimary, 19.15, 15.87],
    ['text-secondary', NEUTRAL_ROLES.textSecondary, 7.74, 10.12],
    ['text-muted', NEUTRAL_ROLES.textMuted, 5.19, 5.07],
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
});

describe('accents', () => {
  it('every filled accent carries a white label at the target', () => {
    for (const [name, tokens] of palette.accents) {
      expect(contrastRatio(tokens.fill, '#ffffff'), name).toBeGreaterThanOrEqual(TEXT_TARGET);
    }
  });

  it('hover raises contrast instead of lowering it', () => {
    // Hover goes darker, never lighter: a control must not become harder to
    // read at the moment the pointer is on it.
    for (const [name, tokens] of palette.accents) {
      expect(contrastRatio(tokens.fillHover, '#ffffff'), name).toBeGreaterThan(
        contrastRatio(tokens.fill, '#ffffff'),
      );
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
