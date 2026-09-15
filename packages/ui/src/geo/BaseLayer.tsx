import { clsx } from 'clsx';
import { useMemo, type ReactNode } from 'react';

import { isHome, regionOutlines, worldOutlines } from './atlas.js';
import { pathFor } from './path.js';
import type { MapView, Viewport } from './projection.js';
import { tileUrl, tilesFor } from './tiles.js';

/**
 * What is under the markers.
 *
 * `outlines` is the atlas that ships with the product and is the default,
 * because it is the only one that works in a shop with no line — `SYS-14` says
 * the map reads with every network interface disabled, and this is where that
 * is true rather than promised. `tiles` is a source the **tenant** configured,
 * whether that is their own store node serving the shop network or a public one
 * reachable from the back office; its attribution is rendered, not optional.
 *
 * No tenant is ever required to have one. A screen with no tile source is a
 * screen that works.
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

export function zoomCeilingOf(basemap: Basemap): number {
  return basemap.kind === 'tiles' ? basemap.maxZoom : OUTLINE_MAX_ZOOM;
}

export interface BaseLayerProps {
  readonly view: MapView;
  readonly viewport: Viewport;
  readonly basemap: Basemap;
}

export function BaseLayer({ view, viewport, basemap }: BaseLayerProps): ReactNode {
  const outlines = useMemo(() => {
    if (basemap.kind === 'tiles') return null;
    const draw = pathFor(view, viewport);
    return {
      world: worldOutlines().map((one, index) => ({ key: String(index), d: draw(one) })),
      region: regionOutlines().map((one) => ({
        key: String(one.id ?? ''),
        d: draw(one),
        isHome: isHome(one),
      })),
    };
  }, [view, viewport, basemap.kind]);

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
      {basemap.kind === 'tiles'
        ? tiles.map((tile) => (
            <image
              key={tile.key}
              href={tileUrl(basemap.url, tile)}
              x={tile.left}
              y={tile.top}
              width={tile.size}
              height={tile.size}
            />
          ))
        : null}

      {outlines === null ? null : (
        <>
          {/*
           * The world first and flat, then the region over it with its borders.
           * Two layers rather than one so that the country this edition is sold
           * in reads as the subject and its neighbours as context — which is
           * what a person looking for their own branch is actually scanning for.
           */}
          {outlines.world.map((one) => (
            <path key={one.key} d={one.d} className="fill-map-land" />
          ))}
          {outlines.region.map((one) => (
            <path
              key={one.key}
              d={one.d}
              className={clsx(
                'stroke-map-line',
                one.isHome ? 'fill-map-land-home' : 'fill-map-land',
              )}
              strokeWidth={0.75}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      )}
    </svg>
  );
}
