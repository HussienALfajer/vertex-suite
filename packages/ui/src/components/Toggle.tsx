import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  CheckboxButton,
  CheckboxField,
  Label,
  SwitchButton,
  SwitchField,
  type CheckboxFieldProps,
  type SwitchFieldProps,
} from 'react-aria-components';

/**
 * Built on `CheckboxField` + `CheckboxButton` and `SwitchField` + `SwitchButton`
 * rather than the older single `Checkbox` and `Switch`, which React Aria now
 * marks deprecated. Shipping on a deprecated API is the same mistake as
 * shipping on an `UNSTABLE_` one: the cost of the churn lands on a shop running
 * an unattended update, not on us.
 */

export interface CheckboxProps extends Omit<CheckboxFieldProps, 'className' | 'children'> {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A binary choice inside a form, answered when the form is submitted.
 *
 * The box is the density's own `checkbox` size rather than a fixed one, so it
 * grows with everything else on a touch surface instead of staying a target a
 * finger misses (§6.2).
 */
export function Checkbox({ children, className, ...props }: CheckboxProps): ReactNode {
  return (
    <CheckboxField
      {...props}
      className={clsx(
        'group flex items-center gap-[var(--vx-gap-sm)]',
        'text-body text-fg cursor-default',
        'data-[disabled]:text-fg-disabled data-[disabled]:cursor-not-allowed',
        className,
      )}
    >
      <CheckboxButton
        className={clsx(
          'size-[var(--vx-checkbox)] shrink-0 rounded-[calc(var(--vx-radius)/2)]',
          'flex items-center justify-center border transition-colors',
          'duration-[var(--vx-dur-snap)] ease-out outline-none',
          'data-[selected]:bg-fill-primary data-[selected]:border-transparent',
          'data-[indeterminate]:bg-fill-primary data-[indeterminate]:border-transparent',
          'bg-fill-field border-line-strong',
          'data-[focus-visible]:shadow-[var(--vx-focus-ring)]',
        )}
      >
        {({ isSelected, isIndeterminate }) =>
          isIndeterminate ? (
            <svg viewBox="0 0 16 16" aria-hidden="true" className="text-on-primary w-2/3">
              <rect x="3" y="7" width="10" height="2" rx="1" fill="currentColor" />
            </svg>
          ) : isSelected ? (
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="text-on-primary w-3/4 fill-none stroke-current"
              strokeWidth="2.25"
            >
              <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null
        }
      </CheckboxButton>
      <Label className="cursor-default">{children}</Label>
    </CheckboxField>
  );
}

export interface SwitchProps extends Omit<SwitchFieldProps, 'className' | 'children'> {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A setting that takes effect the moment it is changed.
 *
 * That is the whole difference from a checkbox, and it is why the two are not
 * interchangeable: a switch promises the change has already happened, so it is
 * wrong anywhere a form has yet to be saved.
 *
 * The knob moves along the **inline** axis, so it travels the correct direction
 * in a right-to-left document without a second rule (§9).
 */
export function Switch({ children, className, ...props }: SwitchProps): ReactNode {
  return (
    <SwitchField
      {...props}
      className={clsx(
        'group flex items-center gap-[var(--vx-gap-sm)]',
        'text-body text-fg cursor-default',
        'data-[disabled]:text-fg-disabled data-[disabled]:cursor-not-allowed',
        className,
      )}
    >
      <SwitchButton
        className={clsx(
          'h-[var(--vx-switch-h)] w-[calc(var(--vx-switch-h)*1.75)] shrink-0',
          'rounded-pill flex items-center p-[2px] transition-colors',
          'duration-[var(--vx-dur-snap)] ease-out outline-none',
          // §4.7. Not `fill-secondary`: in the light theme that resolves to
          // `surface-2`, the same white as the knob, and the knob vanishes.
          'bg-switch-track data-[selected]:bg-switch-track-on',
          'data-[focus-visible]:shadow-[var(--vx-focus-ring)]',
        )}
      >
        <span
          className={clsx(
            'aspect-square h-full rounded-full shadow-sm',
            'bg-switch-knob group-data-[selected]:bg-switch-knob-on',
            'transition-[margin,background-color] duration-[var(--vx-dur-snap)] ease-out',
            'group-data-[selected]:ms-[calc(var(--vx-switch-h)*0.75)]',
          )}
        />
      </SwitchButton>
      <Label className="cursor-default">{children}</Label>
    </SwitchField>
  );
}
