/**
 * Class fragments shared by the components.
 *
 * The character these encode is the one §2 asks for and the one a person
 * staring at this software for eight hours needs: **a warm neutral ground, one
 * accent reserved for action and focus, hierarchy carried by space and type
 * rather than by rules and boxes.** Chrome is what you notice on the first day
 * and resent on the hundredth.
 *
 * Nothing here names a primitive. Every class resolves to a semantic token, so
 * a tenant's theme and a future palette change reach all of it at once (§3.1).
 */

/**
 * Focus is always visible, and drawn only for the keyboard.
 *
 * Two layers — the page colour, then the accent — so the ring reads against a
 * page and against a coloured fill without a per-context variant (§7.3). The
 * register is operated with no pointing device at all, which makes this the
 * most load-bearing style in the system.
 */
export const focusRing =
  'outline-none data-[focus-visible]:shadow-[var(--vx-focus-ring)] ' +
  'data-[focus-visible]:relative data-[focus-visible]:z-10';

export const focusRingDanger =
  'outline-none data-[focus-visible]:shadow-[var(--vx-focus-ring-danger)] ' +
  'data-[focus-visible]:relative data-[focus-visible]:z-10';

/** Every control is the density's control height, and transitions at snap speed. */
export const controlBase =
  'inline-flex items-center justify-center whitespace-nowrap select-none ' +
  'h-[var(--vx-h-control)] rounded text-body font-body-medium ' +
  'transition-[background-color,box-shadow,color] duration-[var(--vx-dur-snap)] ease-out ' +
  'disabled:cursor-not-allowed disabled:text-fg-disabled';

/** Horizontal padding that keeps its proportion as the density changes. */
export const controlPadding = 'px-[var(--vx-pad-lg)]';

export type Tone = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * The tones.
 *
 * `primary` is **neutral**, not blue. §4.4 names `fill-primary` the neutral
 * primary button on purpose: if the accent were spent on every confirm button
 * it would stop meaning "this is where the interaction is", and focus — which
 * is the thing a keyboard-only cashier tracks — would have to compete with it.
 */
export const tones: Readonly<Record<Tone, string>> = {
  primary:
    'bg-fill-primary text-on-primary hover:opacity-90 disabled:bg-fill-secondary disabled:opacity-100',
  secondary:
    'bg-fill-secondary text-fg border border-line-strong hover:bg-fill-ghost-hover ' +
    'disabled:bg-fill-secondary',
  ghost: 'bg-transparent text-fg hover:bg-fill-ghost-hover',
  danger: 'bg-fill-danger text-on-danger hover:bg-fill-danger-hover disabled:bg-fill-secondary',
};
