/**
 * The map of `SYS-14`, behind its own entry point.
 *
 * `@vertex/ui/map` rather than `@vertex/ui`, because the atlas is the largest
 * thing this package ships and the register has no map on it. An application
 * that never imports this never carries the geometry.
 */
export { GeoMap, asLatLng, type GeoMapProps, type MapPlace, type PlaceKind } from './GeoMap.js';

export { PointPicker, type PickedPoint, type PointPickerProps } from './PointPicker.js';

export {
  BaseLayer,
  OUTLINE_MAX_ZOOM,
  STREET_MAP,
  zoomCeilingOf,
  type Basemap,
} from './BaseLayer.js';

export {
  nominatimSearch,
  type FoundPlace,
  type NominatimOptions,
  type PlaceSearch,
} from './geocode.js';

export { fold, matchesPlace } from './match.js';

export {
  homeCentre,
  homeExtent,
  isHome,
  regionOutlines,
  worldOutlines,
  type Outline,
} from './atlas.js';

export { cluster, type Cluster, type Placed } from './cluster.js';

export { parsePlace, type ParsedPlace } from './parse.js';

export { pathFor, type DrawOutline } from './path.js';

export {
  LATITUDE_LIMIT,
  LONGITUDE_LIMIT,
  MAX_ZOOM,
  MERCATOR_LIMIT,
  MIN_ZOOM,
  TILE,
  clamp,
  fitToPoints,
  fromWorld,
  isOnEarth,
  panBy,
  project,
  toWorld,
  unproject,
  worldSize,
  zoomAround,
  type FitOptions,
  type LatLng,
  type MapView,
  type Pixel,
  type Viewport,
} from './projection.js';

export { useMapGestures, useMeasured, type Gestures, type GestureOptions } from './surface.js';

export { tileUrl, tilesFor, type TileRef } from './tiles.js';

export { narrow } from './topology.js';
