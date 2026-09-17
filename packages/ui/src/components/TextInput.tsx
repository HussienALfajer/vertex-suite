import { clsx } from 'clsx';
import { useState, type ReactNode } from 'react';
import {
  Button as AriaButton,
  FieldError,
  Input,
  Label,
  Text,
  TextField,
  type TextFieldProps,
} from 'react-aria-components';

import { useTranslator } from '../providers/context.js';
import { focusRing } from './styles.js';

export interface TextInputProps extends Omit<
  TextFieldProps,
  'className' | 'children' | 'validationBehavior'
> {
  /** Required. A field without a label is a field someone has to guess at. */
  readonly label: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly placeholder?: string;
  /**
   * What is typed here is machine text — an identifier, a code, a numbering
   * format — so the value is laid out left to right and set in `font-mono`
   * (§5.1, §9). See `Code`, which has the measurement: a right-to-left field
   * reorders the parts of `{prefix}-{generation}-{year}-{sequence:6}` and shows
   * somebody a format their shop does not use.
   *
   * Only the value. The label, the description and the error stay in the
   * document's direction, because they are prose and are read by the same
   * person in the same breath.
   */
  readonly isMachineText?: boolean;
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
  isMachineText = false,
  className,
  ...props
}: TextInputProps): ReactNode {
  const translator = useTranslator();
  const [isRevealed, setIsRevealed] = useState(false);

  const isPassword = props.type === 'password';
  // The field stays a password field in every sense but the one being asked
  // for: `TextField` keeps the type it was given, and only the rendered input
  // switches, so `autoComplete`, the manager that fills it and the browser's
  // own handling of it are all unaffected by somebody looking at what they
  // typed.
  const type = isPassword && isRevealed ? 'text' : props.type;

  return (
    <TextField
      {...props}
      validationBehavior="aria"
      className={clsx('flex flex-col gap-[var(--vx-gap-xs)]', className)}
      {...(errorMessage === undefined ? {} : { isInvalid: true })}
    >
      <Label className="text-footnote font-medium text-fg-secondary">{label}</Label>
      <div className="relative flex">
        <Input
          {...(placeholder === undefined ? {} : { placeholder })}
          {...(type === undefined ? {} : { type })}
          // On the input rather than on the field: `dir` carries
          // `unicode-bidi: isolate` with it, so what is typed is ordered on its
          // own and the label beside it stays in the document's direction.
          {...(isMachineText ? { dir: 'ltr' as const } : {})}
          className={clsx(
            'h-[var(--vx-h-control)] w-full rounded px-[var(--vx-pad-md)]',
            'bg-fill-field text-fg text-body',
            isMachineText ? 'font-mono' : '',
            'border border-line-strong',
            'placeholder:text-fg-muted',
            'outline-none data-[focused]:shadow-[var(--vx-focus-ring)]',
            'data-[invalid]:border-line-danger',
            'disabled:text-fg-disabled disabled:cursor-not-allowed',
            'transition-[box-shadow,border-color] duration-[var(--vx-dur-snap)] ease-out',
            // Room for the control sitting over the end of the field, so a
            // long password runs under it rather than behind it.
            isPassword ? 'pe-[calc(var(--vx-h-control)+var(--vx-pad-xs))]' : '',
          )}
        />
        {isPassword ? (
          <AriaButton
            // Not the shared `IconButton`: that one is square at the full
            // control height and carries a tooltip, and both are wrong for a
            // control living *inside* a field of exactly that height.
            aria-label={translator.format(isRevealed ? 'password.hide' : 'password.show')}
            // In the tab order. It was once excluded, to spare a cashier a stop
            // between the password and the button, and §11.1 is plain that a
            // control a pointer can reach and a keyboard cannot is a defect: on
            // the register, which has no pointer, nobody could ever check what
            // they had typed.
            onPress={() => {
              setIsRevealed((was) => !was);
            }}
            className={clsx(
              // `end-0`, which is the left on this interface and the right on a
              // Latin one — the same edge `SearchInput` puts its clear control
              // on, so a field's trailing control is always in one place.
              'absolute inset-y-0 end-0 my-auto me-[var(--vx-pad-xs)]',
              'flex items-center justify-center rounded',
              'size-[var(--vx-h-control-nested)] [&_svg]:size-[var(--vx-icon)]',
              'text-fg-muted hover:text-fg cursor-pointer',
              focusRing,
            )}
          >
            {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
          </AriaButton>
        ) : null}
      </div>
      {description === undefined ? null : (
        <Text slot="description" className="text-footnote text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-footnote text-fg-danger">{errorMessage}</FieldError>
    </TextField>
  );
}

/** An eye: what is hidden, offered to be shown. Unmirrored — §9 mirrors direction, not objects. */
function EyeIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="fill-none stroke-current"
      strokeWidth="1.5"
    >
      <path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z" />
      <circle cx="10" cy="10" r="2.75" />
    </svg>
  );
}

/** The same eye, struck through: what is shown, offered to be hidden. */
function EyeOffIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="fill-none stroke-current"
      strokeWidth="1.5"
    >
      <path d="M8 5a8 8 0 012-.25c5.5 0 8.5 5.25 8.5 5.25a14 14 0 01-2.75 3.2M5 6.3A14 14 0 001.5 10S4.5 15.25 10 15.25a8 8 0 002.4-.35" />
      <path d="M8.1 8.1a2.75 2.75 0 003.9 3.9" />
      <path d="M3.5 3.5l13 13" strokeLinecap="round" />
    </svg>
  );
}
