import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text,
  type SelectProps as AriaSelectProps,
} from 'react-aria-components';

import { focusRing } from './styles.js';

export interface SelectOption {
  readonly id: string;
  readonly label: string;
  readonly isDisabled?: boolean;
}

export interface SelectProps extends Omit<
  AriaSelectProps<SelectOption>,
  'className' | 'children' | 'validationBehavior'
> {
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly description?: string;
  readonly errorMessage?: string;
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * A choice from a closed list.
 *
 * The popover is `surface-3` and separates from a `surface-2` panel by shadow
 * as much as by colour — in the light theme those two surfaces are the same
 * white by design (§4.4), so elevation is what does the work.
 *
 * Validation is `aria` and the prop is not offered, for the reason `TextInput`
 * gives: the browser writes its own validation message in its own language, and
 * a string this repository cannot translate is a string that must never reach a
 * screen (§12).
 */
export function Select({
  label,
  options,
  description,
  errorMessage,
  placeholder,
  className,
  ...props
}: SelectProps): ReactNode {
  return (
    <AriaSelect
      {...props}
      validationBehavior="aria"
      className={clsx('group flex flex-col gap-[var(--vx-gap-xs)]', className)}
      {...(errorMessage === undefined ? {} : { isInvalid: true })}
    >
      <Label className="text-footnote font-medium text-fg-secondary">{label}</Label>
      <AriaButton
        className={clsx(
          'h-[var(--vx-h-control)] w-full rounded px-[var(--vx-pad-md)]',
          'flex items-center justify-between gap-[var(--vx-gap-sm)]',
          'bg-fill-field text-fg text-body cursor-pointer text-start',
          'border border-line-strong',
          // React Aria marks the select invalid, not the button inside it, so the
          // danger edge is read from the group. On the button itself it matched
          // nothing, and an invalid select looked like a valid one.
          'group-data-[invalid]:border-line-danger',
          'disabled:text-fg-disabled disabled:cursor-not-allowed',
          focusRing,
        )}
      >
        <SelectValue className="truncate data-[placeholder]:text-fg-muted">
          {({ isPlaceholder, selectedText }) =>
            isPlaceholder ? (placeholder ?? '') : selectedText
          }
        </SelectValue>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="size-[var(--vx-icon)] shrink-0 fill-none stroke-current"
          strokeWidth="1.5"
        >
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </AriaButton>

      {description === undefined ? null : (
        <Text slot="description" className="text-footnote text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-footnote text-fg-danger">{errorMessage}</FieldError>

      <Popover
        className={clsx(
          'bg-surface-3 rounded-card border border-line shadow-lg',
          'min-w-(--trigger-width) overflow-auto p-[var(--vx-pad-xs)]',
          // §8, over `dur-base` — see `Dialog` for why these are the classes.
          'transition-opacity duration-[var(--vx-dur-base)] ease-out starting:opacity-0',
          'data-[exiting]:opacity-0 data-[exiting]:ease-in',
        )}
      >
        {/* policy-exempt: §7.3 — focus stays on the trigger, which carries the
            ring; the listbox holds virtual focus and its items indicate it. */}
        <ListBox items={options} className="outline-none">
          {(option: SelectOption) => (
            <ListBoxItem
              id={option.id}
              textValue={option.label}
              {...(option.isDisabled === true ? { isDisabled: true } : {})}
              className={clsx(
                'flex h-[var(--vx-h-control)] items-center rounded px-[var(--vx-pad-md)]',
                'text-body text-fg cursor-pointer outline-none',
                'data-[focused]:bg-fill-ghost-hover',
                'data-[selected]:font-body-medium',
                'data-[disabled]:text-fg-disabled data-[disabled]:cursor-not-allowed',
              )}
            >
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
