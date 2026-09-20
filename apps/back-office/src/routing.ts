import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Where the back office is, and how it gets somewhere else.
 *
 * **A router, and not a routing library.** `Shell` deferred this until there
 * was a second destination, and the second, third and fourth arrived together.
 * What they need is the browser's own history and a way to read it — and the
 * three things a routing library is worth having for (nested layouts, data
 * loading tied to a match, code splitting per route) are three things this
 * application does not do: the frame is one component, the screens read through
 * one port, and the whole bundle is served from a machine in the shop with no
 * network between it and the browser. A dependency pinned for a decade
 * (`README.md`) should buy more than `useSyncExternalStore` and a switch.
 *
 * It is the **path** rather than a hash, because a path is what a person copies
 * out of the address bar and sends to somebody else, and what a bookmark keeps.
 *
 * `App` hands `navigate` to `VertexProvider`, which is what makes every link in
 * the design system a client-side one. Without that, a `SideNav` entry is an
 * ordinary anchor and reloads the document — which on this product discards the
 * session, because `session.tsx` deliberately holds it in memory and nowhere a
 * revocation could not reach.
 */

const ROUTES = [
  'companies',
  'business-profile',
  'branches',
  'locations',
  'registers',
  'numbering',
  'users',
  'roles',
  'currencies',
  'rates',
  'chart',
  'fiscal-calendar',
  'journal',
  'manual-entry',
  'opening-balances',
  'posting-exceptions',
  'statements',
] as const;

export type RouteName = (typeof ROUTES)[number];

/** The first screen anybody lands on, and the one an unknown path resolves to. */
export const HOME: RouteName = 'companies';

export interface Route {
  readonly name: RouteName;
  /**
   * The record the screen is looking at — the company whose profile, the branch
   * whose locations.
   *
   * In the address rather than in a component's state, so that a row action on
   * one screen can open another already pointed at the right record, and so
   * that the address bar names what is on screen. Unvalidated here on purpose:
   * whether this identifier means anything is a question for the store node.
   * A screen handed one that does not resolve falls back to the first record it
   * has and replaces the address with that one, so the address never names a
   * record that is not on screen.
   */
  readonly subject: string | null;
}

const SUBJECT = 'id';

export function hrefOf(name: RouteName, subject?: string | null): string {
  const path = `/${name}`;
  return subject === undefined || subject === null
    ? path
    : `${path}?${SUBJECT}=${encodeURIComponent(subject)}`;
}

/** Reads a route out of a location, falling back rather than refusing. */
function routeOf(pathname: string, search: string): Route {
  const first = pathname.split('/').find((part) => part !== '');
  const name = ROUTES.find((one) => one === first) ?? HOME;
  return { name, subject: new URLSearchParams(search).get(SUBJECT) };
}

/**
 * The browser's history, as a store.
 *
 * `popstate` is the browser's own back and forward; `pushState` does not fire
 * it, so anything that navigates has to say so. One event name for both keeps
 * every subscriber on one path rather than two.
 */
const CHANGED = 'vertex:navigated';

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener('popstate', onChange);
  globalThis.addEventListener(CHANGED, onChange);
  return () => {
    globalThis.removeEventListener('popstate', onChange);
    globalThis.removeEventListener(CHANGED, onChange);
  };
}

/**
 * The current address as one string.
 *
 * `useSyncExternalStore` compares snapshots by identity, so this returns the
 * address itself rather than a parsed object — two identical objects would be
 * two different snapshots and would re-render the whole application on every
 * unrelated event.
 */
