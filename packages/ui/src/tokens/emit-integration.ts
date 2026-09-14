import { ACCENT_TOKENS, BORDERS, NEUTRAL_FILLS, SURFACES, TEXT } from './semantic.js';
import { BUNDLED_WEIGHTS, TYPE_SCALE, WEIGHTS } from './scale.js';
import { CHART_SERIES } from './spec.js';
import { ELEVATION } from './style.js';

/**
 * The font families, and which subsets of each are bundled.
 *
 * Fontsource already splits each family by unicode range, so choosing subsets
 * is the whole of the subsetting decision — and it is made by range rather than
 * by character frequency on purpose: a customer's item names are arbitrary
 * Arabic text, and a glyph dropped because it looked uncommon becomes a box on
 * an invoice.
 *
 * `cyrillic-ext` is not bundled. Nothing in this product is written in it, and
 * it is the only subset that can be dropped without risking a real name.
 */
const FAMILIES = [
  {
    package: '@fontsource/ibm-plex-sans-arabic',
    family: 'sans',
    subsets: ['arabic', 'latin', 'latin-ext'],
  },
  { package: '@fontsource/ibm-plex-sans', family: 'latin', subsets: ['latin', 'latin-ext'] },
  { package: '@fontsource/ibm-plex-mono', family: 'mono', subsets: ['latin', 'latin-ext'] },
] as const;

/**
 * Bundled with the application, never fetched from a network (§5.1): the
 * product must render identically with every network interface disabled.
 *
 * Static weights only — there is no variable build of IBM Plex Sans Arabic, and
 * a variable Latin beside a static Arabic would compensate two different ways
 * inside one sentence (§5.4).
 */
export function emitFonts(): string {
  const imports: string[] = [];
  for (const { package: pkg, family, subsets } of FAMILIES) {
    const weights = BUNDLED_WEIGHTS[family] ?? [];
    imports.push(`/* ${pkg} — ${subsets.join(', ')} at ${weights.join('/')} */`);
    for (const subset of subsets) {
      for (const weight of weights) {
        imports.push(`@import '${pkg}/${subset}-${String(weight)}.css';`);
      }
    }
    imports.push('');
  }

  return `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`pnpm --filter @vertex/ui tokens\` from BUNDLED_WEIGHTS in
 * scale.ts. Import this once, at the application root.
 */

${imports.join('\n').trimEnd()}
`;
}

/**
 * Tailwind's view of the semantic layer.
 *
 * Every entry is `var(--vx-…)` rather than a value, so a screen writing
 * `bg-surface-1` and a component writing `var(--vx-surface-1)` resolve to the
 * same custom property and switch with the theme together. `@theme inline` is
 * what makes that true; a non-inline theme would copy values and freeze them.
 */
export function emitTailwind(): string {
  const colours: string[] = [];
  const push = (name: string): void => {
    colours.push(`  --color-${name}: var(--vx-${name});`);
  };

  for (const name of Object.keys(SURFACES)) push(name);
  for (const name of Object.keys(TEXT)) push(name);
  for (const name of Object.keys(BORDERS)) push(name);
  for (const name of Object.keys(NEUTRAL_FILLS)) push(name);
  for (const { tokens } of ACCENT_TOKENS) {
    for (const name of Object.keys(tokens)) push(name);
  }
  push('fill-brand');
  push('on-brand');
  CHART_SERIES.forEach((_, index) => {
    push(`chart-${String(index + 1)}`);
  });

  const type = Object.keys(TYPE_SCALE).flatMap((role) => [
    `  --text-${role}: var(--vx-font-size-${role});`,
    `  --leading-${role}: var(--vx-line-height-${role});`,
  ]);

  const weights = [
    ...Object.keys(WEIGHTS).map((name) => `  --font-weight-${name}: var(--vx-weight-${name});`),
    ...Object.keys(WEIGHTS).map(
      (name) => `  --font-weight-body-${name}: var(--vx-weight-body-${name});`,
    ),
  ];

  // The names already carry Tailwind's `shadow-` namespace, so they map across
  // unchanged: `--shadow-md` in the theme becomes the `shadow-md` utility.
  const shadows = Object.keys(ELEVATION).map((name) => `  --${name}: var(--vx-${name});`);

  return `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by \`pnpm --filter @vertex/ui tokens\`.
 */

@theme inline {
  /* Families */
  --font-sans: var(--vx-font-sans);
  --font-latin: var(--vx-font-latin);
  --font-mono: var(--vx-font-mono);

  /* Colours — the semantic layer, which is the only layer a screen may name */
${colours.join('\n')}

  /* Type. Both move with the density axis. */
${type.join('\n')}

  /* Weights. \`body-*\` is compensated on a dark ground (§5.4). */
${weights.join('\n')}

  /* Radius and elevation */
  --radius: var(--vx-radius);
  --radius-card: var(--vx-radius-card);
  --radius-pill: var(--vx-radius-pill);
${shadows.join('\n')}

  /* Easing */
  --ease-out: var(--vx-ease-out);
  --ease-in: var(--vx-ease-in);
}

/*
 * Spacing is deliberately absent.
 *
 * §6.2 gives two scales with different values — \`pad-*\` and \`gap-*\` — and
 * Tailwind has one \`--spacing-*\` namespace serving both padding and gap
 * utilities. Mapping either one into it silently makes the other wrong.
 * Components use \`var(--vx-pad-md)\` and \`var(--vx-gap-md)\` directly until the
 * first screens show which shape actually earns a utility.
 */
`;
}
