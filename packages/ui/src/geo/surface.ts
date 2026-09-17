import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  clamp,
  panBy,
  unproject,
  zoomAround,
  type LatLng,
  type MapView,
  type Pixel,
  type Viewport,
} from './projection.js';

/**
 * Dragging, wheeling and keying a map, in one place.
 *
 * Both the map and the picker are a surface you push around, and the awkward
 * parts — pointer capture, telling a click from the end of a drag, anchoring a
 * zoom on the pointer — are awkward in exactly the same way for both. Written
 * twice they would drift, and the drift would be one of them feeling wrong in a
 * way nobody could name.
 */

/** How far a pointer may travel and still have been a click rather than a drag. */
const CLICK_SLOP = 4;

/** How far an arrow key moves the map, in pixels. */
const KEY_PAN = 64;

/**
 * Used before the element is measured, and in a test runner that lays nothing
 * out. Any positive size will do — the view is refitted the moment a real
 * measurement arrives — and a map that rendered nothing until then would flash
 * empty on every load.
 */
const ASSUMED: Viewport = { width: 960, height: 520 };

export function useMeasured(of: RefObject<HTMLDivElement | null>): Viewport {
  const [viewport, setViewport] = useState<Viewport>(ASSUMED);

  useEffect(() => {
    const element = of.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box === undefined || box.width < 1 || box.height < 1) return;
      setViewport({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [of]);

  return viewport;
}

export interface GestureOptions {
  /** The element the wheel is listened for on — see `onWheel` below for why it is not a prop. */
  readonly surface: RefObject<HTMLDivElement | null>;
  readonly view: MapView | null;
  /** The deepest zoom the base layer has anything to show at. */
  readonly maxZoom?: number;
  readonly viewport: Viewport;
  readonly onChange: (view: MapView) => void;
  /** Called for a press that did not turn into a drag. Absent means clicks pan only. */
  readonly onPick?: (at: LatLng) => void;
  /** Called for `Home`, which is the map's own "put it back" key. */
  readonly onReset?: () => void;
}

/**
 * What is spread onto the surface, kept apart from what is called by hand.
 *
 * They were one object, and spreading it put `zoomBy` on a DOM element as an
 * attribute React warned about on every render of every map.
 */
export interface GestureHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface Gestures {
  readonly handlers: GestureHandlers;
  readonly zoomBy: (steps: number) => void;
}

/** How many pixels of wheel travel make one zoom level. */
const WHEEL_PER_LEVEL = 300;

function inside(event: {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
}): Pixel {
  const box = (event.currentTarget as Element).getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

export function useMapGestures({
  surface,
  view,
  maxZoom = MAX_ZOOM,
  viewport,
  onChange,
  onPick,
  onReset,
}: GestureOptions): Gestures {
  const drag = useRef<{ pointer: number; last: Pixel; from: Pixel; travelled: number } | null>(
    null,
  );

  const zoomBy = useCallback(
    (steps: number) => {
      if (view === null) return;
      const middle = { x: viewport.width / 2, y: viewport.height / 2 };
      onChange(zoomAround(view, middle, clamp(view.zoom + steps, MIN_ZOOM, maxZoom), viewport));
    },
    [view, viewport, onChange, maxZoom],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Captured, so a drag that leaves the element still ends on it. Without
    // this, releasing the button over the page beside the map leaves the map
    // stuck to the pointer.
    //
    // Treated as possibly absent because it is: a test runner's DOM does not
    // implement it, and losing capture only means a drag that leaves the
    // element ends early — which is not worth throwing a map away over.
    const element: Partial<Pick<Element, 'setPointerCapture'>> = event.currentTarget;
    element.setPointerCapture?.(event.pointerId);
    const at = inside(event);
    drag.current = { pointer: event.pointerId, last: at, from: at, travelled: 0 };
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const held = drag.current;
      if (held === null || view === null || held.pointer !== event.pointerId) return;

      const at = inside(event);
      const by = { x: at.x - held.last.x, y: at.y - held.last.y };
      held.travelled += Math.hypot(by.x, by.y);
      held.last = at;
      onChange(panBy(view, by, viewport));
    },
    [view, viewport, onChange],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const held = drag.current;
      if (held?.pointer !== event.pointerId) return;
      drag.current = null;

      // A press that went nowhere was a click. Measured as distance travelled
      // rather than start-to-end, so a drag out and back is still a drag and
      // does not drop a marker where somebody happened to let go.
      if (view !== null && onPick !== undefined && held.travelled <= CLICK_SLOP) {
        onPick(unproject(inside(event), view, viewport));
      }
    },
    [view, viewport, onPick],
  );

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  }, []);

  // The wheel is listened for natively, not through React. React attaches its
  // wheel handler as a passive listener, which may not cancel the scroll — so
  // the page scrolled away underneath a map that was zooming, and somebody
  // scrolling down the branches screen past the map zoomed it out on the way.
  // And the amount follows the wheel's own distance: a fixed half level per
  // event sent a trackpad, which fires many small events, three levels deep on
  // nine pixels of travel.
  const latest = useRef({ view, viewport, onChange, maxZoom });
  latest.current = { view, viewport, onChange, maxZoom };
  useEffect(() => {
    const element = surface.current;
    if (element === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      const { view: now, viewport: size, onChange: change, maxZoom: deepest } = latest.current;
      if (now === null) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      const levels = clamp((-event.deltaY * unit) / WHEEL_PER_LEVEL, -1, 1);
      // Anchored on the pointer. The alternative throws away the place somebody
      // is looking at on every notch, and the correction is a drag they never
      // meant to make.
      change(zoomAround(now, inside(event), clamp(now.zoom + levels, MIN_ZOOM, deepest), size));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [surface]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (view === null) return;
      // A chord is the browser's or the system's: Ctrl with + zooms the page,
      // and taking it for the map left somebody unable to enlarge the text.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Arrow keys move the map the way a hand would: pressing up shows what is
      // above, which means pushing the content down.
      const pan: Readonly<Record<string, Pixel>> = {
        ArrowUp: { x: 0, y: KEY_PAN },
        ArrowDown: { x: 0, y: -KEY_PAN },
        ArrowLeft: { x: KEY_PAN, y: 0 },
        ArrowRight: { x: -KEY_PAN, y: 0 },
      };

      const by = pan[event.key];
      if (by !== undefined) {
        event.preventDefault();
        onChange(panBy(view, by, viewport));
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(1);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomBy(-1);
      } else if (event.key === 'Home' && onReset !== undefined) {
        event.preventDefault();
        onReset();
      }
    },
    [view, viewport, onChange, onReset, zoomBy],
  );

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown },
    zoomBy,
  };
}
