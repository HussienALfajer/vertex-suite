import { geoCentroid } from 'd3-geo';
import type { Feature } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Objects, Properties } from 'topojson-specification';

import { HOME, REGION, WORLD } from './atlas.generated.js';
import type { LatLng } from './projection.js';

/**
 * The geometry that ships with the product, as shapes something can draw.
 *
 * `SYS-14` says the map reads with no connection at all, and this is where that
 * is true rather than promised: the outlines are in the bundle, there is no
 * fetch anywhere under this file, and a shop whose line is down sees the same
 * map as one whose line is up.
 *
 * Converted on first use and kept. `feature` walks the whole topology to
 * rebuild the rings, which is work worth doing once per session and not once
 * per frame — and every screen that draws a map draws the same two layers.
 */

export type Outline = Feature;

function collectionIn(objects: Objects<Properties>, name: string): GeometryCollection<Properties> {
  const object = objects[name];
  if (object?.type !== 'GeometryCollection') {
    throw new Error(`The generated atlas has no "${name}" collection. Re-run the generator.`);
  }
  return object;
}

let world: readonly Outline[] | null = null;
let region: readonly Outline[] | null = null;

/** The world's coastline. What is under the map when it is zoomed out. */
export function worldOutlines(): readonly Outline[] {
  world ??= feature(WORLD, collectionIn(WORLD.objects, 'land')).features;
  return world;
}

/** The countries of this edition's region, with the borders between them. */
export function regionOutlines(): readonly Outline[] {
  region ??= feature(REGION, collectionIn(REGION.objects, 'countries')).features;
  return region;
}

/** True for the country this edition is sold in, which is drawn as the subject. */
export function isHome(outline: Outline): boolean {
  return String(outline.id ?? '') === HOME;
}

/**
 * The middle of the country this edition is sold in.
 *
 * The last resort of the picker's opening view, and the reason it is computed
 * from the shipped geometry rather than written down as two numbers: a hardcoded
 * pair would be a second statement of where the edition is sold, free to
 * disagree with the atlas the moment the region list changes.
 */
export function homeCentre(): LatLng {
  const home = regionOutlines().find(isHome);
  if (home === undefined) {
    throw new Error('The generated atlas has no home country. Re-run the generator.');
  }
  const [lng, lat] = geoCentroid(home);
  return { lat, lng };
}
