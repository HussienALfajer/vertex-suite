import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import {
  FACES,
  INK,
  LIP,
  MARK_BOX,
  NOTCH,
  REGISTERED,
  SILHOUETTE,
  WORDMARK_CAP_HEIGHT,
  WORDMARK_GLYPHS,
  WORDMARK_WIDTH,
} from './geometry.js';

/**
 * The product's mark and its lockups. **Not the tenant's brand** (§4.5).
 *
 * The two are different things and they meet on exactly three surfaces. The
 * sign-in screen, the printed document header and the register idle screen
 * carry the *customer's* brand, because a shop signs in to its own shop; this
 * is the vendor's, and it stands in those places only until a tenant has
 * supplied theirs.
 *
 * **Drawn, never placed.** Every raster of this mark carries gradients and a
 * sheen — a mark for a presentation rather than for an interface. It turns to
 * mud below about 24px, it cannot be printed in one ink, and it cannot take the
 * colour of what it sits on. The geometry underneath is simple enough to state
 * exactly, so `geometry.ts` states it and every variant here is derived from
 * that one statement rather than from its own copy.
 *
 * ### The tones
 *
 * | Tone   | The cube                  | The words        | Where                                         |
 * | ------ | ------------------------- | ---------------- | --------------------------------------------- |
 * | `full` | Its own fixed colours     | `currentColor`   | Any ground except pure white                  |
 * | `mono` | `currentColor`, V knocked | `currentColor`   | 16px, one ink, on `fill-brand`, on pure white |
 *
 * The words take `currentColor` in **both** tones, which is what makes one
 * lockup serve the light theme and the dark one: §2 has them as equals, and a
 * wordmark baked black is a wordmark that has chosen the light theme.
 */

export type LogoLayout = 'mark' | 'horizontal' | 'stacked';
export type LogoTone = 'full' | 'mono';

export interface VertexLogoProps {
  readonly layout?: LogoLayout;
  readonly tone?: LogoTone;
  /**
   * The line under the wordmark. Dropped by default: it is set type rather than
   * drawn letterforms, it is the first thing to become unreadable as the lockup
   * shrinks, and §10's minimum sizes are where it stops being legible at all.
   */
  readonly tagline?: string;
  readonly registered?: boolean;
  /**
   * The accessible name. Omitted, the logo is decorative and hidden — correct
   * beside a heading that already names the product, and wrong when the logo is
   * the only thing identifying the screen.
   */
  readonly title?: string;
  /**
   * The size comes from here. Written as "one or the other" rather than as a
   * default the caller appends to, because two `size-*` utilities on one
   * element are settled by the order they land in the stylesheet.
   */
  readonly className?: string;
}

/** Below this, in rendered pixels of mark height, the carve's lit edge is a smear. */
const LIP_THRESHOLD = 24;

export function VertexLogo({
  layout = 'mark',
  tone = 'full',
  tagline,
  registered = false,
  title,
  className,
}: VertexLogoProps): ReactNode {
  const named = title !== undefined;
  const box = layouts[layout]({ tone, tagline, registered });

  return (
    <svg
      viewBox={box.viewBox}
      className={clsx('block', className ?? 'h-[var(--vx-icon)] w-auto')}
      {...(named ? { role: 'img' } : { 'aria-hidden': true })}
    >
      {named ? <title>{title}</title> : null}
      {box.content}
    </svg>
  );
}

interface Parts {
  readonly tone: LogoTone;
  readonly tagline?: string | undefined;
  readonly registered: boolean;
}

/**
 * The cube.
 *
 * `mono` is one path with two subpaths and `evenodd`: the V is a hole, not a
 * second shape painted in a background colour that only ever matches the one
 * background it was told about.
 */
