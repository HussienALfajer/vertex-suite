/**
 * Elevation, focus and motion, as data (§7.2, §7.3, §8).
 */

import type { ThemedToken } from './semantic.js';

/**
 * §7.2. Shadows are cast in the neutral rather than in pure black, so they stay
 * warm.
 *
 * Dark mode carries **stronger** shadows, not weaker: a dark surface separates
 * from a dark ground by shadow depth where a light one separates by lightness.
 */
export const ELEVATION: Readonly<Record<string, ThemedToken>> = {
  'shadow-sm': {
    light: '0 1px 2px rgb(12 11 9 / 0.05), 0 2px 8px rgb(12 11 9 / 0.06)',
    dark: '0 1px 2px rgb(0 0 0 / 0.3), 0 2px 8px rgb(0 0 0 / 0.24)',
  },
  'shadow-md': {
    light: '0 2px 4px rgb(12 11 9 / 0.06), 0 8px 20px rgb(12 11 9 / 0.07)',
    dark: '0 2px 4px rgb(0 0 0 / 0.32), 0 8px 20px rgb(0 0 0 / 0.28)',
  },
  'shadow-lg': {
    light: '0 4px 8px rgb(12 11 9 / 0.07), 0 16px 32px rgb(12 11 9 / 0.08)',
    dark: '0 4px 8px rgb(0 0 0 / 0.34), 0 16px 32px rgb(0 0 0 / 0.32)',
  },
  'shadow-dialog': {
    light: '0 8px 24px rgb(12 11 9 / 0.12), 0 2px 6px rgb(12 11 9 / 0.08)',
    dark: '0 8px 24px rgb(0 0 0 / 0.44), 0 2px 6px rgb(0 0 0 / 0.32)',
  },
};

/**
 * §7.3. Two layers — the page colour, then the accent — so the ring stays
 * visible against both a page and a coloured fill without a per-context
 * variant.
 *
 * Focus is always visible. `outline: none` without a replacement ring is a lint
 * failure, because a register is operated with no pointing device at all and a
 * cashier who cannot see focus cannot work.
 */
export const FOCUS_RING = '0 0 0 2px var(--vx-surface-1), 0 0 0 4px var(--vx-fill-accent)';

/** On a danger control the ring takes the danger hue, so the user sees what is about to happen. */
export const FOCUS_RING_DANGER = '0 0 0 2px var(--vx-surface-1), 0 0 0 4px var(--vx-fill-danger)';

/** Pills are reserved for badges and status chips: a pill-shaped button reads as a chip. */
export const RADIUS_PILL = '9999px';

/**
 * §8. Nothing animates that delays a keystroke. At the register a scan must
 * paint its line immediately; the line may fade in, but the value is present in
 * the same frame it is known.
 */
export const MOTION: Readonly<Record<string, string>> = {
  'dur-snap': '120ms',
  'dur-base': '160ms',
  'dur-slow': '200ms',
  'ease-out': 'cubic-bezier(0.2, 0, 0, 1)',
  'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
};

/** The durations that collapse to zero when motion is reduced. */
export const MOTION_DURATIONS: readonly string[] = ['dur-snap', 'dur-base', 'dur-slow'];
