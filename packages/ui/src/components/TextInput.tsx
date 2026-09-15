import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  FieldError,
  Input,
  Label,
  Text,
  TextField,
  type TextFieldProps,
} from 'react-aria-components';

export interface TextInputProps extends Omit<
  TextFieldProps,
  'className' | 'children' | 'validationBehavior'
> {
  /** Required. A field without a label is a field someone has to guess at. */
  readonly label: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * A labelled text field.
 *
 * Label, description and error are parts of one component rather than three
 * things a screen assembles, because that is what keeps them wired together for
 * assistive technology — React Aria owns the `aria-describedby` and
 * `aria-invalid` relationships, and a screen cannot forget them.
 *
 * The field is `comfortable` by default: an entry error costs far more than a
 * scroll (§6.1).
 *
 * **Validation is `aria`, and the prop is not offered.** Left native, the
 * browser validates `required` and `type` itself and writes the message — in
 * *its own* language, from its own strings. On an Arabic-first interface that
 * puts "Please fill out this field." under a label reading "اسم المستخدم", and
 * it is not a string anything in this repository can translate or a tenant can
 * rename (§12, `SYS-08`). So the field announces the constraint to assistive
 * technology and leaves the words to `errorMessage`, which comes from the
 * catalogue like every other string a person reads.
 */
export function TextInput({
  label,
  description,
  errorMessage,
  placeholder,
  className,
  ...props
}: TextInputProps): ReactNode {
  return (
    <TextField
      {...props}
      validationBehavior="aria"
      className={clsx('flex flex-col gap-[var(--vx-gap-xs)]', className)}
      {...(errorMessage === undefined ? {} : { isInvalid: true })}
    >
      <Label className="text-footnote font-body-medium text-fg-secondary">{label}</Label>
      <Input
        {...(placeholder === undefined ? {} : { placeholder })}
        className={clsx(
          'h-[var(--vx-h-control)] w-full rounded px-[var(--vx-pad-md)]',
          'bg-fill-field text-fg text-body',
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
