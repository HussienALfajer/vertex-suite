import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Dec } from '@vertex/kernel';

import { Banner } from '../components/Banner.js';
import { Button, IconButton } from '../components/Button.js';
import { SearchInput } from '../components/SearchInput.js';
import { TextInput } from '../components/TextInput.js';
import { focusRing } from '../components/styles.js';
import { useTranslator } from '../providers/context.js';
import type { FoundPlace, PlaceSearch } from './geocode.js';
import { BaseLayer, OUTLINE_MAX_ZOOM, zoomCeilingOf, type Basemap } from './BaseLayer.js';
import { asLatLng, mapControls } from './GeoMap.js';
import { homeCentre, homeExtent } from './atlas.js';
import { parsePlace } from './parse.js';
import { fitToPoints, project, type LatLng, type MapView } from './projection.js';
import { useMapGestures, useMeasured } from './surface.js';

/**
 * Putting a place on the map, for `SYS-14`.
 *
 * Three ways in, because three different people use this. Somebody at the shop
 * **clicks** where it is. Somebody who already has it open on their phone
 * **pastes the link** — which is how a place is actually shared here, and the
 * fastest of the three. And somebody sitting in the shop asks the browser
 * **where they are**, which is the quickest of all when it works and is honest
 * about when it does not.
 *
 * Nothing here resolves an address into a point or a point into an address. Both
 * directions are a query to an outside service about where a tenant's shops
 * are, and both stop working in a shop with no line — which is the shop this
 * product is for.
 */

export interface PickedPoint {
  readonly lat: string;
  readonly lng: string;
}

export interface PointPickerProps {
  /** Names the map surface for a screen reader. */
  readonly label: string;
  readonly value: PickedPoint | null;
  readonly onChange: (point: PickedPoint | null) => void;
  /** Other places already marked, drawn faintly so a new one can be put beside them. */
  readonly around?: readonly PickedPoint[];
  readonly basemap?: Basemap;
  /**
   * Finding a place by name. Absent means no search box — everything else still
   * works, which is the point: this is the one part of `SYS-14` that needs a
   * line, so it is a capability granted rather than a dependency assumed.
   */
  readonly search?: PlaceSearch;
  readonly className?: string;
}

/**
 * Where the view opens when there is a point already, or one is dropped —
 * **as far in as the base layer can still say something**.
 *
 * Country outlines run out at `OUTLINE_MAX_ZOOM`: past it the nearest border is
 * off the screen and the map is a flat field with a marker floating on it,
 * which looks broken and tells a person nothing about where they have just put
 * their shop. With a tile source configured there is detail all the way down,
 * and the picker goes there.
 */
const CLOSE_ZOOM = 13;

/** Six decimal places, the same as the store keeps (`sys/place.ts`). */
const PLACES = 6;

/** Long enough for a search to mean something. Two letters match half a country. */
const SHORTEST_SEARCH = 3;

/**
 * What the browser said when asked where the device is.
 *
 * Named rather than collapsed into "it failed", because the three that can
 * happen here call for three different sentences, and one of them is a fact
 * about how this system is deployed rather than about this person:
 * `navigator.geolocation` is **disabled outside a secure context**, so a back
 * office served over plain HTTP on the shop network cannot use it at all. That
 * is a message for whoever installed the store node, not a shrug at the user.
 */
type Asking = 'idle' | 'asking' | 'insecure' | 'unsupported' | 'refused' | 'unavailable';

/**
 * The same six-decimal-place rule `sys/place.ts` stores by, and the same
 * `Decimal` it rounds with — a click or a drag produces a float, and a native
 * `toFixed` on it can round the sixth place differently than the store's
 * correctly-rounded decimal does, which is the one gap `place.ts`'s own
 * comment says two "written" seams must not have between them.
 */
function written(degrees: number): string {
  return new Dec(degrees).toDecimalPlaces(PLACES).toFixed(PLACES);
}

