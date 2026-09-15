import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/**
 * The product's own mark. **Not the tenant's brand** (§4.5).
 *
 * The two are different things and the distinction matters on exactly one
 * screen. `fill-brand` is the colour a *customer* supplies, and it carries the
 * sign-in screen, the printed document header and the register idle screen —
 * a shop signs in to its own shop. This mark is the vendor's, and it stands in
 * the same places only until a tenant has supplied theirs.
 *
 * **Drawn, not photographed.** Every raster of this mark carries soft gradients
 * and a sheen, which is a mark for a presentation rather than for an interface:
 * it turns to mud below about 24px, it cannot be printed in one colour, and it
 * cannot take the colour of whatever it is sitting on. The geometry underneath
 * is simple enough to state exactly — an isometric cube whose left and right
 * faces are each divided from an upper corner to the bottom vertex, so that the
 * far halves together read as a V — so it is stated, and scales to any size.
 *
 * **The colours are fixed, and that is the one place in this system where a
 * fixed value is right.** §3.1 keeps components off the primitives so a theme
 * change reaches everything; a logo that changed with the theme would not be a
 * logo. The neutrals are chosen from the same warm family the palette generates
 * (§4.2) so the mark sits in the product's own light rather than beside it, and
 * the blue is the accent hue of §4.3 — but they are written here because they
 * belong to the mark, not to the theme.
 */

/** The cube, as six points on a 64-square grid. */
const TOP = '32,4';
const UPPER_RIGHT = '58,19';
const LOWER_RIGHT = '58,45';
const BOTTOM = '32,60';
const LOWER_LEFT = '6,45';
const UPPER_LEFT = '6,19';
/** Where the three visible faces meet: the top of the cube's front edge. */
const CENTRE = '32,34';

const SILHOUETTE = `M${TOP} L${UPPER_RIGHT} L${LOWER_RIGHT} L${BOTTOM} L${LOWER_LEFT} L${UPPER_LEFT} Z`;
/** The V, as one dart: down the left face, up the right, apex at the bottom. */
const NOTCH = `M${UPPER_LEFT} L${CENTRE} L${UPPER_RIGHT} L${BOTTOM} Z`;

const FACE_TOP = '#f3f2ef';
const FACE_RIGHT = '#d2d0ca';
const FACE_LEFT = '#97958d';
const NOTCH_SHADOW = '#1a1917';
const NOTCH_ACCENT = '#1678c9';

export type ProductMarkTone = 'full' | 'mono';

export interface ProductMarkProps {
  /**
   * `full` is the three-tone cube with the blue facet. `mono` is one flat
   * silhouette in `currentColor` with the V as the ground showing through —
   * which is what makes it work at 16px, in one ink, and on top of a tenant's
   * brand colour, none of which the full mark can do.
   */
  readonly tone?: ProductMarkTone;
  /**
   * The accessible name. Omitted, the mark is decorative and hidden — which is
   * correct beside a wordmark or a page title that already says it, and wrong
   * when the mark is the only thing identifying the screen.
   */
  readonly title?: string;
  /**
   * The size comes from here, and the icon size is only the fallback.
   *
   * Written as "one or the other" rather than as a default the caller appends
   * to, because two `size-*` utilities on one element are decided by the order
   * they happen to sit in the stylesheet — which is a mark that is the right
   * size until an unrelated build reshuffles the sheet.
   */
  readonly className?: string;
}

export function ProductMark({ tone = 'full', title, className }: ProductMarkProps): ReactNode {
  const named = title !== undefined;
  return (
    <svg
      viewBox="0 0 64 64"
      className={clsx('block', className ?? 'size-[var(--vx-icon)]')}
      {...(named ? { role: 'img' } : { 'aria-hidden': true })}
    >
      {named ? <title>{title}</title> : null}
      {tone === 'mono' ? (
        // One path, two subpaths: the cube, and the V knocked out of it. A
        // second shape painted in the background colour would be a mark that
        // only works on the one background it was told about.
        <path d={`${SILHOUETTE} ${NOTCH}`} fill="currentColor" fillRule="evenodd" />
      ) : (
        <>
          <path d={`M${TOP} L${UPPER_RIGHT} L${CENTRE} L${UPPER_LEFT} Z`} fill={FACE_TOP} />
          <path d={`M${UPPER_LEFT} L${BOTTOM} L${LOWER_LEFT} Z`} fill={FACE_LEFT} />
          <path d={`M${UPPER_RIGHT} L${LOWER_RIGHT} L${BOTTOM} Z`} fill={FACE_RIGHT} />
          <path d={`M${UPPER_LEFT} L${CENTRE} L${BOTTOM} Z`} fill={NOTCH_SHADOW} />
          <path d={`M${CENTRE} L${UPPER_RIGHT} L${BOTTOM} Z`} fill={NOTCH_ACCENT} />
        </>
      )}
    </svg>
  );
}
