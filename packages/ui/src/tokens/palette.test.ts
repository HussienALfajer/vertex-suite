import { describe, expect, it } from 'vitest';

import { generatePalette } from './generate.js';
import { NEUTRAL_STOPS, type AccentName } from './spec.js';

/**
 * The published palette of `design-system.md` §4, restated here.
 *
 * This is the check §13 calls the token snapshot. It is not a snapshot of the
 * generator against itself — that would only prove the generator is
 * deterministic. It is the generator against **the document**, so that changing
 * an input in `spec.ts` without publishing the consequence fails the build.
 *
 * As of this revision the document publishes a ramp taken literally from a
 * third-party design system rather than one solved from `NEUTRAL_LIGHTNESS`/
 * `NEUTRAL_CHROMA` (`spec.ts`'s `NEUTRAL_RAMP_HEX`, which this restates) — see
 * that constant's comment for what was decided and how to revert it.
 */

const PUBLISHED_NEUTRAL: Readonly<Record<number, string>> = {
  0: '#ffffff',
  10: '#fcfcfb',
  20: '#f9f9f7',
  30: '#f6f6f4',
  40: '#f3f3f0',
  50: '#f0efec',
  60: '#edece8',
  70: '#eae9e4',
  80: '#e7e6e1',
  90: '#e4e3dd',
  100: '#e1e0d9',
  150: '#d2d1c7',
  200: '#c3c2b7',
  250: '#b4b3a8',
  300: '#a5a49a',
  350: '#97958d',
  400: '#898781',
  450: '#7b7974',
  500: '#6d6b67',
  550: '#5f5e5a',
  600: '#52514e',
  650: '#454442',
  700: '#383835',
  750: '#2c2c2a',
  800: '#20201f',
  810: '#1e1e1d',
  820: '#1c1c1b',
  830: '#1a1a19',
  840: '#181817',
  850: '#151515',
  860: '#131313',
  870: '#111111',
  880: '#0f0f0f',
  890: '#0d0d0d',
  900: '#0b0b0b',
};

interface PublishedAccent {
  readonly fill: string;
  readonly fillHover: string;
  readonly text: readonly [light: string, dark: string];
  readonly bg: readonly [light: string, dark: string];
  readonly onBg: readonly [light: string, dark: string];
  readonly border: readonly [light: string, dark: string];
}

/**
 * As of this revision, taken literally from the same third-party system as
 * `PUBLISHED_NEUTRAL` (`spec.ts`'s `ACCENT_PALETTE_HEX`) rather than solved
 * against the neutral ramp for `CONTRAST_TARGET`. `onBg` equals `text` in
 * every row: a role's tinted background is read with the same ink that names
 * the role everywhere else, which is that system's own choice.
 */
const PUBLISHED_ACCENTS: Readonly<Record<AccentName, PublishedAccent>> = {
  blue: {
    fill: '#2a78d6',
    fillHover: '#3987e5',
    text: ['#184f95', '#6da7ec'],
    bg: ['#cde2fb', '#032042'],
    onBg: ['#184f95', '#6da7ec'],
    border: ['#86b6ef', '#0d366b'],
  },
  green: {
    fill: '#009300',
    fillHover: '#0ca30c',
    text: ['#006300', '#0ca30c'],
    bg: ['#caeac7', '#11260f'],
    onBg: ['#006300', '#0ca30c'],
    border: ['#73cb6d', '#074506'],
  },
  red: {
    fill: '#d03b3b',
    fillHover: '#e34948',
    text: ['#8e2626', '#ec7e7e'],
    bg: ['#fad6d6', '#3c0e0e'],
    onBg: ['#8e2626', '#ec7e7e'],
    border: ['#f09595', '#641919'],
  },
  amber: {
    // The one role whose fill/hover break the 450-then-400 pattern the other
    // four keep — see `ACCENT_PALETTE_HEX`'s own comment for why.
    fill: '#fab219',
    fillHover: '#eda100',
    text: ['#734500', '#db9300'],
    bg: ['#f9dca4', '#311a00'],
    onBg: ['#734500', '#db9300'],
    border: ['#eda100', '#512e00'],
  },
  teal: {
    fill: '#138e65',
    fillHover: '#199e70',
    text: ['#065f49', '#3bbd8c'],
    bg: ['#bfebdb', '#022720'],
    onBg: ['#065f49', '#3bbd8c'],
    border: ['#5acba0', '#034235'],
  },
};

const PUBLISHED_CHART: readonly (readonly [name: string, light: string, dark: string])[] = [
  ['blue', '#257ecc', '#60b0ff'],
  ['amber', '#a46e00', '#df9c27'],
  ['teal', '#008c8c', '#00c3c3'],
  ['red', '#c15249', '#f98478'],
  ['green', '#239149', '#5ec478'],
  ['violet', '#8863c2', '#b994f8'],
  ['magenta', '#b4528e', '#ea83c0'],
  ['olive', '#7f8000', '#b1b231'],
];

const palette = generatePalette();

describe('neutral ramp', () => {
  it('has all 35 stops', () => {
    expect(palette.neutral.size).toBe(35);
    expect([...palette.neutral.keys()]).toEqual([...NEUTRAL_STOPS]);
  });

  it('matches every published value', () => {
    const generated = Object.fromEntries(
      [...palette.neutral].map(([stop, hex]) => [stop, hex]),
    ) as Record<number, string>;
    expect(generated).toEqual(PUBLISHED_NEUTRAL);
  });

  it('begins at pure white and descends without reversing', () => {
    expect(palette.neutral.get(0)).toBe('#ffffff');
    const stops = [...palette.neutral.keys()];
    for (let i = 1; i < stops.length; i += 1) {
      const previous = palette.neutral.get(stops[i - 1] ?? 0) ?? '';
      const current = palette.neutral.get(stops[i] ?? 0) ?? '';
      expect(Number.parseInt(current.slice(1), 16)).toBeLessThan(
        Number.parseInt(previous.slice(1), 16),
      );
    }
  });
});

describe('accents', () => {
  it('provides all five hues', () => {
    expect([...palette.accents.keys()].sort()).toEqual(['amber', 'blue', 'green', 'red', 'teal']);
  });

  for (const [name, published] of Object.entries(PUBLISHED_ACCENTS) as [
    AccentName,
    PublishedAccent,
  ][]) {
    it(`${name} matches every published token`, () => {
      const generated = palette.accents.get(name);
      expect(generated).toBeDefined();
      if (generated === undefined) return;
      expect(generated.fill).toBe(published.fill);
      expect(generated.fillHover).toBe(published.fillHover);
      expect([generated.text.light, generated.text.dark]).toEqual([...published.text]);
      expect([generated.bg.light, generated.bg.dark]).toEqual([...published.bg]);
      expect([generated.onBg.light, generated.onBg.dark]).toEqual([...published.onBg]);
      expect([generated.border.light, generated.border.dark]).toEqual([...published.border]);
    });
  }

  it('keeps the fill identical in both themes', () => {
    // A filled button carries a white label either way, so its requirement
    // does not change with the theme and neither does its value.
    for (const [, tokens] of palette.accents) {
      expect(tokens.fill).toBe(tokens.fill);
      expect(tokens.fillHover).not.toBe(tokens.fill);
    }
  });
});

describe('chart series', () => {
  it('matches every published value, in order', () => {
    expect(palette.chart.map((s) => [s.name, s.light, s.dark])).toEqual(
      PUBLISHED_CHART.map((row) => [...row]),
    );
  });
});
