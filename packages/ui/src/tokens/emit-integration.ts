import {
  ACCENT_TOKENS,
  BORDERS,
  COMPONENT_TOKENS,
  NEUTRAL_FILLS,
  SURFACES,
  TEXT,
} from './semantic.js';
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
 * The Tailwind alias for a semantic colour token.
 *
 * Tailwind builds a colour utility by prefixing the colour's name — `text-`,
 * `bg-`, `border-`. A token already called `text-primary` would therefore have
 * to be written `text-text-primary`, and a token called `border` would be
 * `border-line`. Worse, `text-primary` as written matches nothing at all,
 * which fails **silently**: the class is simply absent from the stylesheet and
 * the element inherits whatever its parent had. That is exactly how a negative
 * amount shipped in the ordinary text colour instead of the danger colour.
 *
 * So the `--vx-` names stay as §4.4 publishes them, and Tailwind gets an alias
 * that reads naturally under its own prefixes:
 *
 * | token            | utility              |
 * |------------------|----------------------|
 * | `text-primary`   | `text-fg`            |
 * | `text-danger`    | `text-fg-danger`     |
 * | `border`         | `border-line`        |
 * | `border-strong`  | `border-line-strong` |
 * | `bg-success`     | `bg-tint-success`    |
 * | `on-bg-success`  | `text-on-tint-success` |
 */
export function tailwindColourAlias(token: string): string {
  if (token === 'border') return 'line';
  if (token.startsWith('border-')) return `line-${token.slice('border-'.length)}`;
  if (token === 'text-primary') return 'fg';
  if (token.startsWith('text-')) return `fg-${token.slice('text-'.length)}`;
  if (token.startsWith('on-bg-')) return `on-tint-${token.slice('on-bg-'.length)}`;
  if (token.startsWith('bg-')) return `tint-${token.slice('bg-'.length)}`;
  return token;
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
  const push = (alias: string, token: string): void => {
    colours.push(`  --color-${alias}: var(--vx-${token});`);
  };

  for (const name of Object.keys(SURFACES)) push(name, name);
  for (const name of Object.keys(TEXT)) push(tailwindColourAlias(name), name);
  for (const name of Object.keys(BORDERS)) push(tailwindColourAlias(name), name);
  for (const name of Object.keys(NEUTRAL_FILLS)) push(name, name);
  for (const name of Object.keys(COMPONENT_TOKENS)) push(name, name);
  for (const { tokens } of ACCENT_TOKENS) {
    for (const name of Object.keys(tokens)) push(tailwindColourAlias(name), name);
  }
  push('fill-brand', 'fill-brand');
  push('on-brand', 'on-brand');
  CHART_SERIES.forEach((_, index) => {
    push(`chart-${String(index + 1)}`, `chart-${String(index + 1)}`);
  });

  // A size and the line height that goes with it travel together, which is
  // what Tailwind's `--text-*--line-height` companion is for: `text-title` then
  // sets both. Emitted only as `--leading-*`, the scale's line heights reached
  // no utility anybody wrote, and every element inherited the body's — a 26px
  // Arabic page title on a 22px line, wrapped lines overlapping (§5.2).
  const type = Object.keys(TYPE_SCALE).flatMap((role) => [
    `  --text-${role}: var(--vx-font-size-${role});`,
    `  --text-${role}--line-height: var(--vx-line-height-${role});`,
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
