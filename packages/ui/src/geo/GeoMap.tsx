import { clsx } from 'clsx';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';

import { IconButton } from '../components/Button.js';
import { Popover } from '../components/Popover.js';
import { SearchInput } from '../components/SearchInput.js';
import { focusRing } from '../components/styles.js';
import { useTranslator } from '../providers/context.js';
import { BaseLayer, zoomCeilingOf, type Basemap } from './BaseLayer.js';
import { cluster } from './cluster.js';
import { matchesPlace } from './match.js';
import { fitToPoints, project, type LatLng, type MapView } from './projection.js';
import { useMapGestures, useMeasured } from './surface.js';

/**
 * The map of `SYS-14`: every place a tenant has marked, on one picture.
 *
 * **The land is SVG and the markers are HTML.** A marker is a button carrying a
 * name, a count and, in this product, Arabic — and inside an `<svg>` that is a
 * `<text>` node with no tokens, no translator, no popover and nothing a test
 * can find by role. Outside it, it is an ordinary button and everything the
 * design system already knows how to do applies to it for nothing.
 *
 * **Geography does not mirror.** The surface is an `ltr` island inside an `rtl`
 * document (§9): Syria is east of the Mediterranean in every locale, and a
 * container that flipped would put it west. The chrome around it stays logical
 * and lands on the start edge — which in Arabic is the opposite corner from an
 * English mock-up, correctly.
 *
 * It opens framed on the tenant's own places rather than on a fixed view of the
 * world. A world map with one marker over Syria is a decoration; the useful
 * question is "where are my branches", and the answer is an extent, not a
 * constant.
 */

export type PlaceKind = 'branch' | 'store';

export interface MapPlace {
  readonly id: string;
  readonly label: string;
  readonly kind: PlaceKind;
  /** Exact decimal strings, as the store holds them. Never a float on the way here. */
  readonly lat: string;
  readonly lng: string;
  readonly isActive: boolean;
  /** Searched alongside the label, because people look for a shop by its street. */
  readonly address?: string;
}

export interface GeoMapProps {
  /** Names the map for a screen reader. Required: it is a region of the page. */
  readonly label: string;
  readonly places: readonly MapPlace[];
  /** What the panel shows when a marker is opened. */
  readonly renderDetails: (place: MapPlace) => ReactNode;
  readonly basemap?: Basemap;
  readonly className?: string;
}

/** Markers closer together than this are drawn as one that says how many. */
const CLUSTER_RADIUS = 34;

/** Kept clear inside every edge when framing, so no marker is half off. */
const FIT_PADDING = 56;

/** One place implies no extent, so it opens at a street-ish zoom instead. */
const SINGLE_ZOOM = 14;

/** Where a chosen search result lands: close enough to read the street. */
const FOUND_ZOOM = 16;

/** More than this and a list stops being a shortlist and becomes a second table. */
const MOST_MATCHES = 6;

/**
 * `Number` and not `parseFloat`: the lint bans the latter everywhere, because a
 * business figure must never originate from a float. A coordinate is geometry
 * rather than a figure, and this is the one place it becomes a number at all —
 * on its way to a pixel, never on its way to storage.
 */
export function asLatLng(place: { readonly lat: string; readonly lng: string }): LatLng {
  return { lat: Number(place.lat), lng: Number(place.lng) };
}

