/**
 * Layer 3 of §3.1: the semantic tokens, as data.
 *
 * This is the only layer a screen is allowed to name. Everything here resolves
 * to a primitive, and per-tenant branding (§4.5) and every future theme change
 * happen here alone — which is what makes them configuration rather than a fork.
 */

import { ACCENT_ROLES, NEUTRAL_ROLES, ON_ROLE_HEX } from './spec.js';

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
  // 35% in both themes, not 38% — see `NEUTRAL_RAMP_HEX`.
  'text-disabled': { light: overlay(900, 35), dark: overlay(50, 35) },
};

// The dark-theme percentages here used to run heavier than the light-theme
// ones (12% and 22%, against 10% and 20%); both themes now carry the same
// figure, matching the source palette's own symmetric alpha scale. See
// `NEUTRAL_RAMP_HEX`. What `border-strong` measures as a control's edge is
// an open decision (`design-system.md` §14, item 4).
export const BORDERS: Readonly<Record<string, ThemedToken>> = {
  border: { light: overlay(900, 10), dark: overlay(50, 10) },
  'border-strong': { light: overlay(900, 20), dark: overlay(50, 20) },
};

/**
 * The neutral fills, and the one foreground each of them requires.
 *
 * Every fill that can be hovered carries its own hover **value**, not an
 * effect. Fading a fill with opacity lets the ground show through, which on a
 * dark theme reads as dirt rather than as response — and on the neutral
 * primary, whose fill is near-white there, it is indistinguishable from a
 * disabled control.
 *
 * The primary moves one step along the ramp toward the middle: darker in the
 * light theme, lighter in the dark one. Its paired foreground is unchanged
 * either way, so the label cannot become unreadable at the moment the pointer
 * arrives.
 */
export const NEUTRAL_FILLS: Readonly<Record<string, ThemedToken>> = {
  // The dark fill used to be `neutral(50)` — an off-white a touch short of
  // the ramp's own white — with `neutral(10)` as its label. Both are now the
  // ramp's actual extremes: the source palette's primary button is literally
  // pure black-on-white / white-on-black.
  'fill-primary': { light: neutral(900), dark: neutral(0) },
  // One stop darker than before (`neutral(800)`), matching the source
  // palette's own hover — its warm-black ladder is compressed enough near
  // black that the difference reads as one visible step, not a rounding one.
  'fill-primary-hover': { light: neutral(750), dark: neutral(100) },
  'fill-secondary': { light: 'var(--vx-surface-2)', dark: overlay(50, 8) },
  // Not `fill-ghost-hover`: in the dark theme the two resolve to the same
  // value, so a default button's hover was a no-op that nobody could see.
  'fill-secondary-hover': { light: neutral(50), dark: overlay(50, 14) },
  // 5% and 7.5%, matching the source palette exactly (were 6% and 8%).
  'fill-ghost-hover': { light: overlay(900, 5), dark: overlay(50, 7.5) },
  'fill-field': { light: 'var(--vx-surface-2)', dark: overlay(50, 5) },
  // Pure white now that `fill-primary` is the ramp's actual white, not the
  // off-white (`neutral(10)`) it used to label.
  'on-primary': { light: neutral(0), dark: neutral(900) },
};

/**
 * Layer 4 of §3.1: tokens owned by one component.
 *
 * A component earns one when no semantic token can express what it needs — not
 * when a screen wants a shade. Each still resolves to the semantic layer or to
 * an overlay over it, never to a primitive by name.
 *
 * The switch is the first. It has to keep two halves distinguishable in four
 * combinations at once — track and knob, off and on, light and dark — and
 * `fill-secondary` cannot be the track: in the light theme it resolves to
 * `surface-2`, the same white as the knob, and the knob disappears.
 */
export const COMPONENT_TOKENS: Readonly<Record<string, ThemedToken>> = {
  // `border-strong` as a fill: an overlay at 20% in both themes is exactly
  // the recessed grey a track wants, and it is already semantic — so the track
  // follows a theme change without a value of its own.
  'switch-track': { light: 'var(--vx-border-strong)', dark: 'var(--vx-border-strong)' },
  'switch-track-on': { light: 'var(--vx-fill-primary)', dark: 'var(--vx-fill-primary)' },
  'switch-knob': { light: 'var(--vx-surface-2)', dark: 'var(--vx-text-secondary)' },
  // The knob on carries the paired foreground of the track it sits on — the
  // same rule as any label on a fill — so it inverts with the theme for free.
  'switch-knob-on': { light: 'var(--vx-on-primary)', dark: 'var(--vx-on-primary)' },

  /**
   * The map's land, for the same reason the switch has a track.
   *
   * `SYS-14` draws a landmass on a page, and the surfaces cannot do it: in the
   * light theme `surface-2` and `surface-3` are both `neutral-0`, the same
   * white as `surface-1` is nearly — so a map built from them is an outline of
   * nothing, which is exactly what the first one was. What a landmass wants is
   * a **tint of the ink over the page**, which is what the border tokens
   * already are, used as a fill rather than as a line. They invert with the
   * theme on their own, so the map does too, with no value of its own here.
   *
   * The country the edition is sold in takes the stronger of the two: the
   * question a person is asking is "where is my branch", and the answer reads
   * faster when their own country is the subject and its neighbours context.
   */
  'map-land': { light: 'var(--vx-border)', dark: 'var(--vx-border)' },
  'map-land-home': { light: 'var(--vx-border-strong)', dark: 'var(--vx-border-strong)' },
  // A line, not a fill: `text-muted` is the quietest ink the palette measures,
  // which is what a coastline should be beside a marker that has to be seen.
  'map-line': { light: 'var(--vx-text-muted)', dark: 'var(--vx-text-muted)' },

  /**
   * What a modal dims the page with. Both dialogs once wrote the mixture out
   * against `--vx-neutral-900` by name, which is a primitive in a component —
   * the thing §3.1 says no component may reference.
   */
  'dialog-scrim': { light: overlay(900, 45), dark: overlay(900, 45) },
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
    // Used to be `'#ffffff'` for every role, unconditionally (§4.4's old
    // rule: "white in either theme"). `success`, `warning` and `info` sit at
    // a lightness where white does not clear the contrast floor against
    // their own fill — see `ON_ROLE_HEX`'s comment in `spec.ts`.
    [`on-${role}`]: ON_ROLE_HEX[role as keyof typeof ON_ROLE_HEX],
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
