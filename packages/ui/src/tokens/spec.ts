/**
 * The inputs of Appendix A, as data.
 *
 * Everything in §4 of `design-system.md` is derived from the values in this
 * file. Changing one of them regenerates the whole palette and re-runs every
 * contrast assertion — which is the point: a colour is never edited, an input
 * is changed and the suite either accepts the result or refuses it.
 */

/** A point on an interpolation curve. */
export interface Anchor {
  readonly at: number;
  readonly value: number;
}

/** The faint yellow-green that makes the neutral read as warm rather than clinical. */
export const NEUTRAL_HUE = 95;

/** Lightness per ramp stop, in percent. Interpolated linearly between anchors. */
export const NEUTRAL_LIGHTNESS: readonly Anchor[] = [
  { at: 0, value: 100.0 },
  { at: 50, value: 95.2 },
  { at: 100, value: 90.6 },
  { at: 200, value: 81.0 },
  { at: 300, value: 71.7 },
  { at: 450, value: 57.6 },
  { at: 500, value: 52.8 },
  { at: 600, value: 43.5 },
  { at: 700, value: 33.5 },
  { at: 800, value: 24.3 },
  { at: 850, value: 19.6 },
  { at: 900, value: 15.0 },
];

/**
 * Chroma as a function of lightness, peaking at `L ≈ 72` and falling toward
 * both ends but never reaching zero — so the warmth stays visible on the large
 * surfaces in dark mode as well as light.
 */
export const NEUTRAL_CHROMA: readonly Anchor[] = [
  { at: 100, value: 0.0 },
  { at: 99, value: 0.0022 },
  { at: 95, value: 0.0048 },
  { at: 90, value: 0.0072 },
  { at: 81, value: 0.0105 },
  { at: 72, value: 0.013 },
  { at: 58, value: 0.0118 },
  { at: 53, value: 0.0105 },
  { at: 43, value: 0.0085 },
  { at: 33, value: 0.0068 },
  { at: 24, value: 0.0052 },
  { at: 19, value: 0.0044 },
  { at: 15, value: 0.0038 },
];

/**
 * The 35 stops. Compressed from 810 upward on purpose: dark-mode surfaces need
 * very small separations between a page, a panel and a popover.
 */
export const NEUTRAL_STOPS: readonly number[] = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650,
  700, 750, 800, 810, 820, 830, 840, 850, 860, 870, 880, 890, 900,
];

/** The five accent hues. A sixth is not added because a screen wants variety. */
export type AccentName = 'blue' | 'green' | 'red' | 'amber' | 'teal';

export interface AccentSpec {
  readonly hue: number;
  readonly chroma: number;
}

export const ACCENTS: Readonly<Record<AccentName, AccentSpec>> = {
  blue: { hue: 250, chroma: 0.15 },
  green: { hue: 150, chroma: 0.15 },
  red: { hue: 27, chroma: 0.165 },
  amber: { hue: 75, chroma: 0.15 },
  teal: { hue: 195, chroma: 0.11 },
};

/**
 * The role each hue carries. This mapping is what turns `blue` into
 * `fill-accent` and `red` into `fill-danger`; without it the `on-*` tokens of
 * §4.4 name foregrounds for fills that have no definition.
 */
export const ACCENT_ROLES: Readonly<
  Record<'accent' | 'success' | 'danger' | 'warning' | 'info', AccentName>
> = {
  accent: 'blue',
  success: 'green',
  danger: 'red',
  warning: 'amber',
  info: 'teal',
};

/**
 * A tenth over the 4.5 target, so that quantisation to 8 bits per channel can
 * never drop a solved pair below the requirement.
 */
export const CONTRAST_TARGET = 4.6;

/** The lightness window the accent solver searches, in percent. */
export const ACCENT_LIGHTNESS_RANGE = { min: 12, max: 95 } as const;

/** A hover fill is the fill five lightness points darker. Contrast rises on hover. */
export const HOVER_LIGHTNESS_STEP = 5;

/**
 * Tints are fixed-lightness, chroma-capped derivations rather than solved ones:
 * a background or a border must never compete with a fill for attention.
 */
export const TINTS = {
  bg: { light: { lightness: 93, chroma: 0.055 }, dark: { lightness: 26, chroma: 0.06 } },
  border: { light: { lightness: 82, chroma: 0.085 }, dark: { lightness: 38, chroma: 0.08 } },
} as const;

/**
 * Eight categorical series, all at one lightness per theme so that the order of
 * a chart legend encodes no emphasis the data does not carry.
 */
export const CHART_SERIES: readonly { readonly name: string; readonly hue: number }[] = [
  { name: 'blue', hue: 250 },
  { name: 'amber', hue: 75 },
  { name: 'teal', hue: 195 },
  { name: 'red', hue: 27 },
  { name: 'green', hue: 150 },
  { name: 'violet', hue: 300 },
  { name: 'magenta', hue: 345 },
  { name: 'olive', hue: 110 },
];

