import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  FieldError,
  Label,
  Text,
  TextArea as AriaTextArea,
  TextField,
  type TextFieldProps,
} from 'react-aria-components';

export interface TextAreaProps extends Omit<
  TextFieldProps,
  'className' | 'children' | 'validationBehavior' | 'type'
> {
  /** Required. A field without a label is a field someone has to guess at. */
  readonly label: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly placeholder?: string;
  /** Lines shown before it scrolls. Three, which is a short address or a receipt footer. */
  readonly rows?: number;
  readonly className?: string;
}

/**
 * A labelled field for text that has line breaks in it.
 *
 * It is a separate component rather than a mode of `TextInput` because the two
 * differ in the thing a keyboard user notices first: `Enter` submits a form
 * from a single-line field (§11.1) and inserts a newline here. A prop that
 * flipped that would be a prop that quietly changes what the most-used key on
 * the screen does.
 *
 * Validation is `aria` and the prop is not offered, for the reason `TextInput`
 * gives: left native, the browser writes the message itself, in its own
 * language, from strings nothing here can translate and no tenant can rename
 * (§12, `SYS-08`).
 *
 * It grows by scrolling rather than by measuring its own content. An
 * auto-growing field moves everything under it while somebody is typing into
 * it, and the receipt footer this was built for is three lines in every shop
 * that has ever printed one.
 */
export function TextArea({
  label,
  description,
  errorMessage,
  placeholder,
  rows = 3,
  className,
  ...props
}: TextAreaProps): ReactNode {
  return (
    <TextField
      {...props}
      validationBehavior="aria"
      className={clsx('flex flex-col gap-[var(--vx-gap-xs)]', className)}
      {...(errorMessage === undefined ? {} : { isInvalid: true })}
    >
      <Label className="text-footnote font-body-medium text-fg-secondary">{label}</Label>
      <AriaTextArea
        rows={rows}
        {...(placeholder === undefined ? {} : { placeholder })}
        className={clsx(
          'w-full resize-y rounded px-[var(--vx-pad-md)] py-[var(--vx-pad-sm)]',
          'bg-fill-field text-fg text-body leading-[var(--vx-line-height-body)]',
          'border border-line-strong',
          'placeholder:text-fg-muted',
          'outline-none data-[focused]:shadow-[var(--vx-focus-ring)]',
          'data-[invalid]:border-line-danger',
          'disabled:text-fg-disabled disabled:cursor-not-allowed',
          'transition-[box-shadow,border-color] duration-[var(--vx-dur-snap)] ease-out',
        )}
      />
      {description === undefined ? null : (
        <Text slot="description" className="text-footnote text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-footnote text-fg-danger">{errorMessage}</FieldError>
    </TextField>
  );
}
