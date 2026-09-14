/**
 * Layer 3 of §3.1: the semantic tokens, as data.
 *
 * This is the only layer a screen is allowed to name. Everything here resolves
 * to a primitive, and per-tenant branding (§4.5) and every future theme change
 * happen here alone — which is what makes them configuration rather than a fork.
 */

import { ACCENT_ROLES, NEUTRAL_ROLES } from './spec.js';

/** A semantic token whose value differs between the themes. */
export interface ThemedToken {
  readonly light: string;
  readonly dark: string;
}

const neutral = (stop: number): string => `var(--vx-neutral-${String(stop)})`;

/**
 * An alpha overlay over a neutral.
 *
 * Borders and dimmed fills are overlays, never solid colours: a solid value is
 * one more thing to maintain per surface and drifts the moment a surface
 * changes, where an overlay composites correctly on all four by construction.
 */
const overlay = (stop: number, percent: number): string =>
  `color-mix(in srgb, ${neutral(stop)} ${String(percent)}%, transparent)`;

/** Surfaces and text, straight from §4.4. */
export const SURFACES: Readonly<Record<string, ThemedToken>> = {
  'surface-0': {
    light: neutral(NEUTRAL_ROLES.surface0.light),
    dark: neutral(NEUTRAL_ROLES.surface0.dark),
  },
  'surface-1': {
    light: neutral(NEUTRAL_ROLES.surface1.light),
    dark: neutral(NEUTRAL_ROLES.surface1.dark),
  },
  'surface-2': {
    light: neutral(NEUTRAL_ROLES.surface2.light),
    dark: neutral(NEUTRAL_ROLES.surface2.dark),
  },
  'surface-3': {
    light: neutral(NEUTRAL_ROLES.surface3.light),
    dark: neutral(NEUTRAL_ROLES.surface3.dark),
  },
};

export const TEXT: Readonly<Record<string, ThemedToken>> = {
  'text-primary': {
    light: neutral(NEUTRAL_ROLES.textPrimary.light),
    dark: neutral(NEUTRAL_ROLES.textPrimary.dark),
  },
  'text-secondary': {
    light: neutral(NEUTRAL_ROLES.textSecondary.light),
    dark: neutral(NEUTRAL_ROLES.textSecondary.dark),
  },
  'text-muted': {
    light: neutral(NEUTRAL_ROLES.textMuted.light),
    dark: neutral(NEUTRAL_ROLES.textMuted.dark),
  },
  'text-disabled': { light: overlay(900, 38), dark: overlay(50, 38) },
};

export const BORDERS: Readonly<Record<string, ThemedToken>> = {
  border: { light: overlay(900, 10), dark: overlay(50, 12) },
  'border-strong': { light: overlay(900, 20), dark: overlay(50, 22) },
};

/** The neutral fills, and the one foreground each of them requires. */
export const NEUTRAL_FILLS: Readonly<Record<string, ThemedToken>> = {
  'fill-primary': { light: neutral(900), dark: neutral(50) },
  'fill-secondary': { light: 'var(--vx-surface-2)', dark: overlay(50, 8) },
  'fill-ghost-hover': { light: overlay(900, 6), dark: overlay(50, 8) },
  'fill-field': { light: 'var(--vx-surface-2)', dark: overlay(50, 5) },
  'on-primary': { light: neutral(10), dark: neutral(900) },
};

/**
 * The five accent roles.
 *
 * A screen never names a hue, only a role. That indirection is what lets the
 * palette change hue without a screen changing, and it is why these aliases do
 * not carry a light and a dark value: the primitive they point at already
 * switches with the theme.
 */
export const ACCENT_TOKENS: readonly {
  readonly role: string;
  readonly hue: string;
  readonly tokens: Readonly<Record<string, string>>;
}[] = Object.entries(ACCENT_ROLES).map(([role, hue]) => ({
  role,
  hue,
  tokens: {
    [`fill-${role}`]: `var(--vx-${hue}-fill)`,
    [`fill-${role}-hover`]: `var(--vx-${hue}-fill-hover)`,
    [`text-${role}`]: `var(--vx-${hue}-text)`,
    [`bg-${role}`]: `var(--vx-${hue}-bg)`,
    [`on-bg-${role}`]: `var(--vx-${hue}-on-bg)`,
    [`border-${role}`]: `var(--vx-${hue}-border)`,
    // §4.4: a label on a filled accent is white in either theme.
    [`on-${role}`]: '#ffffff',
  },
}));

/**
 * The tenant's brand (§4.5).
 *
 * Deliberately a fallback rather than a value: there is no brand colour in the
 * palette, and a tenant that supplies none gets the neutral primary rather than
 * a colour this product chose on their behalf. `on-brand` is computed at load
 * by `resolveBrand`, never guessed.
 */
export const BRAND_FALLBACK: Readonly<Record<string, ThemedToken>> = {
  'fill-brand': { light: 'var(--vx-fill-primary)', dark: 'var(--vx-fill-primary)' },
  'on-brand': { light: 'var(--vx-on-primary)', dark: 'var(--vx-on-primary)' },
};
