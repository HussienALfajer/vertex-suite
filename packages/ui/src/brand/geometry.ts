/**
 * The brand's geometry, stated once.
 *
 * Every variant in this folder — the mark alone, the two lockups, the app icon,
 * the favicon — is drawn from the constants below rather than from its own copy
 * of them. A logo system whose pieces are separate files is a logo system in
 * which the icon and the lockup drift a degree apart and nobody notices until
 * they are side by side on a printed invoice.
 *
 * **The mark is a true isometric cube.** The top face is a rhombus whose
 * half-width and half-height are in the ratio √3 : 1, which is what makes the
 * three faces read as equal squares seen from a corner rather than as a
 * flattened box. Each of the two visible side faces is then divided from its
 * upper outer corner to the bottom vertex, and the two halves nearest the front
 * edge are what read as the V.
 */

/** The mark is drawn on a 120-square and inked inside 104 × 108 of it. */
export const MARK_BOX = 120;

const TOP = '60,6';
const UPPER_RIGHT = '112,36';
const LOWER_RIGHT = '112,84';
const BOTTOM = '60,114';
const LOWER_LEFT = '8,84';
const UPPER_LEFT = '8,36';
/** Where the three visible faces meet: the top of the cube's front edge. */
const CENTRE = '60,66';

/** The hexagon the cube occupies, for the monochrome mark and for masks. */
export const SILHOUETTE = `M${TOP} L${UPPER_RIGHT} L${LOWER_RIGHT} L${BOTTOM} L${LOWER_LEFT} L${UPPER_LEFT} Z`;

/**
 * The V, as one dart: down the left face, up the right, apex at the bottom
 * vertex. Subtracted from the silhouette with `evenodd`, it becomes the hole
 * that makes the monochrome mark readable on any ground.
 */
export const NOTCH = `M${UPPER_LEFT} L${CENTRE} L${UPPER_RIGHT} L${BOTTOM} Z`;

/** The six planes of the full-colour mark, in paint order. */
export const FACES = {
  topLeft: `M${TOP} L${CENTRE} L${UPPER_LEFT} Z`,
  topRight: `M${TOP} L${UPPER_RIGHT} L${CENTRE} Z`,
  left: `M${UPPER_LEFT} L${BOTTOM} L${LOWER_LEFT} Z`,
  right: `M${UPPER_RIGHT} L${LOWER_RIGHT} L${BOTTOM} Z`,
  notchShadow: `M${UPPER_LEFT} L${CENTRE} L${BOTTOM} Z`,
  notchAccent: `M${CENTRE} L${UPPER_RIGHT} L${BOTTOM} Z`,
} as const;

/**
 * The lit edge where the top face meets the carve.
 *
 * Four units thick, which is what makes the V read as cut *into* the cube
 * rather than painted onto it — the one piece of the raster's modelling worth
 * keeping, because it is the piece that carries the idea. It is dropped below
 * the small-size threshold, where a four-unit line is a smear.
 */
export const LIP = {
  left: 'M8,36 L60,66 L60,70 L8,40 Z',
  right: 'M60,66 L112,36 L112,40 L60,70 Z',
} as const;

/**
 * The mark's own colours, and the one place in this system where a fixed value
 * is correct: §3.1 keeps components off the primitives so a theme change
 * reaches them, and a mark that changed with the theme would not be a mark.
 *
 * The neutrals are chosen from the warm family §4.2 generates, so the cube sits
 * in the product's own light rather than beside it. The facet is the hue §4.3
 * gives to interaction — stated here rather than resolved from a token, for the
 * reason above.
 */
export const INK = {
  topLeft: '#d7d4cc',
  topRight: '#eeece6',
  left: '#8f8d85',
  right: '#cbc8c0',
  notchShadow: '#1c1b19',
  notchAccent: '#0e6fdb',
  lip: '#f6f4f0',
} as const;

/**
 * The wordmark, drawn rather than set.
 *
 * Six glyphs on a 100 cap height, geometric and wide, with the three-bar `E`
 * the brand uses in place of a stemmed one. Drawn because a wordmark that
 * depends on a font file is a wordmark that renders differently wherever the
 * font is missing — which includes every PDF, every email client and every
 * machine that has not loaded the interface.
 */
const GLYPHS = {
  V: { width: 78, path: 'M0,0 H24 L39,63 L54,0 H78 L48,100 H30 Z' },
  E: { width: 70, path: 'M0,0 H70 V20 H0 Z M0,40 H70 V60 H0 Z M0,80 H70 V100 H0 Z' },
  R: {
    width: 76,
    path:
      'M0,0 H48 A26,26 0 0 1 48,52 H42 L76,100 H49 L22,57 V100 H0 Z ' +
      'M22,20 H46 A6,6 0 0 1 46,32 H22 Z',
  },
  T: { width: 74, path: 'M0,0 H74 V20 H47 V100 H27 V20 H0 Z' },
  X: { width: 78, path: 'M0,0 H26 L39,30 L52,0 H78 L52,50 L78,100 H52 L39,70 L26,100 H0 L26,50 Z' },
} as const;

/** The space between glyphs. Wide, because the mark is wide and they are read together. */
const TRACKING = 16;

const LETTERS = ['V', 'E', 'R', 'T', 'E', 'X'] as const;

export interface PlacedGlyph {
  readonly key: string;
  readonly path: string;
  readonly x: number;
}

function place(): { glyphs: PlacedGlyph[]; width: number } {
  const glyphs: PlacedGlyph[] = [];
  let x = 0;
  LETTERS.forEach((letter, index) => {
    const glyph = GLYPHS[letter];
    glyphs.push({ key: `${letter}${String(index)}`, path: glyph.path, x });
    x += glyph.width + TRACKING;
  });
  return { glyphs, width: x - TRACKING };
}

const PLACED = place();

export const WORDMARK_GLYPHS: readonly PlacedGlyph[] = PLACED.glyphs;
export const WORDMARK_WIDTH = PLACED.width;
export const WORDMARK_CAP_HEIGHT = 100;

/**
 * The registered sign, built from the wordmark's own `R` so that it is the same
 * letter at a smaller size rather than a second design of one.
 */
export const REGISTERED = {
  box: 100,
  ring: { cx: 50, cy: 50, r: 43, strokeWidth: 10 },
  letter: { path: GLYPHS.R.path, transform: 'translate(29,22) scale(0.56)' },
} as const;