function pointAt(at: LatLng): PickedPoint {
  return { lat: written(at.lat), lng: written(at.lng) };
}

export function PointPicker({
  label,
  value,
  onChange,
  around = [],
  basemap = { kind: 'outlines' },
  search,
  className,
}: PointPickerProps): ReactNode {
  const translator = useTranslator();
  const surface = useRef<HTMLDivElement>(null);
  const viewport = useMeasured(surface);
  const closeZoom = Math.min(CLOSE_ZOOM, zoomCeilingOf(basemap));

  /**
   * Where the map opens, in the order the answers are worth having.
   *
   * The point it already has, then the middle of the places the tenant has
   * already marked — a new branch is usually near the others — and only then
   * the country. The device's own position is the fourth, and it is a button
   * rather than a step here: an automatic permission prompt on a screen nobody
   * asked it of is the fastest route to a permanent refusal.
   */
  const opening = useMemo((): MapView => {
    if (value !== null) return { centre: asLatLng(value), zoom: closeZoom };
    const first = around[0];
    if (first !== undefined) return { centre: asLatLng(first), zoom: closeZoom - 3 };
    // Fitted to the country rather than given a zoom: a number chosen to frame
    // one country frames the next edition's badly, and the geometry that
    // shipped already knows where its own corners are.
    return (
      fitToPoints([...homeExtent()], viewport, {
        padding: 12,
        singleZoom: 6,
        maxZoom: OUTLINE_MAX_ZOOM,
      }) ?? { centre: homeCentre(), zoom: 6 }
    );
  }, [value, around, viewport, closeZoom]);

  const [moved, setMoved] = useState<MapView | null>(null);
  const view = moved ?? opening;

  const [pasted, setPasted] = useState('');
  const [pasteFailed, setPasteFailed] = useState<'none' | 'shortened' | null>(null);
  const [asking, setAsking] = useState<Asking>('idle');

  const pick = useCallback(
    (at: LatLng) => {
      onChange(pointAt(at));
    },
    [onChange],
  );

  const gestures = useMapGestures({
    surface,
    view,
    maxZoom: zoomCeilingOf(basemap),
    viewport,
    onChange: setMoved,
    onPick: pick,
  });

  /**
   * Searching for a place by name — **when asked, not as somebody types**.
   *
   * It once searched on every pause in typing. The service behind it forbids
   * exactly that: no autocomplete from a client, no more than one request a
   * second, and results cached by the caller. A shop typing an address with
   * ordinary pauses sent several requests in a few seconds from its own address,
   * and every installation of the product did the same — which is how a service
   * blocks an address, after which search fails for the shop with the line up.
   * So a search is sent on Enter, and the one in flight is abandoned if another
   * is asked for.
   */
  const [looking, setLooking] = useState('');
  const [found, setFound] = useState<readonly FoundPlace[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'empty' | 'failed'>('idle');
  const inFlight = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  function searchFor(text: string): void {
    const wanted = text.trim();
    if (search === undefined || wanted.length < SHORTEST_SEARCH) return;
    inFlight.current?.abort();
    const abandon = new AbortController();
    inFlight.current = abandon;
    setSearchState('searching');
    void search(wanted, abandon.signal)
      .then((places) => {
        if (abandon.signal.aborted) return;
        setFound(places);
        setSearchState(places.length === 0 ? 'empty' : 'idle');
      })
      .catch(() => {
        // Every failure is one sentence, on purpose. A person who typed a
        // place name does not need to know whether the line is down, the
        // service is busy or the answer was malformed — only that typing is
        // not the way in today, and that the map below still is.
        if (abandon.signal.aborted) return;
        setFound([]);
        setSearchState('failed');
      });
  }

  function takeFound(place: FoundPlace): void {
    // Through the same six places a click is written with. The geocoder's own
    // strings carried seven, and were stored as they came.
    const at = { lat: Number(place.lat), lng: Number(place.lng) };
    onChange(pointAt(at));
    setMoved({ centre: at, zoom: closeZoom });
    setLooking('');
    setFound([]);
    setSearchState('idle');
  }

  // Following the value rather than owning it: a point set by pasting a link
  // has to bring the map with it, or the marker lands off-screen and the person
  // who just pasted it is looking at an empty map.
  useEffect(() => {
    if (value === null) return;
    setMoved((current) => {
      if (current === null) return null;
      const at = project(asLatLng(value), current, viewport);
      const visible = at.x >= 0 && at.y >= 0 && at.x <= viewport.width && at.y <= viewport.height;
      return visible ? current : { centre: asLatLng(value), zoom: current.zoom };
    });
  }, [value, viewport]);

  function takePasted(text: string): void {
    setPasted(text);
    if (text.trim() === '') {
      setPasteFailed(null);
      return;
    }
    const read = parsePlace(text);
    if (read.kind === 'point') {
      setPasteFailed(null);
      onChange({ lat: read.lat, lng: read.lng });
      setMoved({ centre: asLatLng(read), zoom: closeZoom });
      return;
    }
    setPasteFailed(read.kind);
  }

  function askTheDevice(): void {
    // Checked before asking, so the message names the real obstacle. A browser
    // outside a secure context refuses this silently, and "nothing happened" is
    // the least useful thing a screen can say.
    //
    // `=== false` and not a falsy test: an environment that does not define
    // the flag at all has not told us the connection is insecure, and blaming
    // the deployment for something it may not have done would send whoever
    // reads it to fix the wrong thing.
    const secure: boolean | undefined =
      typeof window === 'undefined' ? undefined : window.isSecureContext;
    if (secure === false) {
      setAsking('insecure');
      return;
    }

    // Widened deliberately. The DOM types say a browser always has this; the
    // browsers this runs on include ones that do not, and a screen that threw
    // rather than saying so would be a worse answer than the message.
    const device: Geolocation | undefined =
      typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (device === undefined) {
      setAsking('unsupported');
      return;
    }

    setAsking('asking');
    device.getCurrentPosition(
      (position) => {
        setAsking('idle');
        const at = { lat: position.coords.latitude, lng: position.coords.longitude };
        onChange(pointAt(at));
        setMoved({ centre: at, zoom: closeZoom });
      },
      (failure) => {
        setAsking(failure.code === failure.PERMISSION_DENIED ? 'refused' : 'unavailable');
      },
      // No high accuracy and a short patience: a machine with no satellite
      // fix falls back to asking a server over the internet, and in a shop with
      // no line that is a spinner that never ends.
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  const marker = value === null ? null : project(asLatLng(value), view, viewport);

  return (
    <div className={clsx('flex flex-col gap-[var(--vx-gap-md)]', className)}>
      {search === undefined ? null : (
        <div className="flex flex-col gap-[var(--vx-gap-xs)]">
          <SearchInput
            label={translator.format('picker.search')}
            isLabelVisible
            placeholder={translator.format('picker.search.placeholder')}
            value={looking}
            onChange={(next) => {
              setLooking(next);
              if (next.trim() === '') {
                setFound([]);
                setSearchState('idle');
              }
            }}
            onSubmit={searchFor}
          />
          {found.length === 0 ? null : (
            <ul className="border-line rounded-card flex max-h-[11rem] flex-col overflow-auto border">
              {found.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => {
                      takeFound(place);
                    }}
                    className={clsx(
                      'hover:bg-fill-ghost-hover w-full cursor-pointer text-start',
                      'text-body text-fg px-[var(--vx-pad-md)] py-[var(--vx-pad-sm)]',
                      focusRing,
                    )}
                  >
                    {place.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchState === 'idle' ? null : (
            <p className="text-footnote text-fg-secondary" role="status">
              {translator.format(`picker.search.${searchState}`)}
            </p>
          )}
        </div>
      )}

      {/* `overflow-clip`, for the reason `GeoMap` gives. */}
      <div className="border-line rounded-card relative isolate h-[20rem] overflow-clip border">
        <div
          ref={surface}
          dir="ltr"
          role="application"
          aria-label={label}
          tabIndex={0}
          className={clsx(
            'bg-surface-1 relative h-full w-full cursor-crosshair touch-none',
            focusRing,
          )}
          {...gestures.handlers}
        >
          <BaseLayer view={view} viewport={viewport} basemap={basemap} />

          {around.map((other) => {
            const at = project(asLatLng(other), view, viewport);
            return (
              <span
                key={`${other.lat},${other.lng}`}
                aria-hidden="true"
                style={{ left: `${String(at.x)}px`, top: `${String(at.y)}px` }}
                className="bg-fg-muted/40 absolute z-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-pill"
              />
            );
          })}

          {/*
           * The middle of the map is the proposal, and "place here" takes it.
           * The crosshair is the mobile idiom for a reason: on a touch screen
           * the finger is over whatever it is pointing at, and a marker dragged
           * under a fingertip is a marker placed blind. It stays once a point
           * exists — it once went, and somebody moving an existing point from
           * the keyboard was pressing "place here" on a centre they could not see.
           */}
          {
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
            >
              <svg viewBox="0 0 40 40" className="text-fg-muted h-10 w-10 fill-none stroke-current">
                <path
                  d="M20 4v10M20 26v10M4 20h10M26 20h10"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx="20" cy="20" r="3" strokeWidth="1.5" />
              </svg>
            </span>
          }
          {marker === null ? null : (
            <span
              aria-hidden="true"
              style={{ left: `${String(marker.x)}px`, top: `${String(marker.y)}px` }}
              className="bg-fill-accent absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-pill ring-2 ring-[var(--vx-surface-1)]"
            />
          )}
        </div>

        <div className={clsx(mapControls, 'end-[var(--vx-pad-sm)] bottom-[var(--vx-pad-sm)]')}>
          <IconButton
            aria-label={translator.format('map.zoomIn')}
            onPress={() => {
              gestures.zoomBy(1);
            }}
          >
            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              className="fill-none stroke-current"
              strokeWidth="1.5"
            >
              <path d="M10 5v10M5 10h10" strokeLinecap="round" />
            </svg>
          </IconButton>
          <IconButton
            aria-label={translator.format('map.zoomOut')}
            onPress={() => {
              gestures.zoomBy(-1);
            }}
          >
            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              className="fill-none stroke-current"
              strokeWidth="1.5"
            >
              <path d="M5 10h10" strokeLinecap="round" />
            </svg>
          </IconButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[var(--vx-gap-sm)]">
        <Button
          onPress={() => {
            pick(view.centre);
          }}
        >
          {translator.format('picker.placeHere')}
        </Button>
        <Button isDisabled={asking === 'asking'} onPress={askTheDevice}>
          {translator.format(asking === 'asking' ? 'picker.locating' : 'picker.useMyLocation')}
        </Button>
        {value === null ? null : (
          <Button
            tone="ghost"
            onPress={() => {
              onChange(null);
            }}
          >
            {translator.format('picker.clear')}
          </Button>
        )}
        {value === null ? null : (
          <output className="text-footnote text-fg-secondary font-mono tabular-nums">
            {`${value.lat}, ${value.lng}`}
          </output>
        )}
      </div>

      <TextInput
        label={translator.format('picker.paste')}
        description={translator.format('picker.paste.description')}
        value={pasted}
        onChange={takePasted}
        {...(pasteFailed === null
          ? {}
          : {
              errorMessage: translator.format(
                pasteFailed === 'shortened' ? 'picker.paste.shortened' : 'picker.paste.unreadable',
              ),
            })}
      />

      {asking === 'idle' || asking === 'asking' ? null : (
        <Banner tone={asking === 'insecure' ? 'warning' : 'info'}>
          {translator.format(`picker.device.${asking}`)}
        </Banner>
      )}
    </div>
  );
}
