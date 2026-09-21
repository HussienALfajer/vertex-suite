/**
 * The map of `SYS-14`, behind its own entry point.
 *
 * `@vertex/ui/map` rather than `@vertex/ui`, because the atlas is the largest
 * thing this package ships and the register has no map on it. An application
 * that never imports this never carries the geometry.
 *
 * Two components, the one basemap a tenant may configure, the one search a
 * screen may hand the picker, and the types their signatures speak. The
 * projection, the tiles, the gestures, the clustering and the atlas behind
 * them are how the two are built, not what a screen is offered: this once
 * published all of it, and nothing outside the package ever named any of it.
 * A screen that needs a piece of the machinery names it in the pull request
 * that needs it, which is how every entry point in this workspace grows.
 */
export { GeoMap, type GeoMapProps, type MapPlace, type PlaceKind } from './GeoMap.js';

export { PointPicker, type PickedPoint, type PointPickerProps } from './PointPicker.js';

export { STREET_MAP, type Basemap } from './BaseLayer.js';

export {
  nominatimSearch,
  type FoundPlace,
  type NominatimOptions,
  type PlaceSearch,
} from './geocode.js';
