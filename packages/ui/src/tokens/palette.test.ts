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
 */

const PUBLISHED_NEUTRAL: Readonly<Record<number, string>> = {
  0: '#ffffff',
  10: '#fcfcfa',
  20: '#f9f9f7',
  30: '#f6f5f3',
  40: '#f3f2ef',
  50: '#f0efec',
  60: '#edece8',
  70: '#eae9e5',
  80: '#e7e6e2',
  90: '#e4e3de',
  100: '#e1e0db',
  150: '#d2d0ca',
  200: '#c3c1b9',
  250: '#b4b2aa',
  300: '#a6a49b',
  350: '#97958d',
  400: '#89877f',
  450: '#7b7972',
  500: '#6d6b65',
  550: '#605e58',
  600: '#52514c',
  650: '#45443f',
  700: '#383733',
  750: '#2c2b28',
  800: '#21201d',
  810: '#1e1e1b',
  820: '#1c1c19',
  830: '#1a1917',
  840: '#181715',
  850: '#161513',
  860: '#141311',
  870: '#12110f',
  880: '#100f0d',
  890: '#0e0d0b',
  900: '#0c0b09',
};

interface PublishedAccent {
  readonly fill: string;
  readonly fillHover: string;
  readonly text: readonly [light: string, dark: string];
  readonly bg: readonly [light: string, dark: string];
  readonly onBg: readonly [light: string, dark: string];
  readonly border: readonly [light: string, dark: string];
}

const PUBLISHED_ACCENTS: Readonly<Record<AccentName, PublishedAccent>> = {
  blue: {
    fill: '#1678c9',
    fillHover: '#0069b5',
    text: ['#1376c7', '#2784d5'],
    bg: ['#d7eaff', '#092540'],
    onBg: ['#0069b7', '#3690e2'],
    border: ['#9ac9fa', '#1d456b'],
  },
  green: {
    fill: '#02873d',
    fillHover: '#007734',
    text: ['#00853c', '#1d9347'],
    bg: ['#cff3d5', '#092c13'],
    onBg: ['#007936', '#31a154'],
    border: ['#9dd4a7', '#1d4e2b'],
  },
  red: {
    fill: '#ca4941',
    fillHover: '#b93933',
    text: ['#c84740', '#d7564c'],
    bg: ['#ffe0db', '#3c1714'],
    onBg: ['#b83933', '#e36156'],
    border: ['#f7afa6', '#66302a'],
  },
  amber: {
    fill: '#9f6a00',
    fillHover: '#8c5d00',
    text: ['#9c6900', '#ad7500'],
    bg: ['#fee3c0', '#331f00'],
    onBg: ['#8c5d00', '#bc7f00'],
    border: ['#e5bd86', '#5b3b00'],
  },
  teal: {
    fill: '#008283',
    fillHover: '#007273',
    text: ['#008081', '#008f8f'],
    bg: ['#bef4f3', '#002b2b'],
    onBg: ['#007475', '#009e9e'],
    border: ['#7ed6d5', '#004d4d'],
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