function Mark({ tone, showLip = true }: { tone: LogoTone; showLip?: boolean }): ReactNode {
  if (tone === 'mono') {
    return <path d={`${SILHOUETTE} ${NOTCH}`} fill="currentColor" fillRule="evenodd" />;
  }
  return (
    <>
      <path d={FACES.topLeft} fill={INK.topLeft} />
      <path d={FACES.topRight} fill={INK.topRight} />
      <path d={FACES.left} fill={INK.left} />
      <path d={FACES.right} fill={INK.right} />
      <path d={FACES.notchShadow} fill={INK.notchShadow} />
      <path d={FACES.notchAccent} fill={INK.notchAccent} />
      {showLip ? (
        <>
          <path d={LIP.left} fill={INK.lip} />
          <path d={LIP.right} fill={INK.lip} />
        </>
      ) : null}
    </>
  );
}

function Wordmark(): ReactNode {
  return (
    <>
      {WORDMARK_GLYPHS.map((glyph) => (
        <path
          key={glyph.key}
          d={glyph.path}
          fill="currentColor"
          fillRule="evenodd"
          transform={`translate(${String(glyph.x)},0)`}
        />
      ))}
    </>
  );
}

function Registered({ x, y, size }: { x: number; y: number; size: number }): ReactNode {
  const scale = size / REGISTERED.box;
  return (
    <g transform={`translate(${String(x)},${String(y)}) scale(${String(scale)})`}>
      <circle
        cx={REGISTERED.ring.cx}
        cy={REGISTERED.ring.cy}
        r={REGISTERED.ring.r}
        fill="none"
        stroke="currentColor"
        strokeWidth={REGISTERED.ring.strokeWidth}
      />
      <path
        d={REGISTERED.letter.path}
        fill="currentColor"
        fillRule="evenodd"
        transform={REGISTERED.letter.transform}
      />
    </g>
  );
}

/**
 * The tagline is **set type, not drawn letterforms**, and that is a stated
 * limit rather than an oversight: twenty-three characters of a custom face is a
 * tracing job for whoever owns the typeface, and a wrong tracing is worse than
 * honest type. It renders in the Latin family the product bundles (§5.1), so a
 * surface that has the interface loaded shows it exactly; a bare SVG file falls
 * back. Outline it before the logo goes to a printer.
 */
function Tagline({
  text,
  y,
  width,
  size,
}: {
  text: string;
  y: number;
  width: number;
  size: number;
}): ReactNode {
  return (
    <text
      x={0}
      y={y}
      // `textLength` and not letter-spacing, which is the whole trick: the line
      // is set to **exactly** the width of the wordmark above it and the tracking
      // falls out of that. Spaced by hand it is a different width in every font
      // that substitutes, and the lockup's own box then depends on which machine
      // drew it — which is how a tagline ends up clipped by its own viewBox.
      textLength={width}
      lengthAdjust="spacing"
      // Latin, and anchored as Latin whatever the page is. `direction` is
      // inherited from `<html dir="rtl">`, and under it `text-anchor: start`
      // means the right edge: the line ran from x = −width to 0, outside the
      // viewBox, and the sign-in screen's tagline was clipped away entirely.
      direction="ltr"
      fill="currentColor"
      fontSize={size}
      fontFamily="var(--vx-font-latin), 'IBM Plex Sans', system-ui, sans-serif"
    >
      {text}
    </text>
  );
}

const WORD_SCALE_IN_LOCKUP = 0.52;
const GAP_MARK_TO_WORD = 44;
const TAGLINE_RATIO = 0.26;
const TAGLINE_GAP = 16;

interface Box {
  readonly viewBox: string;
  readonly content: ReactNode;
}

