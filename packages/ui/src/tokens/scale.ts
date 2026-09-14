/**
 * Type, density and size, as data (§5.2, §5.3, §5.4, §6.2).
 *
 * Every number here is published in `design-system.md`, and `theme.test.ts`
 * asserts these against that document. A size is never edited to make a screen
 * fit; the screen is built to the size.
 */

export type Density = 'compact' | 'comfortable' | 'touch';

export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'touch'];

/** The default. An entry error costs far more than a scroll. */
export const DEFAULT_DENSITY: Density = 'comfortable';

/** A type role: font size and line height, in px, per density. */
export interface TypeRole {
  readonly compact: readonly [size: number, lineHeight: number];
  readonly comfortable: readonly [size: number, lineHeight: number];
  readonly touch: readonly [size: number, lineHeight: number];
}

/**
 * Derived for Arabic, not adapted from a Latin scale. The floor is 12px, not
 * 11px, because Arabic distinguishes ب ت ث ن ي largely by dot count and
 * position, and at 11px on a register screen at arm's length those collapse.
 * Line height runs 1–2px taller at every size because Arabic ascenders and
 * descenders overlap far more than Latin ones.
 */
export const TYPE_SCALE: Readonly<Record<string, TypeRole>> = {
  caption: { compact: [12, 17], comfortable: [12, 18], touch: [14, 20] },
  footnote: { compact: [12, 18], comfortable: [13, 19], touch: [15, 22] },
  code: { compact: [12, 18], comfortable: [13, 19], touch: [15, 22] },
  body: { compact: [13, 20], comfortable: [14, 22], touch: [17, 26] },
  heading: { compact: [15, 21], comfortable: [16, 22], touch: [18, 26] },
  title: { compact: [20, 28], comfortable: [22, 30], touch: [24, 32] },
  page: { compact: [24, 32], comfortable: [26, 34], touch: [28, 36] },
};

/** §5.3. Italic is absent on purpose: Arabic has no italic form. */
export const WEIGHTS: Readonly<Record<string, number>> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

/**
 * §5.4, resolved: IBM Plex Sans Arabic ships static weights only, so dark mode
 * steps text at body size and above down one named weight. Light text on a dark
 * ground blooms optically and reads heavier than the same weight on a light one.
 *
 * `regular` has nowhere to step down to and stays put — which is also why
 * caption and footnote, almost always regular, need no separate treatment.
 */
export const WEIGHTS_DARK_COMPENSATED: Readonly<Record<string, number>> = {
  regular: 400,
  medium: 400,
  semibold: 500,
  bold: 600,
};

/** §6.2. All values in px. */
export const SIZE_TOKENS: Readonly<Record<string, Readonly<Record<Density, number>>>> = {
  'h-control': { compact: 24, comfortable: 32, touch: 48 },
  'h-control-nested': { compact: 18, comfortable: 22, touch: 32 },
  'h-row': { compact: 28, comfortable: 36, touch: 52 },
  icon: { compact: 16, comfortable: 20, touch: 24 },
  radius: { compact: 6, comfortable: 8, touch: 10 },
  'radius-card': { compact: 10, comfortable: 12, touch: 14 },
  checkbox: { compact: 16, comfortable: 20, touch: 28 },
  'switch-h': { compact: 16, comfortable: 20, touch: 28 },
  'pad-xs': { compact: 4, comfortable: 6, touch: 8 },
  'pad-sm': { compact: 6, comfortable: 8, touch: 12 },
  'pad-md': { compact: 8, comfortable: 12, touch: 16 },
  'pad-lg': { compact: 12, comfortable: 16, touch: 22 },
  'pad-xl': { compact: 20, comfortable: 24, touch: 32 },
  'gap-xs': { compact: 6, comfortable: 8, touch: 10 },
  'gap-sm': { compact: 8, comfortable: 12, touch: 16 },
  'gap-md': { compact: 12, comfortable: 16, touch: 22 },
  'gap-lg': { compact: 20, comfortable: 28, touch: 32 },
  'gap-xl': { compact: 32, comfortable: 40, touch: 48 },
};

/**
 * §6.3. On a touch surface every interactive target is at least this, including
 * icon-only buttons, table row actions and the close control of a dialog. A
 * target smaller than this is a bug, not a style choice.
 */
export const TOUCH_TARGET_FLOOR = 48;

/** §5.1. Bundled with the application; never fetched from a network. */
export const FONT_STACKS: Readonly<Record<string, string>> = {
  sans: '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, system-ui, sans-serif',
  latin: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
};

/** The weights actually bundled, per family. */
export const BUNDLED_WEIGHTS: Readonly<Record<string, readonly number[]>> = {
  sans: [400, 500, 600, 700],
  latin: [400, 500, 600, 700],
  // Mono carries codes, barcodes and identifiers, and the amount on a receipt.
  // It is never a page title, so 700 is not bundled.
  mono: [400, 500, 600],
};
