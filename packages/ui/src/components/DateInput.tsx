import { parseDate } from '@internationalized/date';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  DateField,
  DateInput as AriaDateInput,
  DateSegment,
  FieldError,
  Label,
  Text,
  type DateValue,
} from 'react-aria-components';

import { localDate, type LocalDate } from '@vertex/kernel';

import { focusRing } from './styles.js';

export interface DateInputProps {
  readonly label: string;
  /** The day, or null while the field is empty. */
  readonly value: LocalDate | null;
  readonly onChange: (value: LocalDate | null) => void;
  /**
   * The day whose shape the empty field takes: how many digits the year has,
   * and which month a first keystroke lands in.
   *
   * Stated rather than left to React Aria, which otherwise reads the device's
   * own clock for it. A day in this product is always somewhere's day
   * (`FX-04`, `FIN-05`), and a field that quietly consulted the machine it is
   * displayed on would be the one place in the interface that did.
   */
  readonly placeholder?: LocalDate;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

/**
 * A calendar day, typed a part at a time.
 *
 * **Segments rather than one text box**, which is what React Aria is here for:
 * a person types three figures and never a separator, the field cannot hold a
 * half-written day, and the parts are laid out and navigated in the reader's
 * own direction and written in the tenant's own digits (§5.5, §9) without the
 * stored value changing by a character. A text box would have to be parsed —
 * and every parser of a typed date is a decision about whether `03/04` is
 * March or April, made silently, in a shop where both conventions are in
 * living memory.
 *
 * **What crosses this boundary is the product's own day**, `LocalDate` —
 * `2026-09-20`, the one spelling `@vertex/kernel` accepts — and never a
 * calendar object. That is what keeps `@internationalized/date` inside the
 * design system: a screen states a day the way every record in this product
 * states one, and the conversion to whatever calendar the reader's locale
 * displays happens here, once.
 *
 * Validation is `aria` and the prop is not offered, for the reason `TextInput`
 * and `Select` give: the browser writes its own validation message in its own
 * language, and a string this repository cannot translate must never reach a
 * screen (§12).
 */
export function DateInput({
  label,
  value,
  onChange,
  placeholder,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  autoFocus,
  className,
}: DateInputProps): ReactNode {
  return (
    <DateField
      value={value === null ? null : parseDate(value)}
      onChange={(next) => {
        onChange(next === null ? null : dayOf(next));
      }}
      {...(placeholder === undefined ? {} : { placeholderValue: parseDate(placeholder) })}
      {...(isRequired === undefined ? {} : { isRequired })}
      {...(isDisabled === undefined ? {} : { isDisabled })}
      {...(autoFocus === undefined ? {} : { autoFocus })}
      {...(errorMessage === undefined ? {} : { isInvalid: true })}
      validationBehavior="aria"
      className={clsx('group flex flex-col gap-[var(--vx-gap-xs)]', className)}
    >
      <Label className="text-footnote font-medium text-fg-secondary">{label}</Label>
      <AriaDateInput
        className={clsx(
          'h-[var(--vx-h-control)] w-full rounded px-[var(--vx-pad-md)]',
          'flex items-center gap-px',
          'bg-fill-field text-fg text-body tabular-nums',
          'border border-line-strong',
          // React Aria marks the field invalid, not the group inside it — the
          // same arrangement `Select` reads from its own group.
          'group-data-[invalid]:border-line-danger',
          'group-data-[disabled]:text-fg-disabled group-data-[disabled]:cursor-not-allowed',
          focusRing,
        )}
      >
        {(segment) => (
          <DateSegment
            segment={segment}
            className={clsx(
              'rounded px-[0.15em] outline-none',
              // A separator is not a control: it takes no focus, no fill and no
              // cursor of its own (§11.3).
              'data-[type=literal]:text-fg-muted data-[type=literal]:px-0',
              'data-[placeholder]:text-fg-muted',
              'data-[focused]:bg-fill-accent data-[focused]:text-on-accent',
              'data-[disabled]:text-fg-disabled',
            )}
          />
        )}
      </AriaDateInput>

      {description === undefined ? null : (
        <Text slot="description" className="text-footnote text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-footnote text-fg-danger">{errorMessage}</FieldError>
    </DateField>
  );
}

/**
 * The day a complete field now holds.
 *
 * **The calendar the reader sees is not the one that reaches here.** React Aria
 * lays the segments out in the locale's own calendar — a tenant reading in a
 * Hijri locale types `09/04/1448` — and then converts the value back into the
 * calendar the field was *given*, which is `parseDate`'s and therefore always
 * the proleptic Gregorian one `LocalDate` is.
 *
 * `toString()` rather than the value's own `year`/`month`/`day` **because of
 * what happens if that ever stops being true.** While it holds, the two are
 * the same three figures. If it stopped — a version that emitted the display
 * calendar, a caller that handed in a value of its own — the figures would
 * still read as a plausible day and `1448-04-09` would be stored as the
 * product's year, a period boundary nothing can compare and nothing would
 * report. `toString()` writes a non-Gregorian date with its calendar attached
 * (`1448-04-09[u-ca-islamic-umalqura]`), which `localDate` refuses, so the same
 * change raises below instead of being filed.
 *
 * A field yields a complete day or nothing, so a string the kernel will not
 * accept is a defect rather than data: it would mean the calendar produced a
 * day outside the years this product writes, and passing it on as "cleared"
 * would lose what somebody typed without a word (`README.md`: a refusal is a
 * value, a defect is an exception).
 */
function dayOf(value: DateValue): LocalDate {
  const written = value.toString();
  const day = localDate(written);
  if (day === null) {
    throw new RangeError(`A date field produced "${written}", which names no day.`);
  }
  return day;
}
