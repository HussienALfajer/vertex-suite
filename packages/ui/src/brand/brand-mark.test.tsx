import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductMark } from './ProductMark.js';

afterEach(cleanup);

describe('<ProductMark> — §4.5', () => {
  it('is hidden from assistive technology unless it is given a name', () => {
    // Beside a heading that already says the name, a second announcement of the
    // same thing is noise to somebody listening rather than looking.
    const { container } = render(<ProductMark />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(container.querySelector('title')).toBeNull();
  });

  it('names itself when it is the only thing identifying the screen', () => {
    const { container } = render(<ProductMark title="Vertex" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(container.querySelector('title')?.textContent).toBe('Vertex');
  });

  it('takes its colour from the ground it sits on when it is monochrome', () => {
    // The full mark's lightest face is near-white, and §4.4 makes `surface-2`
    // pure white in the light theme — so inside a panel the cube loses two of
    // its three faces. The monochrome mark is the answer to that, and to one
    // ink on a receipt, and to sitting on a tenant's brand colour: one
    // silhouette in `currentColor` with the V as the ground showing through.
    const { container } = render(<ProductMark tone="mono" />);
    const paths = [...container.querySelectorAll('path')];

    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('fill')).toBe('currentColor');
    // Two subpaths and `evenodd`: the V is a hole, not a second shape painted
    // in a background colour that only matches one background.
    expect(paths[0]?.getAttribute('fill-rule')).toBe('evenodd');
    expect((paths[0]?.getAttribute('d')?.match(/Z/g) ?? []).length).toBe(2);
  });

  it('carries its own colours, because a logo that follows the theme is not a logo', () => {
    const { container } = render(<ProductMark />);
    const fills = [...container.querySelectorAll('path')].map((one) => one.getAttribute('fill'));

    expect(fills).toHaveLength(5);
    expect(fills.every((fill) => fill?.startsWith('#') === true)).toBe(true);
    // The accent facet is the hue §4.3 gives to interaction, stated here rather
    // than resolved from a token: the mark must not change when the palette does.
    expect(fills).toContain('#1678c9');
  });

  it('is sized by its caller, and falls back to the icon size', () => {
    const { container: sized } = render(<ProductMark className="size-16" />);
    expect(sized.querySelector('svg')?.getAttribute('class')).toContain('size-16');
    // One size, never two: two `size-*` utilities on one element are settled by
    // the order they land in the stylesheet.
    expect(sized.querySelector('svg')?.getAttribute('class')).not.toContain('--vx-icon');

    const { container: unsized } = render(<ProductMark />);
    expect(unsized.querySelector('svg')?.getAttribute('class')).toContain('--vx-icon');
  });
});
