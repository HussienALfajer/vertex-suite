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

/**
 * The cube, from its one governing number.
 *
 * An isometric projection of a cube of edge `EDGE` is completely determined: the
 * top face is a rhombus `EDGE·√3` across and `EDGE` down, and the three vertical
 * edges are `EDGE` long. Get the last of those wrong and the rhombus still looks
 * isometric while the whole reads as a box somebody sat on — which is what the
 * first draft of this mark was, by a fifth.
 *
 * So the edge is stated and every point is derived from it. The silhouette is
 * then a regular hexagon, `EDGE·√3` wide and `2·EDGE` tall — **taller than it is
 * wide**, which is also what gives the carve enough run to read as a V rather
 * than as a notch.
 */
export const MARK_BOX = 128;

/** The cube's edge, in the units of the box. Everything else follows. */
const EDGE = 60;

const CX = MARK_BOX / 2;
const CY = MARK_BOX / 2;
const HALF_W = (EDGE * Math.sqrt(3)) / 2;
const HALF_RHOMBUS = EDGE / 2;

const n = (value: number): string => Number(value.toFixed(2)).toString();
const point = (x: number, y: number): string => `${n(x)},${n(y)}`;

const TOP = point(CX, CY - EDGE);
const UPPER_RIGHT = point(CX + HALF_W, CY - HALF_RHOMBUS);
const LOWER_RIGHT = point(CX + HALF_W, CY + HALF_RHOMBUS);
const BOTTOM = point(CX, CY + EDGE);
const LOWER_LEFT = point(CX - HALF_W, CY + HALF_RHOMBUS);
const UPPER_LEFT = point(CX - HALF_W, CY - HALF_RHOMBUS);
/** Where the three visible faces meet: the top of the cube's front edge. */
const CENTRE = point(CX, CY);

/**
 * How far the carve stops short of the bottom vertex.
 *
 * Run all the way down, the two outer slivers taper to nothing at the corner:
 * they vanish first in print and then on screen, and what is left reads as a
 * bare V with no cube behind it. Stopping short leaves a solid foot across the
 * bottom vertex, which is the part of the mark that has to survive being small.
 */
const FOOT = 14;
const APEX = point(CX, CY + EDGE - FOOT);

/** The measurements, exported so a test can hold the drawing to them. */
export const CUBE = {
  edge: EDGE,
  width: HALF_W * 2,
  height: EDGE * 2,
  /** The top face, across and down. Their ratio is what makes it isometric. */
  rhombus: { across: HALF_W * 2, down: EDGE },
  foot: FOOT,
} as const;

/** The hexagon the cube occupies, for the monochrome mark and for masks. */
export const SILHOUETTE = `M${TOP} L${UPPER_RIGHT} L${LOWER_RIGHT} L${BOTTOM} L${LOWER_LEFT} L${UPPER_LEFT} Z`;

/**
 * The V, as one dart: down the left face, up the right, apex at the bottom
 * vertex. Subtracted from the silhouette with `evenodd`, it becomes the hole
 * that makes the monochrome mark readable on any ground.
 */
export const NOTCH = `M${UPPER_LEFT} L${CENTRE} L${UPPER_RIGHT} L${APEX} Z`;

/**
 * The planes of the full-colour mark, in paint order.
 *
 * The two side faces are drawn **whole** and the carve is laid over them, which
 * is what leaves face colour in the foot below the apex. Drawn as the leftover
 * slivers instead, the foot would have to be a seventh shape kept in step with
 * the other six by hand.
 */
export const FACES = {
  topLeft: `M${TOP} L${CENTRE} L${UPPER_LEFT} Z`,
  topRight: `M${TOP} L${UPPER_RIGHT} L${CENTRE} Z`,
  left: `M${UPPER_LEFT} L${CENTRE} L${BOTTOM} L${LOWER_LEFT} Z`,
  right: `M${CENTRE} L${UPPER_RIGHT} L${LOWER_RIGHT} L${BOTTOM} Z`,
  notchShadow: `M${UPPER_LEFT} L${CENTRE} L${APEX} Z`,
  notchAccent: `M${CENTRE} L${UPPER_RIGHT} L${APEX} Z`,
} as const;

/**
 * The lit edge where the top face meets the carve.
 *
 * Four units thick, which is what makes the V read as cut *into* the cube
 * rather than painted onto it — the one piece of the raster's modelling worth
 * keeping, because it is the piece that carries the idea. It is dropped below
 * the small-size threshold, where a four-unit line is a smear.
 */
const LIP_DEPTH = 4;
const lipBelow = (from: string, to: string): string =>
  `M${from} L${to} L${to.replace(/,([\d.]+)$/, (_, y: string) => `,${n(Number(y) + LIP_DEPTH)}`)} ` +
  `L${from.replace(/,([\d.]+)$/, (_, y: string) => `,${n(Number(y) + LIP_DEPTH)}`)} Z`;

export const LIP = {
  left: lipBelow(UPPER_LEFT, CENTRE),
  right: lipBelow(CENTRE, UPPER_RIGHT),
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
  /**
   * The two halves of the top face are held **two steps apart** on the ramp
   * rather than one. Nearly equal, the crease down the middle of the top face
   * disappears and the cube loses the edge that says which way it is turned.
   */
  topLeft: '#c8c5bb',
  topRight: '#f4f2ec',
  /**
   * The left face is lighter than a lit cube would strictly make it, and that
   * is the correction: the shadow arm of the carve sits on this face, and on a
   * darker one the two ran together into a single dark mass at any size below a
   * headline. Physical accuracy loses to being able to see the shape.
   */
  left: '#a6a39b',
  right: '#d5d2cb',
  notchShadow: '#1c1b19',
  /**
   * A deeper blue than the interface accent. The accent is solved for 4.5:1
   * against the page (§4.1); the facet has to hold against **white and the dark
   * ground and the accent itself**, and the lighter blue washed out on the first
   * of those.
   */
  notchAccent: '#0a67d6',
  lip: '#faf8f4',
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
