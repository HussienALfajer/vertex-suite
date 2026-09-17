import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  Popover as AriaPopover,
  DialogTrigger,
  OverlayArrow,
} from 'react-aria-components';

export interface PopoverProps {
  /** Names the panel for a screen reader; it has no heading of its own. */
  readonly label: string;
  /** The control it hangs from. Focus returns to it on close. */
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly className?: string;
}

/**
 * A panel hanging off a control, for detail that belongs beside the thing
 * rather than in front of the screen.
 *
 * Not a `Dialog`: a modal takes the whole screen away to say one thing, and the
 * thing being said here — which branch this marker is, what its address is — is
 * only meaningful next to the marker it came from. Not a `Tooltip` either: a
 * tooltip is the name of a control and cannot hold a link or a figure, and this
 * holds both.
 *
 * Placement is React Aria's, which means it follows the document's direction
 * through `I18nProvider` (§9) and flips itself away from the edges of the
 * viewport. A hand-placed panel on a map is a panel that opens off-screen for
 * whichever marker is nearest the corner.
 */
export function Popover({
  label,
  trigger,
  children,
  isOpen,
  onOpenChange,
  className,
}: PopoverProps): ReactNode {
  return (
    <DialogTrigger
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      {trigger}
      <AriaPopover
        placement="top"
        offset={10}
        className={clsx(
          'bg-surface-3 rounded-card shadow-lg border-line z-40 border',
          'max-w-[20rem] min-w-[14rem]',
          // §8, over `dur-base` — see `Dialog` for why these are the classes.
          'transition-opacity duration-[var(--vx-dur-base)] ease-out starting:opacity-0',
          'data-[exiting]:opacity-0 data-[exiting]:ease-in',
          className,
        )}
      >
        {/* Drawn pointing down, for an overlay above its trigger. React Aria flips
            the overlay away from the viewport's edge and says where it went in
            `data-placement`; the arrow did not follow, and pointed away from the
            control it belongs to. */}
        <OverlayArrow className="group">
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            className="fill-surface-3 stroke-line group-data-[placement=bottom]:rotate-180 group-data-[placement=left]:-rotate-90 group-data-[placement=right]:rotate-90"
          >
            <path d="M0 0 L6 6 L12 0" />
          </svg>
        </OverlayArrow>
        <AriaDialog
          aria-label={label}
          // policy-exempt: §7.3 — the panel is a focus landing point rather than a
          // control; focus moves on to the first control inside it.
          className="text-body text-fg p-[var(--vx-pad-md)] outline-none"
        >
          {children}
        </AriaDialog>
      </AriaPopover>
    </DialogTrigger>
  );
}
