import { ACCENT_ROLES, CHART_SERIES, NEUTRAL_ROLES, NEUTRAL_STOPS } from './spec.js';
import type { Palette } from './generate.js';

const BANNER = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`pnpm --filter @vertex/ui tokens\` from the generator in
 * src/tokens. A colour is never changed here; an input in spec.ts is changed
 * and this file is regenerated, at which point the contrast suite either
 * accepts the result or refuses it.
 *
 * Layer 1 of 4 (§3.1): primitives. No component may reference these names.
 */
`;

function neutralVars(palette: Palette): string {
  return NEUTRAL_STOPS.map(
    (stop) => `  --vx-neutral-${String(stop)}: ${palette.neutral.get(stop) ?? ''};`,
  ).join('\n');
}

function accentVars(palette: Palette, theme: 'light' | 'dark'): string {
  const lines: string[] = [];
  for (const [name, tokens] of palette.accents) {
    lines.push(`  --vx-${name}-fill: ${tokens.fill};`);
    lines.push(`  --vx-${name}-fill-hover: ${tokens.fillHover};`);
    lines.push(`  --vx-${name}-text: ${tokens.text[theme]};`);
    lines.push(`  --vx-${name}-bg: ${tokens.bg[theme]};`);
    lines.push(`  --vx-${name}-on-bg: ${tokens.onBg[theme]};`);
    lines.push(`  --vx-${name}-border: ${tokens.border[theme]};`);
  }
  return lines.join('\n');
}

function chartVars(palette: Palette, theme: 'light' | 'dark'): string {
  return palette.chart
    .map((series, index) => `  --vx-chart-${String(index + 1)}: ${series[theme]};`)
    .join('\n');
}

function themeBlock(palette: Palette, theme: 'light' | 'dark'): string {
  return [accentVars(palette, theme), '', chartVars(palette, theme)].join('\n');
}

/**
 * The primitive layer, in the three-selector shape §3.2 requires: a light
 * default, a dark set when the system asks for it and the tenant has not
 * overridden, and a dark set when the tenant has chosen it explicitly.
 */
export function emitPrimitives(palette: Palette): string {
  const light = [neutralVars(palette), '', themeBlock(palette, 'light')].join('\n');
  const dark = themeBlock(palette, 'dark');

  return `${BANNER}
:root {
${light}
}

/* No explicit choice: follow the system. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${dark}
  }
}

/* An explicit choice always wins, in both directions. */
:root[data-theme='dark'] {
${dark}
}
`;
}

/** A machine-readable copy of the palette, for the snapshot test and for tooling. */
export function emitJson(palette: Palette): string {
  return `${JSON.stringify(
    {
      neutral: Object.fromEntries([...palette.neutral].map(([stop, hex]) => [String(stop), hex])),
      accents: Object.fromEntries([...palette.accents].map(([name, tokens]) => [name, tokens])),
      chart: palette.chart,
      roles: { accents: ACCENT_ROLES, neutrals: NEUTRAL_ROLES },
      series: CHART_SERIES.map((series) => series.name),
    },
    null,
    2,
  )}\n`;
}