export const CHART_CHROMA = 0.145;
export const CHART_LIGHTNESS = { light: 58, dark: 74 } as const;

/** Which neutral stop each surface and text token resolves to. */
export const NEUTRAL_ROLES = {
  surface0: { light: 20, dark: 900 },
  surface1: { light: 10, dark: 850 },
  surface2: { light: 0, dark: 830 },
  surface3: { light: 0, dark: 810 },
  textPrimary: { light: 900, dark: 50 },
  textSecondary: { light: 600, dark: 200 },
  textMuted: { light: 400, dark: 400 },
} as const;

/**
 * The 35-stop neutral ramp, adopted (2026) from a third-party design system's
 * own published values in place of the OKLCH-solved ramp `NEUTRAL_LIGHTNESS`/
 * `NEUTRAL_CHROMA` above once produced — a deliberate, reviewed decision to
 * import a hand-tuned warm-neutral ramp rather than continue solving one.
 * `generateNeutralRamp` reads this table directly; the anchors above are kept
 * as the path back to an algorithmically solved ramp, not as dead weight.
 *
 * `palette.test.ts` pins every one of the 35 values, and `contrast.test.ts`
 * names the one pair in this ramp (`text-muted`, light theme) that does not
 * clear the product's own 4.5:1 floor — an accepted, measured exception, not
 * an oversight; see that file's banner comment for the reasoning.
 */
export const NEUTRAL_RAMP_HEX: Readonly<Record<number, string>> = {
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

/**
 * The five accent hues, adopted the same way and at the same time as
 * `NEUTRAL_RAMP_HEX` — literal values in place of `generateAccents`' own
 * contrast-solved lightness.
 *
 * `warning` alone breaks the fill/fillHover pattern the other four keep
 * (450 then 400): at very light stops a hover has to move *further* from
 * white to read as a hover at all, so its source moves stop 200 to 250 —
 * darker, not lighter. This is not a bug carried over from the other four;
 * the source system makes the same exception.
 *
 * `contrast.test.ts` names three pairs here that do not clear the 4.5:1
 * floor — `accent` at rest and on hover, `danger` on hover — as accepted,
 * measured exceptions; every other pair is still held to the floor.
 */
export const ACCENT_PALETTE_HEX: Readonly<
  Record<
    AccentName,
    {
      readonly fill: string;
      readonly fillHover: string;
      readonly text: { readonly light: string; readonly dark: string };
      readonly bg: { readonly light: string; readonly dark: string };
      readonly border: { readonly light: string; readonly dark: string };
    }
  >
> = {
  blue: {
    fill: '#2a78d6',
    fillHover: '#3987e5',
    text: { light: '#184f95', dark: '#6da7ec' },
    bg: { light: '#cde2fb', dark: '#032042' },
    border: { light: '#86b6ef', dark: '#0d366b' },
  },
  green: {
    fill: '#009300',
    fillHover: '#0ca30c',
    // The one role whose dark-mode text is a stop darker than the rest
    // (400, not 300) in the source system as well — green at 300 did not
    // clear its own contrast floor against a dark surface.
    text: { light: '#006300', dark: '#0ca30c' },
    bg: { light: '#caeac7', dark: '#11260f' },
    border: { light: '#73cb6d', dark: '#074506' },
  },
  red: {
    fill: '#d03b3b',
    fillHover: '#e34948',
    text: { light: '#8e2626', dark: '#ec7e7e' },
    bg: { light: '#fad6d6', dark: '#3c0e0e' },
    border: { light: '#f09595', dark: '#641919' },
  },
  amber: {
    fill: '#fab219',
    fillHover: '#eda100',
    text: { light: '#734500', dark: '#db9300' },
    bg: { light: '#f9dca4', dark: '#311a00' },
    border: { light: '#eda100', dark: '#512e00' },
  },
  teal: {
    fill: '#138e65',
    fillHover: '#199e70',
    text: { light: '#065f49', dark: '#3bbd8c' },
    bg: { light: '#bfebdb', dark: '#022720' },
    border: { light: '#5acba0', dark: '#034235' },
  },
};

/**
 * The foreground each filled accent role carries.
 *
 * §4.4 no longer gives every fill the same label colour: this picks
 * whichever of black or white actually clears the contrast floor against
 * that specific fill, and `success`, `warning` and `info` sit at a lightness
 * where white does not. `info` is a role the source palette does not define
 * at all — decided here the same way, by measuring its own fill against both.
 */
export const ON_ROLE_HEX: Readonly<Record<keyof typeof ACCENT_ROLES, string>> = {
  accent: '#ffffff',
  danger: '#ffffff',
  success: '#0b0b0b',
  warning: '#0b0b0b',
  info: '#0b0b0b',
};
