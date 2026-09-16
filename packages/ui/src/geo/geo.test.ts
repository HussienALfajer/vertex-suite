import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Polygon, Topology } from 'topojson-specification';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isHome, regionOutlines, worldOutlines } from './atlas.js';
import { cluster } from './cluster.js';
import { parsePlace } from './parse.js';
import { pathFor } from './path.js';
import {
  fitToPoints,
  fromWorld,
  panBy,
  project,
  toWorld,
  unproject,
  zoomAround,
  type LatLng,
  type MapView,
  type Viewport,
} from './projection.js';
import { narrow } from './topology.js';

const VIEWPORT: Viewport = { width: 800, height: 500 };

/** Aleppo, Damascus, and a warehouse between them. */
const ALEPPO: LatLng = { lat: 36.1997, lng: 37.1637 };
const DAMASCUS: LatLng = { lat: 33.5138, lng: 36.2765 };
const HOMS: LatLng = { lat: 34.7324, lng: 36.7137 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Projecting a place onto the map — SYS-14', () => {
  it('puts a place back where it came from, at every zoom the map offers', () => {
    for (const zoom of [1, 4, 7, 11, 15, 19]) {
      for (const place of [ALEPPO, DAMASCUS, { lat: -33.87, lng: 151.21 }]) {
        const view: MapView = { centre: DAMASCUS, zoom };
        const back = unproject(project(place, view, VIEWPORT), view, VIEWPORT);
        expect(back.lat).toBeCloseTo(place.lat, 9);
        expect(back.lng).toBeCloseTo(place.lng, 9);
      }
    }
  });

  it('agrees with the tile scheme every raster layer is cut to', () => {
    // Web Mercator by definition: the whole world is one 256-pixel tile at zoom
    // zero, the equator and the prime meridian meet in the middle of it, and
    // the north-west corner is the origin. A vector layer that disagreed with
    // this could never be registered against a tile.
    expect(toWorld({ lat: 0, lng: 0 }, 0)).toEqual({ x: 128, y: 128 });
    expect(toWorld({ lat: 0, lng: -180 }, 0).x).toBe(0);
    expect(toWorld({ lat: 85.05112878, lng: 0 }, 0).y).toBeCloseTo(0, 6);
    expect(fromWorld({ x: 128, y: 128 }, 0).lat).toBeCloseTo(0, 9);
  });

  it('keeps the place under the pointer still while the wheel turns', () => {
    // The difference between a map that follows what somebody is looking at and
    // one that throws it away on every notch of the wheel.
    const view: MapView = { centre: DAMASCUS, zoom: 6 };
    const anchor = { x: 640, y: 120 };
    const held = unproject(anchor, view, VIEWPORT);

    const closer = zoomAround(view, anchor, 9, VIEWPORT);
    const after = project(held, closer, VIEWPORT);

    expect(closer.zoom).toBe(9);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });

  it('refuses to zoom past the ends of the range rather than running off them', () => {
    const view: MapView = { centre: DAMASCUS, zoom: 6 };
    expect(zoomAround(view, { x: 0, y: 0 }, 99, VIEWPORT).zoom).toBe(19);
    expect(zoomAround(view, { x: 0, y: 0 }, -99, VIEWPORT).zoom).toBe(1);
  });

  it('moves the map by exactly the drag, and no further', () => {
    const view: MapView = { centre: DAMASCUS, zoom: 8 };
    const before = project(ALEPPO, view, VIEWPORT);
    const after = project(ALEPPO, panBy(view, { x: 60, y: -25 }, VIEWPORT), VIEWPORT);

    expect(after.x).toBeCloseTo(before.x + 60, 6);
    expect(after.y).toBeCloseTo(before.y - 25, 6);
  });

  it('frames every branch the tenant has, inside the padding', () => {
    // The tenant asked for the map to arrive showing all of their places. A
    // fixed world view would put one marker over Syria and say nothing; this is
    // what "zoomed so they all show" actually means.
    const places = [ALEPPO, DAMASCUS, HOMS];
    const view = fitToPoints(places, VIEWPORT, { padding: 48, singleZoom: 13, maxZoom: 19 });
    expect(view).not.toBeNull();

    for (const place of places) {
      const at = project(place, view!, VIEWPORT);
      expect(at.x).toBeGreaterThanOrEqual(48 - 1);
      expect(at.x).toBeLessThanOrEqual(VIEWPORT.width - 48 + 1);
      expect(at.y).toBeGreaterThanOrEqual(48 - 1);
      expect(at.y).toBeLessThanOrEqual(VIEWPORT.height - 48 + 1);
    }
  });

  it('opens on the street when there is one place, not on the whole planet', () => {
    const view = fitToPoints([ALEPPO], VIEWPORT, { padding: 48, singleZoom: 13, maxZoom: 19 });
    expect(view?.zoom).toBe(13);
    expect(view?.centre.lat).toBeCloseTo(ALEPPO.lat, 9);
  });

  it('says nothing rather than inventing a view when nothing is placed', () => {
    // A tenant on their first day has placed none of their branches. The screen
    // has something better to show than the middle of the Atlantic.
    expect(fitToPoints([], VIEWPORT, { padding: 48, singleZoom: 13, maxZoom: 19 })).toBeNull();
  });
});

