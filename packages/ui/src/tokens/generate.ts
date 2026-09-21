import {
  ACCENT_PALETTE_HEX,
  CHART_CHROMA,
  CHART_LIGHTNESS,
  CHART_SERIES,
  NEUTRAL_RAMP_HEX,
  NEUTRAL_STOPS,
  type AccentName,
} from './spec.js';
import { oklch, toHex } from './oklch.js';

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
 * Reads `NEUTRAL_RAMP_HEX` literally rather than solving one from
 * `NEUTRAL_LIGHTNESS`/`NEUTRAL_CHROMA` — see that constant's own comment for
 * why. An algorithmically solved ramp is still one call away, should the
 * palette ever need to move again without another import to anchor it to:
 *
 * ```
 * const lightness = interpolate(stop, NEUTRAL_LIGHTNESS);
 * const chroma = interpolate(lightness, NEUTRAL_CHROMA);
 * ramp.set(stop, toHex(oklch(lightness, chroma, NEUTRAL_HUE)));
 * ```
 */
export function generateNeutralRamp(): Map<number, string> {
  const ramp = new Map<number, string>();
  for (const stop of NEUTRAL_STOPS) {
    const hex = NEUTRAL_RAMP_HEX[stop];
    if (hex === undefined) {
      throw new Error(`NEUTRAL_RAMP_HEX has no stop ${String(stop)}.`);
    }
    ramp.set(stop, hex);
  }
  return ramp;
}

/**
 * The six tokens for every accent hue, in both themes.
 *
 * Reads `ACCENT_PALETTE_HEX` literally instead of solving fill, text and
 * border lightness against the neutral ramp for `CONTRAST_TARGET` — see that
 * constant's own comment in `spec.ts`. It therefore takes no neutral ramp: a
 * solved version needs one as the background to solve `text` and `onBg`
 * against, and the day the solver comes back is the day the parameter does —
 * it once stayed on, ignored, under a lint exemption, which is a signature
 * saying something the function does not do.
 *
 * `onBg` is the same value as `text`: a role's tinted background is read with
 * exactly the ink that names the role elsewhere, which is the source
 * system's own choice and not a coincidence of this table.
 */
export function generateAccents(): Map<AccentName, AccentTokens> {
  const accents = new Map<AccentName, AccentTokens>();
  for (const [name, hue] of Object.entries(ACCENT_PALETTE_HEX) as [
    AccentName,
    (typeof ACCENT_PALETTE_HEX)[AccentName],
  ][]) {
    accents.set(name, {
      fill: hue.fill,
      fillHover: hue.fillHover,
      text: hue.text,
      bg: hue.bg,
      onBg: hue.text,
      border: hue.border,
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
  return { neutral, accents: generateAccents(), chart: generateChartSeries() };
}

function required(ramp: ReadonlyMap<number, string>, stop: number): string {
  const value = ramp.get(stop);
  if (value === undefined) {
    throw new Error(`The neutral ramp has no stop ${String(stop)}.`);
  }
  return value;
}

export { required as neutralAt };
