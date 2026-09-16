import { clsx } from 'clsx';
import { useMemo, type ReactNode } from 'react';

import { isHome, regionOutlines, worldOutlines } from './atlas.js';
import { pathFor } from './path.js';
import type { MapView, Viewport } from './projection.js';
import { tileUrl, tilesFor } from './tiles.js';

/**
 * What is under the markers.
 *
 * **The outlines are not an alternative to the tiles; they are the ground under
 * them.** The atlas ships with the product and is drawn on every map at every
 * zoom, and `SYS-14` says the map reads with every network interface disabled —
 * which is true here rather than promised, because when no tile arrives the
 * land is already painted. There is no error state and nothing to fall back
 * *to*: the tiles are detail laid over a map that was already correct.
 *
 * `tiles` is a source the **application** chose — a public one from a back
 * office that has a line, or the tenant's own store node serving the shop
 * network. Its attribution is rendered, not optional.
 */
export type Basemap =
  | { readonly kind: 'outlines' }
  | {
      readonly kind: 'tiles';
      /** An XYZ template: `{z}`, `{x}` and `{y}` are filled, nothing else is read. */
      readonly url: string;
      readonly maxZoom: number;
      readonly attribution: string;
    };

/** As far in as the shipped outlines say anything. Past it there is only a tile. */
export const OUTLINE_MAX_ZOOM = 9;

/**
 * The streets, from OpenStreetMap.
 *
 * Named here rather than typed into a screen so that the one place this product
 * reaches a third party for map imagery is one file, reviewable, with its
 * attribution attached to it and not to the caller's memory.
 *
 * **OpenStreetMap and not Google.** Google's terms do not permit its tiles
 * outside its own SDK, and both it and every commercial alternative need an API
 * key — which in a per-customer edition means a vendor account behind every
 * install, which `SYS-09`'s acceptance criterion refuses in as many words. OSM
 * needs no key, and its tile usage policy is met by what a back office actually
 * does: a person looking at a map, not a crawler.
 *
 * Nothing **requires** it. The outline layer is drawn underneath, so a shop
 * whose line is down still has a map (`SYS-14`).
 */
export const STREET_MAP: Basemap = {
  kind: 'tiles',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
  attribution: '© OpenStreetMap',
};

export function zoomCeilingOf(basemap: Basemap): number {
  return basemap.kind === 'tiles' ? basemap.maxZoom : OUTLINE_MAX_ZOOM;
}

export interface BaseLayerProps {
  readonly view: MapView;
  readonly viewport: Viewport;
  readonly basemap: Basemap;
}

export function BaseLayer({ view, viewport, basemap }: BaseLayerProps): ReactNode {
  /**
   * Drawn **under the tiles, always** — not instead of them.
   *
   * It is what is left when the tiles do not arrive, which on a shop network is
   * a Tuesday rather than an incident. A map that went blank the moment the
   * line dropped would break `SYS-14`'s own acceptance criterion; one that
   * falls back to the outline it shipped with keeps saying something true, and
   * needs no error state to do it — the land simply shows through.
   */
  const outlines = useMemo(() => {
    const draw = pathFor(view, viewport);
    return {
      world: worldOutlines().map((one, index) => ({ key: String(index), d: draw(one) })),
      region: regionOutlines().map((one) => ({
        key: String(one.id ?? ''),
        d: draw(one),
        isHome: isHome(one),
      })),
    };
  }, [view, viewport]);

  const tiles = useMemo(
    () => (basemap.kind === 'tiles' ? tilesFor(view, viewport, basemap.maxZoom) : []),
    [view, viewport, basemap],
  );

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      width={viewport.width}
      height={viewport.height}
    >
      {/*
       * The world first and flat, then the region over it with its borders.
       * Two layers rather than one so that the country this edition is sold in
       * reads as the subject and its neighbours as context — which is what a
       * person looking for their own branch is actually scanning for.
       */}
      {outlines.world.map((one) => (
        <path key={one.key} d={one.d} className="fill-map-land" />
      ))}
      {outlines.region.map((one) => (
        <path
          key={one.key}
          d={one.d}
          className={clsx('stroke-map-line', one.isHome ? 'fill-map-land-home' : 'fill-map-land')}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {basemap.kind === 'tiles'
        ? tiles.map((tile) => (
            <image
              key={tile.key}
              href={tileUrl(basemap.url, tile)}
              x={tile.left}
              y={tile.top}
              // A hair over, because a tile drawn at a fractional scale leaves a
              // sub-pixel gap at its own edge and a grid of them reads as a
              // faint mesh over the whole map.
              width={tile.size + 0.5}
              height={tile.size + 0.5}
              // The tiles carry the detail; the outline under them is the
              // ground truth. Crossfading in is what makes a slow line look
              // like a map loading rather than a map flickering.
              className="motion-safe:transition-opacity motion-safe:duration-[var(--vx-dur-base)]"
            />
          ))
        : null}
    </svg>
  );
}
