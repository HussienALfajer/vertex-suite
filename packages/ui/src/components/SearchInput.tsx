import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Input,
  Label,
  SearchField,
  type SearchFieldProps,
} from 'react-aria-components';

import { focusRing } from './styles.js';

export interface SearchInputProps extends Omit<
  SearchFieldProps,
  'className' | 'children' | 'validationBehavior'
> {
  /**
   * Required, and usually hidden. A magnifying glass is a picture of a word,
   * and the word is what a screen reader has to be able to say.
   */
  readonly label: string;
  /** Shows the label above the field instead of only naming it for assistive technology. */
  readonly isLabelVisible?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * The control that narrows a list.
 *
 * `SearchField` rather than a text input with an icon beside it, because the
 * two differ in behaviour and not in decoration: `Esc` clears it, the clear
 * control appears only once there is something to clear, and the field
 * announces itself as a search to anybody who navigates by landmark. None of
 * that is reproducible with a magnifying glass and a placeholder.
 *
 * It filters what is already on screen rather than asking the store node
 * anything, which is why there is no submit: a list that answers on the next
 * keystroke needs no button, and a button here would suggest a round trip that
 * is not happening. `SYS-07`'s global search is a different thing, arrives with
 * `U24`, and will have one.
 */
export function SearchInput({
  label,
  isLabelVisible = false,
  placeholder,
  className,
  ...props
}: SearchInputProps): ReactNode {
  return (
    <SearchField
      {...props}
      aria-label={label}
      className={clsx('group flex flex-col gap-[var(--vx-gap-xs)]', className)}
    >
      <Label
        className={clsx(
          'text-footnote font-body-medium text-fg-secondary',
          isLabelVisible ? '' : 'sr-only',
        )}
      >
        {label}
      </Label>
      <div
        className={clsx(
          'h-[var(--vx-h-control)] flex items-center gap-[var(--vx-gap-xs)] rounded',
          'px-[var(--vx-pad-md)]',
          'bg-fill-field border border-line-strong',
          'focus-within:shadow-[var(--vx-focus-ring)]',
          'transition-[box-shadow,border-color] duration-[var(--vx-dur-snap)] ease-out',
        )}
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="size-[var(--vx-icon)] text-fg-muted shrink-0 fill-none stroke-current"
          strokeWidth="1.5"
        >
          {/* A lens and a handle: an object rather than a direction, so §9
              leaves it unmirrored in a right-to-left document. */}
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        <Input
          {...(placeholder === undefined ? {} : { placeholder })}
          className={clsx(
            'text-body text-fg min-w-0 flex-1 bg-transparent',
            'placeholder:text-fg-muted',
            // The ring is on the group, which is what a person sees as the
            // control; drawing a second one around the bare input inside it
            // would put two rings on one thing.
            'outline-none',
            'disabled:text-fg-disabled disabled:cursor-not-allowed',
          )}
        />
        {/* React Aria hides this whenever the field is empty, so it never
            offers to clear nothing. */}
        <AriaButton
          className={clsx(
            'text-fg-muted hover:text-fg shrink-0 cursor-pointer rounded',
            'flex items-center justify-center',
            'size-[var(--vx-h-control-nested)] [&_svg]:size-[var(--vx-icon)]',
            'group-data-[empty]:hidden',
            focusRing,
          )}
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="fill-none stroke-current"
            strokeWidth="1.5"
          >
            <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
          </svg>
        </AriaButton>
      </div>
    </SearchField>
  );
}