describe('Gathering markers that would overlap — SYS-14', () => {
  const at = (x: number, y: number, id: string) => ({ of: { id }, at: { x, y } });
  const keyOf = (of: { id: string }) => of.id;

  it('joins what would overlap and leaves apart what would not', () => {
    const gathered = cluster([at(10, 10, 'a'), at(20, 14, 'b'), at(300, 200, 'c')], 40, keyOf);

    expect(gathered).toHaveLength(2);
    expect(gathered[0]?.members.map(keyOf)).toEqual(['a', 'b']);
    expect(gathered[1]?.members.map(keyOf)).toEqual(['c']);
  });

  it('sits a cluster between its members rather than on the first of them', () => {
    const gathered = cluster([at(0, 0, 'a'), at(20, 0, 'b')], 40, keyOf);
    expect(gathered[0]?.at.x).toBeCloseTo(10, 9);
  });

  it('gives the same answer twice, so the focus order does not reshuffle', () => {
    // Markers are buttons. A clustering that moved them between renders would
    // move a keyboard's place in the list under the person using it.
    const places = [at(0, 0, 'a'), at(10, 5, 'b'), at(500, 300, 'c'), at(12, 9, 'd')];
    expect(cluster(places, 40, keyOf)).toEqual(cluster(places, 40, keyOf));
    expect(cluster(places, 40, keyOf).map((one) => one.key)).toEqual(['a', 'c']);
  });
});

describe('Reading a place out of what somebody pasted — SYS-14', () => {
  it('reads the link a shop owner already has on their phone', () => {
    const cases = [
      'https://www.google.com/maps/@36.1997,37.1637,17z',
      'https://www.google.com/maps/place/Aleppo/@36.2,37.2,14z/data=!3m1!4b1!3d36.1997!4d37.1637',
      'https://maps.google.com/?q=36.1997,37.1637',
      'geo:36.1997,37.1637',
      '36.1997, 37.1637',
      '36.1997 37.1637',
    ];
    for (const text of cases) {
      expect(parsePlace(text), text).toEqual({ kind: 'point', lat: '36.1997', lng: '37.1637' });
    }
  });

  it('prefers the pin to the middle of the view when a link carries both', () => {
    const both = 'https://www.google.com/maps/place/X/@36.2,37.2,14z/data=!3d36.1997!4d37.1637';
    expect(parsePlace(both)).toEqual({ kind: 'point', lat: '36.1997', lng: '37.1637' });
  });

  it('reads the digits of the keyboard the shop actually types on', () => {
    // §5.5 makes Arabic-Indic digits a display setting. A field that could not
    // read back what the screen beside it renders would be a broken promise.
    expect(parsePlace('٣٦٫١٩٩٧، ٣٧٫١٦٣٧')).toEqual({
      kind: 'point',
      lat: '36.1997',
      lng: '37.1637',
    });
  });

  it('keeps the sign of a place south or west of nothing', () => {
    expect(parsePlace('-33.8688, 151.2093')).toEqual({
      kind: 'point',
      lat: '-33.8688',
      lng: '151.2093',
    });
  });

  it('names a shortened link instead of following it', () => {
    // Following it would be this product asking a third party where a tenant's
    // shop is, and would not work in a shop with no line. The screen says how
    // to get the long form instead.
    expect(parsePlace('https://maps.app.goo.gl/abc123')).toEqual({ kind: 'shortened' });
    expect(parsePlace('https://goo.gl/maps/abc123')).toEqual({ kind: 'shortened' });
  });

  it('refuses what is not a place at all', () => {
    for (const text of ['', '   ', 'حلب', '999.9, 0', '36.1997', 'https://example.com/shop']) {
      expect(parsePlace(text).kind, text).toBe('none');
    }
  });
});

