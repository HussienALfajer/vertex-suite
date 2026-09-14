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

export interface SelectProps extends Omit<AriaSelectProps<SelectOption>, 'className' | 'children'> {
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
      className={clsx('flex flex-col gap-[var(--vx-gap-xs)]', className)}
      {...(errorMessage === undefined ? {} : { isInvalid: true })}
    >
      <Label className="text-footnote font-body-medium text-fg-secondary">{label}</Label>
      <AriaButton
        className={clsx(
          'h-[var(--vx-h-control)] w-full rounded px-[var(--vx-pad-md)]',
          'flex items-center justify-between gap-[var(--vx-gap-sm)]',
          'bg-fill-field text-fg text-body text-start',
          'border border-line-strong',
          'data-[invalid]:border-line-danger',
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
          'entering:duration-[var(--vx-dur-base)] entering:ease-out',
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
                'text-body text-fg cursor-default outline-none',
                'data-[focused]:bg-fill-ghost-hover',
                'data-[selected]:font-body-medium',
                'data-[disabled]:text-fg-disabled',
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
