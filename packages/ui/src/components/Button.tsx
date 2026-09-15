import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';

import {
  controlBase,
  controlPadding,
  focusRing,
  focusRingDanger,
  tones,
  type Tone,
} from './styles.js';
import { WithTooltip } from './Tooltip.js';

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'children'> {
  readonly tone?: Tone;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The action.
 *
 * Built on React Aria's button rather than a bare `<button>` so that press
 * behaviour, disabled semantics and focus-visible detection are the library's
 * problem and not re-solved per component — the register is operated entirely
 * from the keyboard, and "mostly correct" focus handling is a defect there.
 */
export function Button({
  tone = 'secondary',
  className,
  children,
  ...props
}: ButtonProps): ReactNode {
  return (
    <AriaButton
      {...props}
      className={clsx(
        controlBase,
        controlPadding,
        tones[tone],
        tone === 'danger' ? focusRingDanger : focusRing,
        className,
      )}
    >
      {children}
    </AriaButton>
  );
}

export interface IconButtonProps extends Omit<AriaButtonProps, 'className' | 'children'> {
  readonly tone?: Tone;
  /** Required. An icon-only control with no name is invisible to a screen reader. */
  readonly 'aria-label': string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A square control carrying only an icon.
 *
 * It is square at the control height, which means it clears the 48px floor on a
 * touch surface for free (§6.3) rather than needing a special case there.
 *
 * It names itself on hover and on focus, from the `aria-label` every instance
 * already has to carry for a screen reader — one label serving both audiences
 * rather than a tooltip string each call site would otherwise have to repeat
 * and could let drift from the accessible name.
 */
export function IconButton({
  tone = 'ghost',
  className,
  children,
  ...props
}: IconButtonProps): ReactNode {
  return (
    <WithTooltip content={props['aria-label']}>
      <AriaButton
        {...props}
        className={clsx(
          controlBase,
          // `shrink-0` because this control is square by definition. In a flex
          // row that is narrower than its contents — a table's actions column,
          // sized to fit — the default `shrink` quietly turns the square into a
          // rectangle, and the hover fill with it, so the same button is a
          // different shape depending on what is beside it.
          'w-[var(--vx-h-control)] shrink-0 p-0 [&_svg]:size-[var(--vx-icon)]',
          tones[tone],
          tone === 'danger' ? focusRingDanger : focusRing,
          className,
        )}
      >
        {children}
      </AriaButton>
    </WithTooltip>
  );
}
