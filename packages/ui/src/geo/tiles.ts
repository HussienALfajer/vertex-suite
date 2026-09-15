import { TILE, clamp, toWorld, type MapView, type Viewport } from './projection.js';

/**
 * Which tiles cover the view, for the **optional** street layer (`SYS-14`).
 *
 * Nothing in the product requires this. The outlines that ship are what the map
 * is; a tile layer is something a tenant may point at a source of their own —
 * one served by their own store node over the shop network, or a public one
 * when the back office has a line. That is the difference between a feature and
 * a dependency: with no source configured, every screen still works.
 *
 * It is plain XYZ arithmetic and needs no map library. A tile is an image at a
 * position, and a WebGL renderer with its own style language would be two
 * hundred kilobytes to place squares on a grid.
 */

export interface TileRef {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** Where to put it, in the map's own pixels, and how big to draw it. */
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly key: string;
}

/**
 * The zoom is split into an integer level and a scale.
 *
 * Tiles exist only at whole levels, so a view at 8.4 draws level-8 tiles
 * stretched by 2^0.4. Rounding the level up instead would fetch four times as
 * many tiles to show them shrunk, which is four times the traffic for a picture
 * nobody can see more of.
 */
export function tilesFor(view: MapView, viewport: Viewport, maxZoom: number): readonly TileRef[] {
  const z = Math.max(0, Math.min(Math.floor(view.zoom), Math.floor(maxZoom)));
  const scale = 2 ** (view.zoom - z);
  const size = TILE * scale;
  const across = 2 ** z;

  const centre = toWorld(view.centre, z);
  const left = centre.x - viewport.width / 2 / scale;
  const top = centre.y - viewport.height / 2 / scale;

  const firstX = Math.floor(left / TILE);
  const lastX = Math.floor((left + viewport.width / scale) / TILE);
  const firstY = clamp(Math.floor(top / TILE), 0, across - 1);
  const lastY = clamp(Math.floor((top + viewport.height / scale) / TILE), 0, across - 1);

  const tiles: TileRef[] = [];
  for (let y = firstY; y <= lastY; y += 1) {
    for (let x = firstX; x <= lastX; x += 1) {
      // The world repeats sideways and does not repeat vertically, which is why
      // only this axis wraps: dragging west past the date line should carry on
      // showing the world, and dragging north past the pole should not invent
      // one.
      const wrapped = ((x % across) + across) % across;
      tiles.push({
        z,
        x: wrapped,
        y,
        left: (x * TILE - left) * scale,
        top: (y * TILE - top) * scale,
        size,
        key: `${String(z)}/${String(x)}/${String(y)}`,
      });
    }
  }
  return tiles;
}

/** Fills `{z}`, `{x}` and `{y}` in a tile template. No other placeholder is read. */
export function tileUrl(template: string, tile: TileRef): string {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}
