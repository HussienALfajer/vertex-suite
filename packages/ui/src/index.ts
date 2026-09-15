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

/** The product's own mark, which is not the tenant's brand — see §4.5. */
export { ProductMark, type ProductMarkProps, type ProductMarkTone } from './brand/ProductMark.js';

export { VertexProvider, type VertexProviderProps } from './providers/VertexProvider.js';
export { DensityScope, densityAtLeast, type DensityScopeProps } from './providers/DensityScope.js';
export {
  formattingLocaleFor,
  useDensity,
  useTranslator,
  useVertex,
  type Numerals,
  type ThemeChoice,
  type VertexContextValue,
} from './providers/context.js';

export { Money, type MoneyProps } from './display/Money.js';
export { Quantity, type QuantityProps } from './display/Quantity.js';
export { DateTime, type DateTimeProps } from './display/DateTime.js';
export { CurrencyRate, type CurrencyRateProps } from './display/CurrencyRate.js';
export { UnitLabel, type UnitLabelProps } from './display/UnitLabel.js';
export { decimalPlacesOf, formatExact, type FormattedFigure } from './display/format.js';

export { Button, IconButton, type ButtonProps, type IconButtonProps } from './components/Button.js';
export { TextInput, type TextInputProps } from './components/TextInput.js';
export { Panel, type PanelProps } from './components/Panel.js';
export { Page, PageHeader, type PageHeaderProps, type PageProps } from './components/Page.js';
export { Badge, type BadgeProps, type BadgeTone } from './components/Badge.js';
export { type Tone } from './components/styles.js';

export { Select, type SelectOption, type SelectProps } from './components/Select.js';
export { Checkbox, Switch, type CheckboxProps, type SwitchProps } from './components/Toggle.js';
export {
  ConfirmationDialog,
  Dialog,
  type ConfirmationDialogProps,
  type DialogProps,
} from './components/Dialog.js';
export {
  DataTable,
  TableRowAction,
  TableRowActions,
  type DataTableColumn,
  type DataTableProps,
  type TableRowActionsProps,
} from './components/DataTable.js';
export { EmptyState, type EmptyStateProps } from './components/EmptyState.js';
export { Banner, type BannerProps, type BannerTone } from './components/Banner.js';
export {
  ToastRegion,
  useToast,
  type ToastOptions,
  type ToastRegionProps,
  type ToastTone,
} from './components/Toast.js';
export {
  BreadcrumbTrail,
  SideNav,
  type BreadcrumbItem,
  type BreadcrumbTrailProps,
  type NavItem,
  type SideNavProps,
} from './components/Navigation.js';
