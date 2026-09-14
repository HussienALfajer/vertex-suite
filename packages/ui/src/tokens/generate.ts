import { contrastRatio } from './contrast.js';
import { interpolate } from './interpolate.js';
import { oklch, toHex } from './oklch.js';
import {
  ACCENTS,
  ACCENT_LIGHTNESS_RANGE,
  CHART_CHROMA,
  CHART_LIGHTNESS,
  CHART_SERIES,
  CONTRAST_TARGET,
  HOVER_LIGHTNESS_STEP,
  NEUTRAL_CHROMA,
  NEUTRAL_HUE,
  NEUTRAL_LIGHTNESS,
  NEUTRAL_ROLES,
  NEUTRAL_STOPS,
  TINTS,
  type AccentName,
} from './spec.js';

/** A value that differs between the two themes. */
export interface Themed {
  readonly light: string;
  readonly dark: string;
}

/** The six tokens every accent hue provides. */
export interface AccentTokens {
  /** Identical in both themes: a filled button carries a white label either way. */
  readonly fill: string;
  readonly fillHover: string;
  readonly text: Themed;
  readonly bg: Themed;
  readonly onBg: Themed;
  readonly border: Themed;
}

export interface ChartSeries extends Themed {
  readonly name: string;
}

export interface Palette {
  readonly neutral: ReadonlyMap<number, string>;
  readonly accents: ReadonlyMap<AccentName, AccentTokens>;
  readonly chart: readonly ChartSeries[];
}

/**
 * The 35-step neutral ramp.
 *
 * Stop 0 is forced to pure white: the generated value rounds to it anyway, and
 * pinning it removes any doubt that the page ground is exactly `#ffffff`.
 */
export function generateNeutralRamp(): Map<number, string> {
  const ramp = new Map<number, string>();
  for (const stop of NEUTRAL_STOPS) {
    if (stop === 0) {
      ramp.set(stop, '#ffffff');
      continue;
    }
    const lightness = interpolate(stop, NEUTRAL_LIGHTNESS);
    const chroma = interpolate(lightness, NEUTRAL_CHROMA);
    ramp.set(stop, toHex(oklch(lightness, chroma, NEUTRAL_HUE)));
  }
  return ramp;
}

/**
 * The lightness at which a hue first meets the contrast target against a given
 * background — the *boundary*, not an extreme.
 *
 * Against a light ground the colour must darken, and the answer is the lightest
 * value that still passes; against a dark ground it must lighten, and the
 * answer is the darkest that still passes. Either way the colour departs from
 * the background only as far as the requirement forces it to, which is what
 * keeps the accents vivid instead of uniformly muddy.
 */
function solveLightness(
  chroma: number,
  hue: number,
  background: string,
  move: 'darken' | 'lighten',
): number {
  let low: number = ACCENT_LIGHTNESS_RANGE.min;
  let high: number = ACCENT_LIGHTNESS_RANGE.max;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const passes = contrastRatio(toHex(oklch(mid, chroma, hue)), background) >= CONTRAST_TARGET;
    if (move === 'darken') {
      if (passes) low = mid;
      else high = mid;
    } else if (passes) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return move === 'darken' ? low : high;
}

/** The six tokens for every accent hue, in both themes. */
export function generateAccents(
  neutral: ReadonlyMap<number, string>,
): Map<AccentName, AccentTokens> {
  const surface1Light = required(neutral, NEUTRAL_ROLES.surface1.light);
  const surface1Dark = required(neutral, NEUTRAL_ROLES.surface1.dark);

  const accents = new Map<AccentName, AccentTokens>();
  for (const [name, { hue, chroma }] of Object.entries(ACCENTS) as [
    AccentName,
    (typeof ACCENTS)[AccentName],
  ][]) {
    const fillLightness = solveLightness(chroma, hue, '#ffffff', 'darken');

    const bg: Themed = {
      light: toHex(oklch(TINTS.bg.light.lightness, TINTS.bg.light.chroma, hue)),
      dark: toHex(oklch(TINTS.bg.dark.lightness, TINTS.bg.dark.chroma, hue)),
    };

    accents.set(name, {
      fill: toHex(oklch(fillLightness, chroma, hue)),
      fillHover: toHex(oklch(fillLightness - HOVER_LIGHTNESS_STEP, chroma, hue)),
      text: {
        light: toHex(oklch(solveLightness(chroma, hue, surface1Light, 'darken'), chroma, hue)),
        dark: toHex(oklch(solveLightness(chroma, hue, surface1Dark, 'lighten'), chroma, hue)),
      },
      bg,
      onBg: {
        light: toHex(oklch(solveLightness(chroma, hue, bg.light, 'darken'), chroma, hue)),
        dark: toHex(oklch(solveLightness(chroma, hue, bg.dark, 'lighten'), chroma, hue)),
      },
      border: {
        light: toHex(oklch(TINTS.border.light.lightness, TINTS.border.light.chroma, hue)),
        dark: toHex(oklch(TINTS.border.dark.lightness, TINTS.border.dark.chroma, hue)),
      },
    });
  }
  return accents;
}

/** Eight categorical series, one lightness per theme. */
export function generateChartSeries(): ChartSeries[] {
  return CHART_SERIES.map(({ name, hue }) => ({
    name,
    light: toHex(oklch(CHART_LIGHTNESS.light, CHART_CHROMA, hue)),
    dark: toHex(oklch(CHART_LIGHTNESS.dark, CHART_CHROMA, hue)),
  }));
}

/** The whole palette. The only permitted source of the values in §4. */
export function generatePalette(): Palette {
  const neutral = generateNeutralRamp();
  return { neutral, accents: generateAccents(neutral), chart: generateChartSeries() };
}

function required(ramp: ReadonlyMap<number, string>, stop: number): string {
  const value = ramp.get(stop);
  if (value === undefined) {
    throw new Error(`The neutral ramp has no stop ${String(stop)}.`);
  }
  return value;
}

export { required as neutralAt };