describe('The atlas that ships with the product — SYS-14', () => {
  it('draws the map with nothing reaching the network', () => {
    // `SYS-14`'s acceptance criterion, in the layer that draws: anything that
    // tried to fetch a tile or an outline would land here and throw.
    vi.stubGlobal('fetch', () => {
      throw new Error('SYS-14 reached the network.');
    });

    const view: MapView = { centre: DAMASCUS, zoom: 7 };
    const draw = pathFor(view, VIEWPORT);
    const home = regionOutlines().find(isHome);

    expect(worldOutlines().length).toBeGreaterThan(0);
    expect(home).toBeDefined();
    expect(draw(home!).startsWith('M')).toBe(true);
  });

  it('carries the countries around the one it is sold in, and not the rest of the world', () => {
    // The cut is by edition: a Syrian shop has no use for the provinces of
    // Brazil, and the bytes it would cost are bytes in every install.
    const outlines = regionOutlines();
    expect(outlines).toHaveLength(11);
    expect(outlines.filter(isHome)).toHaveLength(1);
  });

  it('draws the home country where the home country is', () => {
    // The sharpest cheap test of the arc sweep in `narrow`: a mis-rewritten
    // index does not produce a broken file, it produces a border drawn through
    // the wrong country, and only the coordinates say so.
    const home = regionOutlines().find(isHome);
    const path = pathFor({ centre: DAMASCUS, zoom: 6 }, VIEWPORT)(home!);
    const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((one) => Number(one[0]));

    // Syria spans roughly 32.3°–37.3°N and 35.7°–42.4°E. At this zoom and
    // centre that is a shape a few hundred pixels across, near the middle.
    expect(Math.min(...numbers)).toBeGreaterThan(-2000);
    expect(Math.max(...numbers)).toBeLessThan(3000);
    expect(numbers.length).toBeGreaterThan(100);
  });

  it('stays small enough to ship in every install', () => {
    // A committed data file with no ceiling grows until somebody notices it in
    // a bundle report, which is years later.
    const bytes = readFileSync(resolve(process.cwd(), 'src/geo/atlas.generated.ts')).byteLength;
    expect(bytes).toBeLessThan(150 * 1024);
  });
});

describe('Cutting the atlas to an edition — SYS-14', () => {
  /**
   * Four arcs, two shapes. The second shape uses one arc forwards and one
   * backwards, which is the case a sweep gets wrong: `~1` has to survive as
   * `~0` and not as `1`.
   */
  const keep: Polygon = { type: 'Polygon', id: 'keep', arcs: [[1, ~0]] };
  const drop: Polygon = { type: 'Polygon', id: 'drop', arcs: [[2, 3]] };

  const withShapes = (): Topology => ({
    type: 'Topology',
    arcs: [
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [1, 1],
      ],
      [
        [9, 9],
        [8, 8],
      ],
      [
        [7, 7],
        [6, 6],
      ],
    ],
    objects: {
      countries: { type: 'GeometryCollection', geometries: [keep, drop] },
    },
  });

  it('drops the arcs nothing points at, and rewrites what is left in place', () => {
    const cut = narrow(withShapes(), (geometry) => geometry.id === 'keep');
    const kept = cut.objects['countries'];

    expect(cut.arcs).toHaveLength(2);
    expect(cut.arcs).toEqual([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [1, 1],
      ],
    ]);

    // Arc 1 became 0 and arc 0 became… still 0, and the reversal has to travel
    // with it: `~0` in, `~0` out, because arc 0 kept its place.
    const geometries =
      kept?.type === 'GeometryCollection' ? (kept.geometries as { arcs: number[][] }[]) : [];
    expect(geometries).toHaveLength(1);
    expect(geometries[0]?.arcs).toEqual([[1, ~0]]);
  });

  it('keeps every index it emits pointing at an arc that exists', () => {
    const cut = narrow(withShapes(), (geometry) => geometry.id === 'keep');
    const referenced = JSON.stringify(cut.objects)
      .match(/-?\d+/g)
      ?.map(Number)
      .map((index) => (index < 0 ? ~index : index));

    for (const index of referenced ?? []) {
      expect(index).toBeLessThan(cut.arcs.length);
    }
  });
});

describe('Properties of the projection — SYS-14', () => {
  it('never moves a place by more than a pixel through a round trip, anywhere', () => {
    // A property rather than an example: the map is dragged and zoomed
    // thousands of times in a session, and each one is a round trip.
    let worst = 0;
    for (let lat = -80; lat <= 80; lat += 7) {
      for (let lng = -175; lng <= 175; lng += 13) {
        for (const zoom of [2, 8, 14]) {
          const view: MapView = { centre: { lat: lat / 2, lng: lng / 2 }, zoom };
          const at = project({ lat, lng }, view, VIEWPORT);
          const back = project(unproject(at, view, VIEWPORT), view, VIEWPORT);
          worst = Math.max(worst, Math.hypot(back.x - at.x, back.y - at.y));
        }
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });
});
