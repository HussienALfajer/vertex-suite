import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
} from 'react-aria-components';

export interface WithTooltipProps {
  readonly content: string;
  readonly children: ReactNode;
}

/**
 * A name for a control that otherwise carries only an icon.
 *
 * `IconButton` wraps every instance of itself in this, using its own required
 * `aria-label` as the text (`Button.tsx`) — so a row of actions that already
 * has to name itself for a screen reader gets the sighted version of the same
 * name for free, rather than as a second thing each screen remembers to add.
 *
 * It shows on focus as well as on hover, which is what makes it correct on a
 * keyboard rather than a courtesy for a mouse: §11 does not get a pointer-only
 * exception, and a control's name should not depend on how it is reached.
 * Nothing here does anything on `touch` — there is no hover to trigger it, and
 * §6.3 already puts the label in the surrounding text on that density rather
 * than behind a gesture nobody can perform by accident.
 */
export function WithTooltip({ content, children }: WithTooltipProps): ReactNode {
  // No delay, in either direction. React Aria's default is tuned for a tooltip
  // that repeats a label already written beside the control; here it *is* the
  // label, because the icon carries no words — so a delay is just the control's
  // name arriving late.
  return (
    <AriaTooltipTrigger delay={0} closeDelay={0}>
      {children}
      <AriaTooltip
        offset={6}
        className={clsx(
          'bg-fill-primary text-on-primary rounded shadow-md',
          'px-[var(--vx-pad-sm)] py-[var(--vx-pad-xs)]',
          'text-footnote font-medium',
          // §8, over `dur-base` — see `Dialog` for why these are the classes.
          'transition-opacity duration-[var(--vx-dur-base)] ease-out starting:opacity-0',
          'data-[exiting]:opacity-0 data-[exiting]:ease-in',
        )}
      >
        {/* Drawn pointing down, for an overlay above its trigger. React Aria flips
            the overlay away from the viewport's edge and says where it went in
            `data-placement`; the arrow did not follow, and pointed away from the
            control it belongs to. */}
        <OverlayArrow className="group">
          <svg
            width={8}
            height={8}
            viewBox="0 0 8 8"
            className="fill-fill-primary group-data-[placement=bottom]:rotate-180 group-data-[placement=left]:-rotate-90 group-data-[placement=right]:rotate-90"
          >
            <path d="M0 0 L4 4 L8 0 Z" />
          </svg>
        </OverlayArrow>
        {content}
      </AriaTooltip>
    </AriaTooltipTrigger>
  );
}
