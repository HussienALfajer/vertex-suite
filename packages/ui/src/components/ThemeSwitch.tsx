import type { ReactNode } from 'react';

import { useTranslator, type ThemeChoice } from '../providers/context.js';
import { IconButton } from './Button.js';

/** What this control offers: `ThemeChoice` minus the "follow the device" state. */
export type TwoToneTheme = Exclude<ThemeChoice, 'system'>;

/**
 * The one control for §3.2's `data-theme` axis.
 *
 * It lives here rather than in an app because the axis does: §3.2 defines
 * `data-theme` for the whole interface layer, and the register and the
 * stocktaking app will want to switch it with the same two states, the same
 * cycle and the same words. Two copies of a control that knows nothing about
 * any module is two copies that drift.
 *
 * **Two states, not three.** `data-theme` still supports a third — an absent
 * attribute means "follow the device", and `VertexProvider` still implements
 * it for a caller that explicitly asks for `theme="system"` — but this control
 * no longer offers it and no longer starts there: every app decides light or
 * dark for itself at load, and this cycles between exactly those two. Adopted
 * at the tenant's explicit instruction, after the control shipped with a third
 * state and was found not to want it: a shop's device does not turn dark at
 * dusk the way a screen the owner also uses privately does, and a choice that
 * silently changes itself between two visits to the same till is a harder
 * thing to reason about than a choice that only ever changes when pressed.
 *
 * It cycles rather than offering a list. A `SegmentedControl` would show both
 * at once and is not in the Stage 0 inventory (§10) — it arrives with a
 * screen that needs one, and a corner control that a person presses once a day
 * is not that screen.
 *
 * **The choice lives in memory and is not written anywhere.** §3.2 has the axis
 * set from the tenant's setting, and `SYS` already owns settings per tenant and
 * per branch; writing a second copy into this browser would make two sources of
 * truth for one answer, and the one in the browser would be the one nobody can
 * see or change from the settings screen. It persists when that screen exists.
 */

const ORDER: readonly TwoToneTheme[] = ['light', 'dark'];

/**
 * `current` still accepts the full `ThemeChoice` — a caller mid-migration off
 * a stored `'system'` should not crash on it — but the result is always one
 * of the two this control now offers.
 */
export function nextTheme(current: ThemeChoice): TwoToneTheme {
  const at = ORDER.indexOf(current as TwoToneTheme);
  return ORDER[(at + 1) % ORDER.length] ?? 'light';
}

export interface ThemeSwitchProps {
  readonly theme: TwoToneTheme;
  readonly onChange: (next: TwoToneTheme) => void;
}

export function ThemeSwitch({ theme, onChange }: ThemeSwitchProps): ReactNode {
  const translator = useTranslator();

  return (
    <IconButton
      aria-label={translator.format('theme.switch', {
        current: translator.format(`theme.${theme}`),
      })}
      onPress={() => {
        onChange(nextTheme(theme));
      }}
    >
      <ThemeIcon theme={theme} />
    </IconButton>
  );
}

/**
 * A shape per state, not a shade.
 *
 * The same rule the banner icons follow (§4.7): a control whose meaning is
 * carried by colour alone is a control that means nothing to a colour-blind
 * cashier, and this one is read at a glance rather than by its label.
 */
function ThemeIcon({ theme }: { theme: TwoToneTheme }): ReactNode {
  const shared = 'fill-none stroke-current';
  switch (theme) {
    case 'light':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <circle cx="10" cy="10" r="3.75" />
          <path
            d="M10 2v1.5M10 16.5V18M18 10h-1.5M3.5 10H2M15.66 4.34l-1.06 1.06M5.4 14.6l-1.06 1.06M15.66 15.66l-1.06-1.06M5.4 5.4L4.34 4.34"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'dark':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <path d="M16.5 11.8A7 7 0 0 1 8.2 3.5a7 7 0 1 0 8.3 8.3z" strokeLinejoin="round" />
        </svg>
      );
  }
}
