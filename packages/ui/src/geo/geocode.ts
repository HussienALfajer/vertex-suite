import { homeExtent } from './atlas.js';
import { isOnEarth } from './projection.js';

/**
 * Finding a place by typing its name — the one thing in `SYS-14` that needs a
 * line, and therefore the one thing nothing depends on.
 *
 * It is a **function a caller supplies**, not a service this package calls. The
 * map, the picker and the store all work with every interface down; a search
 * over the world's street names cannot, so it arrives as a capability the
 * application decides to grant rather than a dependency the component assumes.
 * A screen given none simply has no search box, and everything else still
 * works.
 *
 * `nominatimSearch` below is the implementation the back office grants, kept
 * here so that the one place this product asks a third party where somewhere is
 * is a single reviewable file rather than a URL typed into a screen.
 */

export interface FoundPlace {
  readonly id: string;
  readonly label: string;
  /** Decimal strings, the same shape the store keeps and the picker takes. */
  readonly lat: string;
  readonly lng: string;
}

export type PlaceSearch = (query: string, signal: AbortSignal) => Promise<readonly FoundPlace[]>;

/** At most this many. A shortlist somebody reads, not a page they scan. */
const MOST = 6;

/** What one search may take before it is abandoned as a line that is not there. */
const PATIENCE_MS = 8000;

interface NominatimRow {
  readonly place_id?: unknown;
  readonly display_name?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
}

function rowToPlace(row: NominatimRow, index: number): FoundPlace | null {
  // Every field is checked, because this is somebody else's JSON: a shape
  // assumed here is a screen that throws on the day they change it.
  const label = typeof row.display_name === 'string' ? row.display_name : null;
  const lat = typeof row.lat === 'string' ? row.lat : null;
  const lng = typeof row.lon === 'string' ? row.lon : null;
  if (label === null || lat === null || lng === null) return null;
  if (!isOnEarth(Number(lat), Number(lng))) return null;

  const id =
    typeof row.place_id === 'number' || typeof row.place_id === 'string'
      ? String(row.place_id)
      : `${lat},${lng},${String(index)}`;
  return { id, label, lat, lng };
}

export interface NominatimOptions {
  /** The interface language of the names that come back. */
  readonly locale: string;
}

/**
 * OpenStreetMap's own geocoder.
 *
 * **Biased to the edition's own region, by the geometry that shipped.** The
 * viewbox comes from `homeExtent()` rather than from a country code written
 * down twice: a shop searching for "المحطة" means the one in their own city,
 * and an edition sold somewhere else re-biases itself by regenerating its
 * atlas. Results outside it are still returned, only ranked below.
 *
 * Nothing about a tenant leaves except the words they typed — no coordinates,
 * no branch names, no identifiers. The answer is rendered as text by React,
 * which escapes it; nothing here interprets it as markup.
 */
/**
 * The service's own terms, kept here rather than trusted to the screen: at most
 * one request a second, and results cached by the caller. A repeated search is
 * answered from memory, and a new one waits its turn.
 */
const SPACING_MS = 1000;

export function nominatimSearch({ locale }: NominatimOptions): PlaceSearch {
  const answered = new Map<string, readonly FoundPlace[]>();
  let nextAllowed = 0;

  return async (query: string, signal: AbortSignal): Promise<readonly FoundPlace[]> => {
    const key = query.normalize('NFC').trim().toLowerCase();
    const cached = answered.get(key);
    if (cached !== undefined) return cached;

    // Spaced by the time the page has been open, which is a duration and not a
    // moment — no business fact rests on it, only the gap between two requests.
    const now = performance.now();
    const wait = Math.max(0, nextAllowed - now);
    nextAllowed = Math.max(now, nextAllowed) + SPACING_MS;
    if (wait > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(
            signal.reason instanceof Error ? signal.reason : new Error('The search was abandoned.'),
          );
        });
      });
    }

    const [southWest, northEast] = homeExtent();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(MOST));
    url.searchParams.set('accept-language', locale);
    url.searchParams.set(
      'viewbox',
      [southWest.lng, southWest.lat, northEast.lng, northEast.lat].join(','),
    );

    // Two reasons a search ends: the caller typed another letter, or the line is
    // not there. `AbortSignal.any` lets one handler serve both, so a component
    // that abandons a search does not also have to cancel its own timer.
    const patience = AbortSignal.timeout(PATIENCE_MS);
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, patience]),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`The geocoder answered ${String(response.status)}.`);

    const body: unknown = await response.json();
    const places = Array.isArray(body)
      ? body
          .map((row, index) => rowToPlace(row as NominatimRow, index))
          .filter((place): place is FoundPlace => place !== null)
      : [];
    answered.set(key, places);
    return places;
  };
}
