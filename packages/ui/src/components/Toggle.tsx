import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  CheckboxButton,
  CheckboxField,
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
 *
 * **The words go inside the button, and that is not a layout preference.** The
 * button element React Aria renders here *is* the `<label>` of the hidden input
 * that carries the role — it is handed `labelProps` from `useSwitch` and
 * `useCheckbox` — so whatever is inside it is the control's accessible name and
 * whatever is beside it is not. Both of these shipped with the text as a
 * sibling `<Label>`, which produced a switch and a checkbox that a screen
 * reader announced with no name at all, and a caption that could not be clicked
 * to toggle the thing it captioned. Nothing looked wrong; §11 makes a control
 * that cannot be operated or announced a defect, and `components.test.tsx` now
 * asserts the name rather than trusting the arrangement.
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
    <CheckboxField {...props} className={clsx('flex', className)}>
      <CheckboxButton
        className={clsx(
          'group flex items-center gap-[var(--vx-gap-sm)]',
          // No `outline-none` here: the element that takes focus is the hidden
          // input inside, not this label, so there is no outline to suppress —
          // and the ring is drawn on the box and the track below, which are
          // what a person actually sees (§7.3).
          'text-body text-fg cursor-pointer',
          'data-[disabled]:text-fg-disabled data-[disabled]:cursor-not-allowed',
        )}
      >
        {({ isSelected, isIndeterminate }) => (
          <>
            <span
              className={clsx(
                'size-[var(--vx-checkbox)] shrink-0 rounded-[calc(var(--vx-radius)/2)]',
                'flex items-center justify-center border transition-colors',
                'duration-[var(--vx-dur-snap)] ease-out',
                'bg-fill-field border-line-strong',
                'group-data-[selected]:bg-fill-primary group-data-[selected]:border-transparent',
                'group-data-[indeterminate]:bg-fill-primary group-data-[indeterminate]:border-transparent',
                'group-data-[focus-visible]:shadow-[var(--vx-focus-ring)]',
              )}
            >
              {isIndeterminate ? (
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
              ) : null}
            </span>
            <span>{children}</span>
          </>
        )}
      </CheckboxButton>
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
    <SwitchField {...props} className={clsx('flex', className)}>
      <SwitchButton
        className={clsx(
          'group flex items-center gap-[var(--vx-gap-sm)]',
          // No `outline-none` here: the element that takes focus is the hidden
          // input inside, not this label, so there is no outline to suppress —
          // and the ring is drawn on the box and the track below, which are
          // what a person actually sees (§7.3).
          'text-body text-fg cursor-pointer',
          'data-[disabled]:text-fg-disabled data-[disabled]:cursor-not-allowed',
        )}
      >
        <span
          className={clsx(
            'h-[var(--vx-switch-h)] w-[calc(var(--vx-switch-h)*1.75)] shrink-0',
            'rounded-pill flex items-center p-[2px] transition-colors',
            'duration-[var(--vx-dur-snap)] ease-out',
            // §4.7. Not `fill-secondary`: in the light theme that resolves to
            // `surface-2`, the same white as the knob, and the knob vanishes.
            'bg-switch-track group-data-[selected]:bg-switch-track-on',
            'group-data-[focus-visible]:shadow-[var(--vx-focus-ring)]',
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
        </span>
        <span>{children}</span>
      </SwitchButton>
    </SwitchField>
  );
}
