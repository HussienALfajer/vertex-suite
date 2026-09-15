import {
  ACCENT_TOKENS,
  BORDERS,
  BRAND_FALLBACK,
  COMPONENT_TOKENS,
  NEUTRAL_FILLS,
  SURFACES,
  TEXT,
  type ThemedToken,
} from './semantic.js';
import {
  DEFAULT_DENSITY,
  DENSITIES,
  FONT_STACKS,
  SIZE_TOKENS,
  TYPE_SCALE,
  WEIGHTS,
  WEIGHTS_DARK_COMPENSATED,
  type Density,
} from './scale.js';
import {
  ELEVATION,
  FOCUS_RING,
  FOCUS_RING_DANGER,
  MOTION,
  MOTION_DURATIONS,
  RADIUS_PILL,
} from './style.js';

const BANNER = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`pnpm --filter @vertex/ui tokens\`. Every value is published in
 * design-system.md and asserted against it by theme.test.ts, so a size, weight
 * or duration cannot be changed here without the document changing first.
 *
 * Layers 2–3 of 4 (§3.1): alias and semantic. This is the only layer a screen
 * is allowed to name.
 */
`;

const line = (name: string, value: string | number): string => `  --vx-${name}: ${String(value)};`;

function themed(group: Readonly<Record<string, ThemedToken>>, theme: 'light' | 'dark'): string[] {
  return Object.entries(group).map(([name, token]) => line(name, token[theme]));
}

function semanticBlock(theme: 'light' | 'dark'): string[] {
  return [
    '  /* Surfaces */',
    ...themed(SURFACES, theme),
    '',
    '  /* Text */',
    ...themed(TEXT, theme),
    '',
    '  /* Separation */',
    ...themed(BORDERS, theme),
    '',
    '  /* Neutral fills, each with the one foreground it requires */',
    ...themed(NEUTRAL_FILLS, theme),
    '',
    '  /* Elevation */',
    ...themed(ELEVATION, theme),
    '',
    '  /* Component tokens (layer 4 of §3.1), owned by the component named */',
    ...themed(COMPONENT_TOKENS, theme),
  ];
}

function accentBlock(): string[] {
  const out: string[] = ['  /* Accent roles. A screen names a role, never a hue. */'];
  for (const { role, tokens } of ACCENT_TOKENS) {
    out.push(`  /* ${role} */`);
    for (const [name, value] of Object.entries(tokens)) {
      out.push(line(name, value));
    }
  }
  return out;
}

function typeBlock(density: Density): string[] {
  const out: string[] = [];
  for (const [role, sizes] of Object.entries(TYPE_SCALE)) {
    const pair = sizes[density];
    // Not `text-${role}`: `--vx-text-primary` is a colour and `--vx-text-body`
    // would be a size. One prefix, two meanings, is how a screen picks the
    // wrong token.
    out.push(line(`font-size-${role}`, `${String(pair[0])}px`));
    out.push(line(`line-height-${role}`, `${String(pair[1])}px`));
  }
  return out;
}

function sizeBlock(density: Density): string[] {
  return Object.entries(SIZE_TOKENS).map(([name, byDensity]) =>
    line(name, `${String(byDensity[density])}px`),
  );
}

function densityBlock(density: Density): string[] {
  return ['  /* Sizes */', ...sizeBlock(density), '', '  /* Type */', ...typeBlock(density)];
}

function weightBlock(compensated: boolean): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(WEIGHTS)) {
    out.push(line(`weight-${name}`, value));
  }
  const bodyScale = compensated ? WEIGHTS_DARK_COMPENSATED : WEIGHTS;
  for (const [name, value] of Object.entries(bodyScale)) {
    out.push(line(`weight-body-${name}`, value));
  }
  return out;
}

/** The alias and semantic layers, in the three-selector shape §3.2 requires. */
export function emitTheme(): string {
  const light = [
    '  /* Families — bundled with the application, never fetched (§5.1) */',
    ...Object.entries(FONT_STACKS).map(([name, stack]) => line(`font-${name}`, stack)),
    '',
    ...semanticBlock('light'),
    '',
    ...accentBlock(),
    '',
    '  /* Tenant brand (§4.5). Replaced at load when the tenant supplies one. */',
    ...themed(BRAND_FALLBACK, 'light'),
    '',
    '  /* Weights (§5.3). `weight-body-*` is used at body size and above (§5.4). */',
    ...weightBlock(false),
    '',
    '  /* Focus (§7.3) */',
    line('focus-ring', FOCUS_RING),
    line('focus-ring-danger', FOCUS_RING_DANGER),
    line('radius-pill', RADIUS_PILL),
    '',
    '  /* Motion (§8) */',
    ...Object.entries(MOTION).map(([name, value]) => line(name, value)),
    '',
    '  /* Density: the default. A subtree may raise it, never lower it below touch. */',
    ...densityBlock(DEFAULT_DENSITY),
  ].join('\n');

  const dark = [
    ...semanticBlock('dark'),
    '',
    '  /* §5.4: one named weight down at body size and above, on a dark ground */',
    ...weightBlock(true),
  ].join('\n');

  const densities = DENSITIES.map(
    (density) => `[data-density='${density}'] {\n${densityBlock(density).join('\n')}\n}`,
  ).join('\n\n');

  const stillMotion = MOTION_DURATIONS.map((name) => line(name, '0ms')).join('\n');

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

/* Density is inherited from the root and may be raised on a subtree (§6.1). */
${densities}

/*
 * A component whose meaning depends on motion is a component that fails for
 * these users, and is not built. Both the system preference and the tenant
 * setting disable every transition (§8).
 */
@media (prefers-reduced-motion: reduce) {
  :root {
${stillMotion}
  }
}

[data-reduce-motion='true'] {
${stillMotion}
}
`;
}
