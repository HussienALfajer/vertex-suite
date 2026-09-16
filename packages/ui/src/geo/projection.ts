/**
 * Where a place on the Earth lands on the screen, and back again (`SYS-14`).
 *
 * **Web Mercator, and not by taste.** An equal-area projection would draw the
 * world more honestly, and this one still has to be Mercator: every raster tile
 * anybody could point the optional base layer at is Web Mercator by definition,
 * and a vector layer drawn in anything else would never register with it. The
 * choice has to be made once, here, or paid for later by rewriting both.
 *
 * Everything in this file is a pure function of its arguments. Nothing measures
 * an element, nothing reads a `getBBox`, nothing touches a document — which is
 * what lets the hard part of a map be tested in a test runner with no browser,
 * and what stops the behaviour of the map depending on how it happened to be
 * laid out. The component measures its own box once and hands the numbers here.
 */

/** A point on the Earth, in degrees. North and east positive. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** A point on the screen, in CSS pixels from the top-left of the map's box. */
export interface Pixel {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * What the map is looking at: a place in the middle and how close in.
 *
 * Zoom is the slippy-map scale everybody else uses — the world is
 * `TILE * 2 ** zoom` pixels across — so a tile layer needs no translation and
 * a zoom taken from any map anywhere means the same thing here.
 */
export interface MapView {
  readonly centre: LatLng;
  readonly zoom: number;
}

/** The edge of the square Mercator can draw. Beyond it the projection diverges. */
export const MERCATOR_LIMIT = 85.05112878;

export const LATITUDE_LIMIT = 90;
export const LONGITUDE_LIMIT = 180;

/** One tile, in pixels. 256 is the size every XYZ scheme is defined against. */
export const TILE = 256;

export const MIN_ZOOM = 1;

/**
 * Past this, a vector outline is a straight line across the screen and the only
 * thing worth drawing is a tile. The picker still goes further when a tile
 * layer is configured; this is the ceiling for the geometry that ships.
 */
export const MAX_ZOOM = 19;

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** True when both degrees are ones the Earth has. */
export function isOnEarth(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= LATITUDE_LIMIT &&
    Math.abs(lng) <= LONGITUDE_LIMIT
  );
}

/** The world, in pixels, at this zoom. */
export function worldSize(zoom: number): number {
  return TILE * 2 ** zoom;
}

/**
 * Degrees to a position in the whole-world pixel square at this zoom.
 *
 * Latitude is clamped to Mercator's own limit rather than refused: a point
 * inside the Arctic circle is a real place, and a map that threw rather than
 * drawing it at the top edge would be a map that crashes on a customer's data.
 */
