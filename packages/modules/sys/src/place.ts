import { Dec, isDecimalString, ok, refuse, type Decimal, type Result } from '@vertex/kernel';

import type { GeoPoint, OrganisationRefusal } from './contract.js';

/**
 * The one seam that accepts a point on the Earth: `SYS-14`.
 *
 * Every command that stores a point comes through here, which is what makes the
 * stored form a thing this module can state rather than a thing each caller
 * happens to produce. A screen that lets somebody drag a marker, a field that
 * takes a pasted maps link and a sync applying a command from another device
 * all arrive at different strings for the same place; they leave here as one.
 *
 * It is a **refusal, not an exception**, because a coordinate outside the range
 * the Earth has is ordinary bad input — a typed digit too many — and reaches a
 * person as a sentence with the value they typed in it.
 */

/** Degrees north and south of the equator. */
const LATITUDE_LIMIT = 90;

/** Degrees east and west of the prime meridian. */
const LONGITUDE_LIMIT = 180;

/**
 * Six decimal places, which is about eleven centimetres.
 *
 * Far finer than anything a shop needs to say about where it is, and coarse
 * enough that the jitter in a phone's own reading of one spot does not arrive
 * as a stream of edits to a point nobody moved. Fixing it here rather than at
 * each caller is also what makes two points comparable as written: the same
 * doorstep saved twice is the same pair of strings.
 */
const PLACES = 6;

/**
 * Reads one axis, or says it is not one.
 *
 * `isDecimalString` first, so that `NaN`, `1e7`, an empty field and a pasted
 * word are all refused before anything tries to give them a value — the kernel
 * already owns what an exact decimal literal is, and a second opinion here
 * would eventually disagree with it.
 */
function axis(value: string, limit: number): Decimal | null {
  const trimmed = value.trim();
  if (!isDecimalString(trimmed)) return null;
  const degrees = new Dec(trimmed);
  return degrees.abs().greaterThan(limit) ? null : degrees;
}

/**
 * Decimal keeps a signed zero, and `-0.000000` is a different string from
 * `0.000000` to everything downstream that compares points as written.
 *
 * Rounded **first**, then tested. A value that is not zero can round to one —
 * a metre west of the prime meridian is `-0.0000001` — and testing the sign
 * before rounding lets exactly those through as the string this exists to
 * prevent.
 */
function written(degrees: Decimal): string {
  const rounded = degrees.toDecimalPlaces(PLACES);
  return (rounded.isZero() ? new Dec(0) : rounded).toFixed(PLACES);
}

/**
 * The stored form of a point, or a refusal naming what was offered.
 *
 * The refusal carries the values as they arrived rather than a cleaned-up
 * version of them: the person reading it is looking for their own typing
 * mistake, and a message that shows them something they did not write does not
 * help them find it.
 */
export function normalisePoint(point: GeoPoint): Result<GeoPoint, OrganisationRefusal> {
  // The type says strings, and a point arrives from a request body or a
  // replayed command where the type does not reach. `{ lat: 36.2 }` used to
  // throw on `.trim` instead of reaching a person as a refusal.
  const offered = point as { readonly lat: unknown; readonly lng: unknown };
  if (typeof offered.lat !== 'string' || typeof offered.lng !== 'string') {
    return refuse('sys.point-out-of-range', { lat: String(offered.lat), lng: String(offered.lng) });
  }
  const latitude = axis(offered.lat, LATITUDE_LIMIT);
  const longitude = axis(offered.lng, LONGITUDE_LIMIT);
  if (latitude === null || longitude === null) {
    return refuse('sys.point-out-of-range', { lat: offered.lat, lng: offered.lng });
  }
  // One meridian, one spelling. `-180` and `180` are the same line, and a
  // point just west of it rounds onto `-180.000000`; both are written east.
  const lng = written(longitude);
  return ok(
    Object.freeze({ lat: written(latitude), lng: lng === '-180.000000' ? '180.000000' : lng }),
  );
}

/**
 * An address as it is stored: trimmed, and nothing else.
 *
 * No shape is imposed and none is parsed. An address in one of the places this
 * product is sold is a landmark and a shopkeeper's name — "مقابل جامع الرحمن،
 * فوق صيدلية النور" — and a form that insisted on a street and a postcode would
 * be a form nobody could fill in truthfully. It is free text because that is
 * what the thing being written down actually is.
 */
export function writtenAddress(address: string): string {
  return address.trim();
}