export function GeoMap({
  label,
  places,
  renderDetails,
  basemap = { kind: 'outlines' },
  className,
}: GeoMapProps): ReactNode {
  const translator = useTranslator();
  const surface = useRef<HTMLDivElement>(null);
  const viewport = useMeasured(surface);

  const ceiling = zoomCeilingOf(basemap);
  const framed = useMemo(
    () =>
      fitToPoints(places.map(asLatLng), viewport, {
        padding: FIT_PADDING,
        singleZoom: Math.min(SINGLE_ZOOM, ceiling),
        maxZoom: ceiling,
      }),
    [places, viewport, ceiling],
  );

  /**
   * The map follows the data until somebody moves it, and then it is theirs.
   *
   * Refitting on every change would snatch the view back while a person is
   * looking at a corner of it; never refitting would leave the map on the wrong
   * country after a branch is placed. So this records that a human has taken
   * over, and the reset control gives it back.
   */
  const [moved, setMoved] = useState<MapView | null>(null);
  const view = moved ?? framed;

  const [openId, setOpenId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMoved(null);
  }, []);
  const gestures = useMapGestures({ view, viewport, onChange: setMoved, onReset: reset });

  /**
   * Finding a branch by name, without asking anybody.
   *
   * It searches the places already on the map rather than the world, which is
   * the search a person on this screen is actually doing: they know the shop
   * exists and want to see where it is. A geocoder would answer a different
   * question, need a line to answer it, and not know the tenant's own names.
   */
  const [query, setQuery] = useState('');
  const matches = useMemo(
    () =>
      query.trim() === ''
        ? []
        : places
            .filter((place) => matchesPlace(query, place.label, place.address))
            .slice(0, MOST_MATCHES),
    [places, query],
  );

  const goToPlace = useCallback(
    (place: MapPlace) => {
      setMoved({ centre: asLatLng(place), zoom: Math.min(FOUND_ZOOM, ceiling) });
      setOpenId(place.id);
      setQuery('');
    },
    [ceiling],
  );

  const clusters = useMemo(() => {
    if (view === null) return [];
    // Sorted by id rather than by data order: the markers are focus stops, and
    // a list that reordered itself between renders would move a keyboard's
    // place in it under the person using it.
    const placed = [...places]
      .sort((one, two) => one.id.localeCompare(two.id))
      .map((place) => ({ of: place, at: project(asLatLng(place), view, viewport) }));
    return cluster(placed, CLUSTER_RADIUS, (place) => place.id);
  }, [places, view, viewport]);

  return (
    <div className={clsx('relative isolate overflow-hidden', className)}>
      {/*
       * `ltr`, and only here. What is inside is the Earth, which does not flip
       * with a language; the controls below stay in the document's direction.
       */}
      <div
        ref={surface}
        dir="ltr"
        role="application"
        aria-label={label}
        tabIndex={0}
        className={clsx('bg-surface-1 relative h-full w-full cursor-grab touch-none', focusRing)}
        {...gestures}
      >
        {view === null ? null : <BaseLayer view={view} viewport={viewport} basemap={basemap} />}

        {clusters.map((one) => {
          const first = one.members[0];
          if (first === undefined) return null;
          const many = one.members.length > 1;

          return (
            <Popover
              key={one.key}
              label={first.label}
              isOpen={one.members.some((member) => member.id === openId)}
              onOpenChange={(isOpen) => {
                setOpenId(isOpen ? first.id : null);
              }}
              trigger={
                <AriaButton
                  aria-label={
                    many
                      ? translator.format('map.marker.many', { count: one.members.length })
                      : first.label
                  }
                  style={{
                    // Physical on purpose: a position on the Earth inside an
                    // `ltr` island, not a layout edge that mirrors with the
                    // document.
                    left: `${String(one.at.x)}px`,
                    top: `${String(one.at.y)}px`,
                  }}
                  className={clsx(
                    'absolute z-10 -translate-x-1/2 -translate-y-1/2',
                    'flex min-h-[1.75rem] min-w-[1.75rem] items-center justify-center',
                    'text-footnote font-body-semibold cursor-pointer px-[var(--vx-pad-xs)]',
                    'transition-transform duration-[var(--vx-dur-snap)] hover:scale-110',
                    'motion-reduce:transition-none',
                    focusRing,
                    // Shape carries the kind and the state, never colour alone
                    // (§4.8): a branch is round, a store room that sits
                    // somewhere else of its own is square, and a withdrawn
                    // place is hollow and dashed.
                    !many && first.kind === 'store' ? 'rounded' : 'rounded-pill',
                    // A cluster is active if anything inside it is: a group
                    // hides no active place, but one holding nothing but
                    // withdrawn places must still read as withdrawn.
                    one.members.some((member) => member.isActive)
                      ? 'bg-fill-accent text-on-accent'
                      : 'bg-surface-3 text-fg-muted border-line-strong border border-dashed',
                  )}
                >
                  {many ? translator.format('map.marker.count', { count: one.members.length }) : ''}
                </AriaButton>
              }
            >
              <ul className="flex flex-col gap-[var(--vx-gap-md)]">
                {one.members.map((member) => (
                  <li key={member.id}>{renderDetails(member)}</li>
                ))}
              </ul>
            </Popover>
          );
        })}
      </div>

      {places.length === 0 ? null : (
        <div className="absolute start-[var(--vx-pad-md)] bottom-[var(--vx-pad-md)] z-20 w-[16rem] max-w-[60%]">
          {matches.length === 0 ? null : (
            <ul
              // Named, because it is a second list of the same places as the
              // markers behind it and a reader who lands on it by keyboard has
              // to be told which one they are in.
              aria-label={translator.format('map.search.results')}
              className="bg-surface-3 border-line shadow-lg rounded-card mb-[var(--vx-gap-xs)] flex flex-col overflow-hidden border"
            >
              {matches.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => {
                      goToPlace(place);
                    }}
                    className={clsx(
                      'hover:bg-fill-ghost-hover flex w-full cursor-pointer flex-col items-start',
                      'px-[var(--vx-pad-md)] py-[var(--vx-pad-sm)] text-start',
                      focusRing,
                    )}
                  >
                    <span className="text-body font-body-medium text-fg">{place.label}</span>
                    {place.address === undefined || place.address === '' ? null : (
                      <span className="text-caption text-fg-secondary line-clamp-1">
                        {place.address}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SearchInput
            label={translator.format('map.search')}
            placeholder={translator.format('map.search')}
            value={query}
            onChange={setQuery}
            className="bg-surface-3 rounded-card shadow-md w-full"
          />
        </div>
      )}

      <div className="absolute end-[var(--vx-pad-md)] bottom-[var(--vx-pad-md)] z-20 flex flex-col gap-[var(--vx-gap-xs)]">
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
        <IconButton
          aria-label={translator.format('map.reset')}
          isDisabled={moved === null}
          onPress={reset}
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="fill-none stroke-current"
            strokeWidth="1.5"
          >
            <path
              d="M4 10a6 6 0 1 1 1.8 4.2M4 14v-4h4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>
      </div>

      {basemap.kind === 'tiles' ? (
        <p className="bg-surface-1/80 text-caption text-fg-muted absolute start-0 bottom-0 z-20 px-[var(--vx-pad-xs)]">
          {basemap.attribution}
        </p>
      ) : null}
    </div>
  );
}
