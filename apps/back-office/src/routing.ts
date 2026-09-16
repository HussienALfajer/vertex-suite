import { useCallback, useSyncExternalStore } from 'react';

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

export const ROUTES = [
  'companies',
  'business-profile',
  'branches',
  'locations',
  'registers',
  'numbering',
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
   * whether this identifier means anything is a question for the store node,
   * and a screen handed one that does not resolve says so rather than pretending
   * nothing was asked for.
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
export function routeOf(pathname: string, search: string): Route {
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

export function navigate(href: string): void {
  if (href === addressNow()) return;
  globalThis.history.pushState(null, '', href);
  globalThis.dispatchEvent(new Event(CHANGED));
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
  return routeOf(pathname, search === '' ? '' : `?${search}`);
}

/** Navigates to a route by name, for a control that is not a link. */
export function useNavigateTo(): (name: RouteName, subject?: string | null) => void {
  return useCallback((name: RouteName, subject?: string | null) => {
    navigate(hrefOf(name, subject));
  }, []);
}
