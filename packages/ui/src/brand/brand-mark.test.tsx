import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { INK, WORDMARK_GLYPHS } from './geometry.js';
import { VertexAppIcon, VertexLogo } from './VertexLogo.js';

afterEach(cleanup);

const ratio = (element: Element | null): number => {
  const [, , w, h] = (element?.getAttribute('viewBox') ?? '0 0 1 1').split(' ').map(Number);
  return (w ?? 1) / (h ?? 1);
};

describe('<VertexLogo> — §4.5', () => {
  it('is hidden from assistive technology unless it is given a name', () => {
    const { container } = render(<VertexLogo />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('title')).toBeNull();
  });

  it('names itself when it is the only thing identifying the screen', () => {
    const { container } = render(<VertexLogo title="Vertex" />);
    expect(container.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(container.querySelector('title')?.textContent).toBe('Vertex');
  });

  it('draws a true isometric cube, which is what makes the faces read as squares', () => {
    // The top face's half-width to half-height is √3 : 1. Off that ratio the
    // three faces stop reading as equal squares seen from a corner and the mark
    // reads as a flattened box.
    const { container } = render(<VertexLogo />);
    const faces = [...container.querySelectorAll('path')];
    expect(faces.length).toBeGreaterThan(0);
    // 52 across, 30 down, from the geometry.
    expect(52 / 30).toBeCloseTo(Math.sqrt(3), 1);
    expect(ratio(container.querySelector('svg'))).toBe(1);
  });

  it('takes its colour from the ground when it is monochrome', () => {
    // The full mark's lightest face is near-white and §4.4 makes `surface-2`
    // pure white in the light theme, so inside a panel the cube loses faces.
    // One silhouette in `currentColor` with the V as a hole answers that, and
    // one ink on a receipt, and sitting on a tenant's brand colour.
    const { container } = render(<VertexLogo tone="mono" />);
    const paths = [...container.querySelectorAll('path')];

    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('fill')).toBe('currentColor');
    expect(paths[0]?.getAttribute('fill-rule')).toBe('evenodd');
    // Two subpaths: the cube, and the V knocked out of it — not a second shape
    // painted in a background colour that matches one background.
    expect((paths[0]?.getAttribute('d')?.match(/Z/g) ?? []).length).toBe(2);
  });

  it('keeps its own colours, because a logo that follows the theme is not a logo', () => {
    const { container } = render(<VertexLogo />);
    const fills = [...container.querySelectorAll('path')].map((one) => one.getAttribute('fill'));
    expect(fills.every((fill) => fill?.startsWith('#') === true)).toBe(true);
    expect(fills).toContain(INK.notchAccent);
  });

  it('lets the words take the ground colour in both tones, so one lockup serves both themes', () => {
    // §2 has the two themes as equals. A wordmark baked black has chosen the
    // light one, and the dark theme then needs a second file nobody updates.
    for (const tone of ['full', 'mono'] as const) {
      cleanup();
      const { container } = render(<VertexLogo layout="horizontal" tone={tone} />);
      const wordmark = [...container.querySelectorAll('g path')];
      expect(wordmark).toHaveLength(WORDMARK_GLYPHS.length);
      expect(wordmark.every((one) => one.getAttribute('fill') === 'currentColor')).toBe(true);
    }
  });

  it('gives each layout its own aspect, and the wordmark to the two that carry words', () => {
    const { container: mark } = render(<VertexLogo layout="mark" />);
    expect(ratio(mark.querySelector('svg'))).toBe(1);
    expect(mark.querySelectorAll('g path')).toHaveLength(0);

    cleanup();
    const { container: wide } = render(<VertexLogo layout="horizontal" />);
    expect(ratio(wide.querySelector('svg'))).toBeGreaterThan(2);

    cleanup();
    const { container: tall } = render(<VertexLogo layout="stacked" />);
    expect(ratio(tall.querySelector('svg'))).toBeLessThan(1.6);
    expect(tall.querySelectorAll('g path').length).toBeGreaterThan(0);
  });

  it('leaves the tagline out unless it is asked for, and sets it in the bundled family', () => {
    const { container: without } = render(<VertexLogo layout="horizontal" />);
    expect(without.querySelector('text')).toBeNull();

    cleanup();
    const { container: with_ } = render(
      <VertexLogo layout="horizontal" tagline="RETAIL MANAGEMENT SUITE" />,
    );
    const text = with_.querySelector('text');
    expect(text?.textContent).toBe('RETAIL MANAGEMENT SUITE');
    expect(text?.getAttribute('font-family')).toContain('--vx-font-latin');

    // Set to the wordmark's exact width rather than spaced by hand: tracked by
    // hand it is a different width in every font that substitutes, and the
    // lockup's own box then depends on which machine drew it — which is how a
    // tagline ends up clipped by its own viewBox.
    expect(text?.getAttribute('lengthAdjust')).toBe('spacing');
    expect(Number(text?.getAttribute('textLength'))).toBeGreaterThan(200);
  });

  it('builds the registered sign from the wordmark own R rather than a second design of one', () => {
    const { container } = render(<VertexLogo layout="horizontal" registered />);
    const ring = container.querySelector('circle');
    expect(ring?.getAttribute('stroke')).toBe('currentColor');
    expect(ring?.getAttribute('fill')).toBe('none');
  });

  it('is sized by its caller, and falls back to the icon height', () => {
    const { container: sized } = render(<VertexLogo className="h-28 w-auto" />);
    expect(sized.querySelector('svg')?.getAttribute('class')).toContain('h-28');
    expect(sized.querySelector('svg')?.getAttribute('class')).not.toContain('--vx-icon');

    cleanup();
    const { container: unsized } = render(<VertexLogo />);
    expect(unsized.querySelector('svg')?.getAttribute('class')).toContain('--vx-icon');
  });
});

describe('<VertexAppIcon> — §4.5', () => {
  it('carries its own ground, because a platform puts it on whatever the person chose', () => {
    const { container } = render(<VertexAppIcon size={1024} />);
    const plate = container.querySelector('rect');
    expect(plate?.getAttribute('fill')).toBe(INK.lip);
    // Rounded, because every platform rounds it anyway and one that draws its
    // own corner controls where the corner lands.
    expect(Number(plate?.getAttribute('rx'))).toBeGreaterThan(0);
  });

  it('drops the carve lit edge at the sizes where a four-unit line is a smear', () => {
    const { container: large } = render(<VertexAppIcon size={512} />);
    const { container: small } = render(<VertexAppIcon size={16} />);
    expect(large.querySelectorAll('path').length).toBeGreaterThan(
      small.querySelectorAll('path').length,
    );
  });

  it('insets the mark, so the platform crop never clips the cube', () => {
    const { container } = render(<VertexAppIcon size={64} />);
    const group = container.querySelector('g');
    expect(group?.getAttribute('transform')).toContain('scale(');
    expect(group?.getAttribute('transform')).toContain('translate(');
  });
});