const layouts: Readonly<Record<LogoLayout, (parts: Parts) => Box>> = {
  mark: ({ tone }) => ({
    viewBox: `0 0 ${String(MARK_BOX)} ${String(MARK_BOX)}`,
    content: <Mark tone={tone} />,
  }),

  horizontal: ({ tone, tagline, registered }) => {
    const wordWidth = WORDMARK_WIDTH * WORD_SCALE_IN_LOCKUP;
    const capHeight = WORDMARK_CAP_HEIGHT * WORD_SCALE_IN_LOCKUP;
    const signSize = capHeight * 0.3;
    const signGap = 10;
    const blockHeight =
      capHeight + (tagline === undefined ? 0 : TAGLINE_GAP + capHeight * TAGLINE_RATIO);
    // The wordmark block is centred against the cube's inked height, not against
    // its box: optical centring is what the eye reads, and the box carries air.
    const top = 6 + (108 - blockHeight) / 2;
    const width = MARK_BOX + GAP_MARK_TO_WORD + wordWidth + (registered ? signGap + signSize : 0);

    return {
      viewBox: `0 0 ${String(Math.round(width))} ${String(MARK_BOX)}`,
      content: (
        <>
          <Mark tone={tone} />
          <g transform={`translate(${String(MARK_BOX + GAP_MARK_TO_WORD)},${String(top)})`}>
            <g transform={`scale(${String(WORD_SCALE_IN_LOCKUP)})`}>
              <Wordmark />
            </g>
            {registered ? <Registered x={wordWidth + signGap} y={0} size={signSize} /> : null}
            {tagline === undefined ? null : (
              <Tagline
                text={tagline}
                y={capHeight + TAGLINE_GAP + capHeight * TAGLINE_RATIO * 0.78}
                width={wordWidth}
                size={capHeight * TAGLINE_RATIO}
              />
            )}
          </g>
        </>
      ),
    };
  },

  stacked: ({ tone, tagline, registered }) => {
    const scale = 0.46;
    const wordWidth = WORDMARK_WIDTH * scale;
    const capHeight = WORDMARK_CAP_HEIGHT * scale;
    const signSize = capHeight * 0.3;
    const signGap = 9;
    const gapUnderMark = 28;
    const width = Math.max(wordWidth + (registered ? signGap + signSize : 0), MARK_BOX);
    const markX = (width - MARK_BOX) / 2;
    const wordX = (width - wordWidth - (registered ? signGap + signSize : 0)) / 2;
    const wordY = MARK_BOX + gapUnderMark;
    const height =
      wordY + capHeight + (tagline === undefined ? 0 : TAGLINE_GAP + capHeight * TAGLINE_RATIO) + 6;

    return {
      viewBox: `0 0 ${String(Math.round(width))} ${String(Math.round(height))}`,
      content: (
        <>
          <g transform={`translate(${String(markX)},0)`}>
            <Mark tone={tone} />
          </g>
          <g transform={`translate(${String(wordX)},${String(wordY)})`}>
            <g transform={`scale(${String(scale)})`}>
              <Wordmark />
            </g>
            {registered ? <Registered x={wordWidth + signGap} y={0} size={signSize} /> : null}
            {tagline === undefined ? null : (
              <Tagline
                text={tagline}
                y={capHeight + TAGLINE_GAP + capHeight * TAGLINE_RATIO * 0.78}
                width={wordWidth}
                size={capHeight * TAGLINE_RATIO}
              />
            )}
          </g>
        </>
      ),
    };
  },
};

/**
 * The mark inside the rounded square a platform draws it in.
 *
 * A separate component because an app icon is not the logo at a small size: the
 * platform crops it, rounds it, and puts it on whatever wallpaper the person
 * chose, so it needs its own ground and its own margin. The lit edge of the
 * carve is dropped below `LIP_THRESHOLD`, where a four-unit line stops being a
 * line.
 */
export interface AppIconProps {
  /** The rendered size in pixels, which is what decides how much detail survives. */
  readonly size: number;
  readonly className?: string;
  readonly title?: string;
}

export function VertexAppIcon({ size, className, title }: AppIconProps): ReactNode {
  const named = title !== undefined;
  const inset = MARK_BOX * 0.18;
  const scale = (MARK_BOX - inset * 2) / MARK_BOX;

  return (
    <svg
      viewBox={`0 0 ${String(MARK_BOX)} ${String(MARK_BOX)}`}
      width={size}
      height={size}
      className={clsx('block', className)}
      {...(named ? { role: 'img' } : { 'aria-hidden': true })}
    >
      {named ? <title>{title}</title> : null}
      <rect width={MARK_BOX} height={MARK_BOX} rx={MARK_BOX * 0.22} fill={INK.lip} />
      <g transform={`translate(${String(inset)},${String(inset)}) scale(${String(scale)})`}>
        <Mark tone="full" showLip={size >= LIP_THRESHOLD} />
      </g>
    </svg>
  );
}