export function toWorld(point: LatLng, zoom: number): Pixel {
  const size = worldSize(zoom);
  const latitude = (clamp(point.lat, -MERCATOR_LIMIT, MERCATOR_LIMIT) * Math.PI) / 180;
  const sin = Math.sin(latitude);
  return {
    x: ((point.lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** The inverse of `toWorld`, exactly. */
export function fromWorld(pixel: Pixel, zoom: number): LatLng {
  const size = worldSize(zoom);
  const y = 0.5 - pixel.y / size;
  const lng = (pixel.x / size) * 360 - 180;
  return {
    lat: (Math.atan(Math.sinh(2 * Math.PI * y)) * 180) / Math.PI,
    // Wrapped back into (-180, 180]: panning is repeated small offsets against
    // whatever `centre.lng` already is, and left unwrapped it walks past the
    // edge after enough of them — at which point `toWorld` (which does not
    // wrap) places the outline layer a whole world away from where the tile
    // layer's own wrapped `x` still draws it.
    lng: ((((lng + 180) % 360) + 360) % 360) - 180,
  };
}

/** Where a place sits inside the map's own box. */
export function project(point: LatLng, view: MapView, viewport: Viewport): Pixel {
  const origin = toWorld(view.centre, view.zoom);
  const here = toWorld(point, view.zoom);
  return {
    x: here.x - origin.x + viewport.width / 2,
    y: here.y - origin.y + viewport.height / 2,
  };
}

/** What a place on the screen is a place on the Earth. */
export function unproject(pixel: Pixel, view: MapView, viewport: Viewport): LatLng {
  const origin = toWorld(view.centre, view.zoom);
  return fromWorld(
    { x: origin.x + pixel.x - viewport.width / 2, y: origin.y + pixel.y - viewport.height / 2 },
    view.zoom,
  );
}

/** Moves the view by a drag, in screen pixels, without changing the zoom. */
export function panBy(view: MapView, by: Pixel, viewport: Viewport): MapView {
  const centre = unproject(
    { x: viewport.width / 2 - by.x, y: viewport.height / 2 - by.y },
    view,
    viewport,
  );
  return { centre, zoom: view.zoom };
}

/**
 * Zooms while holding one screen position over the same place on the Earth.
 *
 * Anchored on the pointer rather than on the middle of the box. It is the whole
 * difference between a map that follows what somebody is looking at and one
 * that throws their place away every time the wheel turns — the correction
 * afterwards is a drag they did not intend to make.
 */
export function zoomAround(
  view: MapView,
  anchor: Pixel,
  zoom: number,
  viewport: Viewport,
): MapView {
  const wanted = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  if (wanted === view.zoom) return view;

  const held = unproject(anchor, view, viewport);
  const after = { centre: held, zoom: wanted };
  // Where the held place would land if the anchor were the middle, and the
  // shift that puts it back under the pointer instead.
  const drift = project(held, after, viewport);
  return panBy(after, { x: anchor.x - drift.x, y: anchor.y - drift.y }, viewport);
}

export interface FitOptions {
  /** Kept clear inside every edge, so a marker at the extreme is not half off. */
  readonly padding: number;
  /** Used when the points do not imply a zoom: one point, or all in one spot. */
  readonly singleZoom: number;
  readonly maxZoom: number;
}

/**
 * The view that shows every one of these places at once.
 *
 * Returns `null` for no places at all rather than inventing a view of an empty
 * world: the caller knows what to show when a tenant has placed nothing, and it
 * is not a map of the Atlantic.
 */
export function fitToPoints(
  points: readonly LatLng[],
  viewport: Viewport,
  options: FitOptions,
): MapView | null {
  const first = points[0];
  if (first === undefined) return null;

  let north = first.lat;
  let south = first.lat;
  let west = first.lng;
  let east = first.lng;
  for (const point of points) {
    north = Math.max(north, point.lat);
    south = Math.min(south, point.lat);
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }

  const inner = {
    width: Math.max(viewport.width - options.padding * 2, 1),
    height: Math.max(viewport.height - options.padding * 2, 1),
  };

  // Measured at zoom zero and scaled, because the span in pixels is
  // proportional to the world size and the world size is a power of the zoom.
  const topLeft = toWorld({ lat: north, lng: west }, 0);
  const bottomRight = toWorld({ lat: south, lng: east }, 0);
  const spanX = Math.abs(bottomRight.x - topLeft.x);
  const spanY = Math.abs(bottomRight.y - topLeft.y);

  // The middle of the **box**, not the middle of the latitudes. Mercator
  // stretches as it goes north, so the halfway latitude between two places is
  // not halfway up the screen between them — centring on it pushes the
  // northern one towards the edge and, at a tight fit, out past the padding.
  const centre = fromWorld(
    { x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 },
    0,
  );

  if (spanX < 1e-9 && spanY < 1e-9) {
    return { centre, zoom: clamp(options.singleZoom, MIN_ZOOM, options.maxZoom) };
  }

  const fits = Math.min(
    spanX < 1e-9 ? Infinity : inner.width / spanX,
    spanY < 1e-9 ? Infinity : inner.height / spanY,
  );
  return { centre, zoom: clamp(Math.log2(fits), MIN_ZOOM, options.maxZoom) };
}
