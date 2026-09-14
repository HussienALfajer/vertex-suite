/**
 * OKLCH to sRGB, and the gamut fitting the palette depends on.
 *
 * The palette is defined in OKLCH because lightness there is perceptual: two
 * colours at the same `l` read as equally light, which is what lets the chart
 * series of §4.7 be pinned to one lightness and carry no false emphasis.
 */

/** A colour in OKLCH. `l` is 0–1, `c` is unbounded in principle, `h` in degrees. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** Linear-light sRGB, before the transfer function. Channels may fall outside 0–1. */
interface LinearRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// OKLab → LMS'. Björn Ottosson's constants.
const LAB_TO_LMS = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
] as const;

// LMS → linear sRGB.
const LMS_TO_RGB = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
] as const;

function apply(
  matrix: readonly (readonly number[])[],
  v: readonly number[],
): [number, number, number] {
  const out: number[] = [];
  for (const row of matrix) {
    let total = 0;
    for (let i = 0; i < 3; i += 1) {
      total += (row[i] ?? 0) * (v[i] ?? 0);
    }
    out.push(total);
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

function toLinearRgb({ l, c, h }: Oklch): LinearRgb {
  const radians = (h * Math.PI) / 180;
  const lms = apply(LAB_TO_LMS, [l, c * Math.cos(radians), c * Math.sin(radians)]).map(
    (value) => value ** 3,
  );
  const [r, g, b] = apply(LMS_TO_RGB, lms);
  return { r, g, b };
}

/** The sRGB transfer function. */
function encode(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.max(channel, 0) ** (1 / 2.4) - 0.055;
}

/** True when every channel lands inside the displayable range. */
export function isInGamut(colour: Oklch): boolean {
  const { r, g, b } = toLinearRgb(colour);
  return [r, g, b].every((channel) => {
    const encoded = encode(channel);
    return encoded >= -1e-6 && encoded <= 1 + 1e-6;
  });
}

/**
 * Brings a colour inside sRGB by **reducing chroma only**, by bisection.
 *
 * Lightness is never altered, because lightness is the variable carrying the
 * contrast guarantee: a colour that was solved to meet 4.5:1 must still meet it
 * after fitting, and only chroma is free to move.
 */
export function fitToGamut(colour: Oklch): Oklch {
  if (isInGamut(colour)) return colour;
  let low = 0;
  let high = colour.c;
  for (let i = 0; i < 64; i += 1) {
    const mid = (low + high) / 2;
    if (isInGamut({ ...colour, c: mid })) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return { ...colour, c: low };
}

/** The displayable hex for a colour, fitted to gamut first. */
export function toHex(colour: Oklch): string {
  const { r, g, b } = toLinearRgb(fitToGamut(colour));
  return `#${[r, g, b]
    .map((channel) => {
      const value = Math.min(1, Math.max(0, encode(channel)));
      return Math.min(255, Math.max(0, Math.floor(value * 255 + 0.5)))
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

/** Builds a colour at a lightness given as a percentage, as the specification states them. */
export function oklch(lightnessPercent: number, chroma: number, hue: number): Oklch {
  return { l: lightnessPercent / 100, c: chroma, h: hue };
}