function addressNow(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}`;
}

/**
 * Whether the screen on show may be left, asked before `navigate` moves the
 * address — a promise, because the answer is a person's.
 *
 * One at a time, because this application shows one screen at a time. It
 * holds up `navigate()`, the address changing to a **different screen**, and
 * not `redirect()`, which a screen calls on itself — to land on a record, to
 * follow a filter it just changed. Asking "leave?" about a screen correcting
 * its own view of itself would be asking the wrong question.
 */
type NavigationGuard = () => Promise<boolean>;

let guard: NavigationGuard | null = null;

/**
 * Registers a screen's guard, and returns what takes it away again — only if
 * it is still the one registered, so a screen leaving can never clear the
 * guard of the screen that replaced it.
 */
function registerNavigationGuard(next: NavigationGuard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

async function navigateAfterGuard(href: string): Promise<void> {
  if (href === addressNow()) return;
  if (guard !== null && !(await guard())) return;
  globalThis.history.pushState(null, '', href);
  globalThis.dispatchEvent(new Event(CHANGED));
}

/**
 * Synchronous on purpose, though what it wraps is not: `VertexProvider`
 * hands this to React Aria as the router's `navigate`, typed
 * `(href: string) => void`, and every `SideNav` link calls it that way. The
 * guard still runs and the address still waits for it; the wait just does not
 * leak into a contract every caller already treats as fire-and-forget.
 */
export function navigate(href: string): void {
  void navigateAfterGuard(href);
}

/** Replaces the address without adding a step to the history stack. */
export function redirect(href: string): void {
  if (href === addressNow()) return;
  globalThis.history.replaceState(null, '', href);
  globalThis.dispatchEvent(new Event(CHANGED));
}

export function useRoute(): Route {
  const address = useSyncExternalStore(subscribe, addressNow, () => hrefOf(HOME));
  const [pathname = '', search = ''] = address.split('?');
  const route = routeOf(pathname, search === '' ? '' : `?${search}`);

  // A path that names no screen falls back to the home screen, and the address
  // follows it. It once stayed as typed while the companies screen was shown,
  // so the address bar named a screen that does not exist.
  const first = pathname.split('/').find((part) => part !== '');
  const known = ROUTES.some((one) => one === first);
  useEffect(() => {
    if (!known) redirect(hrefOf(HOME));
  }, [known]);

  return route;
}

/** Navigates to a route by name, for a control that is not a link. */
export function useNavigateTo(): (name: RouteName, subject?: string | null) => void {
  return useCallback((name: RouteName, subject?: string | null) => {
    navigate(hrefOf(name, subject));
  }, []);
}

export interface UnsavedChangesGuard {
  /** Whether the confirmation is on screen. What a caller renders its dialog from. */
  readonly isOpen: boolean;
  /** Whether the caller's own save is in flight — the moment nothing here may be pressed twice. */
  readonly isSaving: boolean;
  /** Stay. The navigation that asked is left exactly where it was, going nowhere. */
  readonly cancel: () => void;
  /** Leave, and let whatever is unsaved be lost. */
  readonly discard: () => void;
  /** Save, then leave — unless the save was refused, in which case neither happens. */
  readonly save: () => void;
}

/**
 * A screen holding an edit nobody saved is not left without being asked —
 * `SYS-05`'s confirmation before a discard, carried to the navigation that
 * would discard it.
 *
 * **A screen's whole part in this is one boolean and one function**: whether
 * it is dirty, and how to save what it holds. Registering with `navigate()`,
 * holding the question open, running the save and only then letting the
 * waiting navigation continue is the same for every screen, so it is here.
 *
 * `onSave` reports whether the save went through, rather than this hook
 * inferring it from `isDirty` turning false: by the time the save resolves the
 * screen may not have re-rendered yet, and a refusal is the screen's to
 * explain — this only needs to know whether it may now do what was waiting.
 *
 * **What it covers, and what it cannot.** Every in-app link, and closing or
 * reloading the tab, which a browser answers with its own prompt. Not the
 * browser's own Back and Forward: history cannot be vetoed, only rewritten
 * after the fact, and a guard that pushed entries back to undo a Back would
 * leave the history stack saying something that never happened.
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  onSave: () => Promise<boolean>,
): UnsavedChangesGuard {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const pending = useRef<((mayLeave: boolean) => void) | null>(null);

  // Read inside the guard rather than captured by it: the guard below is
  // registered once per `isDirty` flip, not once per render, so a closure
  // over `onSave` from that render would call back into a screen's state as
  // it stood when typing last changed `isDirty` — its last dirty draft, not
  // its current one.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!isDirty) return undefined;

    const unregister = registerNavigationGuard(
      () =>
        new Promise<boolean>((resolvePendingNavigation) => {
          // A second link pressed while the question is still open replaces
          // the first navigation rather than queueing behind it: the earlier
          // one is answered "stay", and only the latest is asked about.
          pending.current?.(false);
          pending.current = resolvePendingNavigation;
          setIsOpen(true);
        }),
    );

    // `beforeunload` cannot be asked a question — a browser shows its own
    // wording and waits for nothing this application returns — so it gets the
    // one answer that is always safe. `preventDefault` is the standard way to
    // ask for the browser's prompt; `returnValue` is its deprecated spelling.
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    globalThis.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      unregister();
      globalThis.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [isDirty]);

  function settle(mayLeave: boolean): void {
    setIsOpen(false);
    pending.current?.(mayLeave);
    pending.current = null;
  }

  return {
    isOpen,
    isSaving,
    cancel: () => {
      settle(false);
    },
    discard: () => {
      settle(true);
    },
    save: () => {
      setIsSaving(true);
      void onSaveRef
        .current()
        .catch(() => false)
        .then((succeeded) => {
          setIsSaving(false);
          settle(succeeded);
        });
    },
  };
}
