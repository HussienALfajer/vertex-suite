import { contrastRatio } from './contrast.js';
import { generateNeutralRamp } from './generate.js';
import { NEUTRAL_ROLES } from './spec.js';

/**
 * Per-tenant branding (§4.5).
 *
 * There is no brand colour in the palette. Branding is per tenant —
 * configuration, never a fork — so the brand enters as a semantic token the
 * tenant supplies, and the readable foreground for it is **computed**, never
 * guessed.
 *
 * The brand colour never drives interaction. It appears on the sign-in screen,
 * the printed document header and the register idle screen, and nowhere else. A
 * tenant whose brand is red does not get red "save" buttons.
 */

const TARGET = 4.5;

/** White, and the darkest neutral — the only two foregrounds a brand may carry. */
const LIGHT_FOREGROUND = '#ffffff';
const DARK_FOREGROUND = generateNeutralRamp().get(NEUTRAL_ROLES.textPrimary.light) ?? '#0c0b09';

export interface BrandAccepted {
  readonly accepted: true;
  /** The colour as supplied, normalised to lowercase six-digit hex. */
  readonly fill: string;
  /** Whichever of white or the darkest neutral reaches the target against it. */
  readonly on: string;
  readonly ratio: number;
}

export interface BrandRefused {
  readonly accepted: false;
  /** Shown to the tenant administrator. A refusal always explains itself. */
  readonly reason: string;
  /** The better of the two ratios, so the message can say how far off it is. */
  readonly bestRatio: number;
}

export type BrandResolution = BrandAccepted | BrandRefused;

function normalise(hex: string): string | null {
  const body = hex.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(body)) {
    return `#${body.replace(/./g, (digit) => digit + digit)}`;
  }
  return /^[0-9a-f]{6}$/.test(body) ? `#${body}` : null;
}

/**
 * Resolves a supplied brand colour into `fill-brand` and `on-brand`, or refuses
 * it.
 *
 * A colour that cannot reach 4.5:1 with **either** foreground is refused at
 * upload with an explanation, not silently accepted — because the alternative
 * is a sign-in screen nobody can read, discovered by a customer.
 */
export function resolveBrand(supplied: string): BrandResolution {
  const fill = normalise(supplied);
  if (fill === null) {
    return {
      accepted: false,
      reason: `"${supplied}" is not a hex colour. Supply it as #rgb or #rrggbb.`,
      bestRatio: 0,
    };
  }

  const onLight = contrastRatio(LIGHT_FOREGROUND, fill);
  const onDark = contrastRatio(DARK_FOREGROUND, fill);
  const best = Math.max(onLight, onDark);

  if (best < TARGET) {
    return {
      accepted: false,
      reason:
        `${fill} cannot carry readable text: it reaches ${best.toFixed(2)}:1 at best, ` +
        `and ${String(TARGET)}:1 is required. Choose a lighter or a darker colour.`,
      bestRatio: best,
    };
  }

  return onLight >= onDark
    ? { accepted: true, fill, on: LIGHT_FOREGROUND, ratio: onLight }
    : { accepted: true, fill, on: DARK_FOREGROUND, ratio: onDark };
}

/** The custom properties to set on the document root for an accepted brand. */
export function brandCustomProperties(brand: BrandAccepted): Readonly<Record<string, string>> {
  return { '--vx-fill-brand': brand.fill, '--vx-on-brand': brand.on };
}
