export { contrastRatio, relativeLuminance } from './tokens/contrast.js';
export { fitToGamut, isInGamut, oklch, toHex, type Oklch } from './tokens/oklch.js';
export { interpolate } from './tokens/interpolate.js';

export {
  generateAccents,
  generateChartSeries,
  generateNeutralRamp,
  generatePalette,
  neutralAt,
  type AccentTokens,
  type ChartSeries,
  type Palette,
  type Themed,
} from './tokens/generate.js';

export {
  ACCENTS,
  ACCENT_ROLES,
  CHART_SERIES,
  CONTRAST_TARGET,
  NEUTRAL_HUE,
  NEUTRAL_ROLES,
  NEUTRAL_STOPS,
  type AccentName,
  type Anchor,
} from './tokens/spec.js';

export {
  BUNDLED_WEIGHTS,
  DEFAULT_DENSITY,
  DENSITIES,
  FONT_STACKS,
  SIZE_TOKENS,
  TOUCH_TARGET_FLOOR,
  TYPE_SCALE,
  WEIGHTS,
  WEIGHTS_DARK_COMPENSATED,
  type Density,
  type TypeRole,
} from './tokens/scale.js';

export {
  ACCENT_TOKENS,
  BORDERS,
  BRAND_FALLBACK,
  NEUTRAL_FILLS,
  SURFACES,
  TEXT,
  type ThemedToken,
} from './tokens/semantic.js';

export {
  ELEVATION,
  FOCUS_RING,
  FOCUS_RING_DANGER,
  MOTION,
  MOTION_DURATIONS,
  RADIUS_PILL,
} from './tokens/style.js';

/**
 * Per-tenant branding (§4.5). The one part of the palette a tenant supplies,
 * and the one whose readable foreground is computed rather than chosen.
 */
export {
  brandCustomProperties,
  resolveBrand,
  type BrandAccepted,
  type BrandRefused,
  type BrandResolution,
} from './tokens/brand.js';
