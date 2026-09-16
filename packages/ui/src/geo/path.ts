import { geoPath, geoTransform, type GeoPermissibleObjects } from 'd3-geo';

import { project, type MapView, type Viewport } from './projection.js';

/**
 * Outlines as SVG path data, through this package's own projection.
 *
 * `geoTransform` rather than `geoMercator`: d3 is asked to do the part that is
 * genuinely fiddly — walking rings, closing them, keeping holes as holes — and
 * is handed each point already projected by `projection.ts`. So there is one
 * statement of where a place lands on the screen, used by the outlines and by
 * the markers alike. Two would drift, and the drift would show as markers
 * sitting a few pixels off the country they are in.
 */

export type DrawOutline = (of: GeoPermissibleObjects) => string;

export function pathFor(view: MapView, viewport: Viewport): DrawOutline {
  const transform = geoTransform({
    point(this: { stream: { point: (x: number, y: number) => void } }, lng: number, lat: number) {
      const at = project({ lat, lng }, view, viewport);
      this.stream.point(at.x, at.y);
    },
  });

  const draw = geoPath(transform);
  return (of: GeoPermissibleObjects): string => draw(of) ?? '';
}
