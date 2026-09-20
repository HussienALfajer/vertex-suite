import { clsx } from 'clsx';
import { useState, type ReactNode } from 'react';
import { FieldError, Input, Label, Text, TextField } from 'react-aria-components';

import { money, toDecimalString, type Currency, type Money } from '@vertex/kernel';

import { useVertex } from '../providers/context.js';

export interface MoneyInputProps {
  /** Required. A field without a label is a field someone has to guess at. */
  readonly label: string;
  /**
   * Required, and what the amount is in. It carries the places the figure may
   * be typed to and the code shown beside it — §12 allows no amount on screen
   * without its currency, and an input is where the mistake is made rather
   * than merely displayed.
   */
  readonly currency: Currency;
  /** The amount, or null while the field is empty. */
  readonly value: Money | null;
  readonly onChange: (value: Money | null) => void;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

/**
 * An amount of money, typed.
 *
 * **It is not a number field, and that is the whole design.** React Aria's
 * `NumberField` — like every number input in a browser — speaks `number`, and
 * a JavaScript float cannot represent `0.1`; the moment one is produced there
 * is no later point at which the error can be detected, only points at which
 * it is carried forward (`README.md`, `money.ts`). So what crosses this
 * boundary is the kernel's `Money`, built from the exact decimal string the
 * person typed, and no float exists anywhere on the path.
 *
 * **What cannot be typed here cannot be refused later.** The field takes a
 * keystroke only if what it would leave behind is still an amount of this
 * currency: digits, one decimal mark, and no more places than the currency is
 * kept to. That makes `fin.line-amount-invalid` and
 * `fin.line-amount-too-precise` unreachable from this control rather than
 * explained by it — the same choice the chart's parent chooser makes about the
 * refusals it filters out. The module still judges what arrives, because a
 * command also reaches it from a wire that passed no screen.
 *
 * **There is no sign.** Every amount in this product carries its direction
 * beside it — a journal line has a side, a rounding residual is put on the side
 * its sign means (`DraftLine`) — and a signed amount *and* a side would be two
 * ways of saying one thing, free to disagree. A control that could express a
 * negative would be inviting exactly that.
 *
 * **The digits are the reader's** (§5.5). A tenant reading in Arabic-Indic
 * digits types `٥٠٠٫٢٥` and stores `500.25`: the glyphs and the marks are
 * taken from `Intl` for the very locale the display components format in, so
 * what this accepts cannot drift from what `Money` writes back.
 *
 * Validation is `aria` and the prop is not offered, for the reason `TextInput`
 * gives: the browser writes its own validation message in its own language,
 * and a string this repository cannot translate must never reach a screen.
 */
export function MoneyInput({
  label,
  currency,
  value,
  onChange,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  autoFocus,
  className,
}: MoneyInputProps): ReactNode {
  const { formattingLocale } = useVertex();
  const marks = marksOf(formattingLocale);

  // The mix-up §12 exists to prevent, on the side where it is made rather than
  // where it is displayed: `Money` refuses to render an amount against a
  // currency it is not expressed in, and a field that quietly did so would show
  // a figure in dollars under a chooser saying pounds — and hand it back as
  // whichever the caller happened to read. A caller changes the two together.
  if (value !== null && value.currency !== currency.code) {
    throw new Error(
      `An amount in ${value.currency} was given the currency ${currency.code}. ` +
        'A field never holds an amount in a currency it is not a field of.',
    );
  }

  // What the field is a field *of*, as one string. The amount alone is not
  // enough: the same figure typed against a currency kept to three places and
  // then against one kept to none is two different fields, and the second has
  // to lose its fraction rather than keep a value it can no longer express.
  const subject = subjectOf(value, currency);

  const [text, setText] = useState(() => textOf(plainOf(value), marks));
  const [mirrored, setMirrored] = useState(subject);

  // Adjusted while rendering rather than in an effect: an effect would paint
  // the previous amount once under the new currency's name. This is React's
  // own arrangement for state derived from props, and it settles immediately —
  // `subject` is a string, so the comparison is by value and cannot loop.
  if (subject !== mirrored) {
    setMirrored(subject);
    setText(textOf(plainOf(value), marks));
  }

  return (
    <TextField
      value={text}
      onChange={(next) => {
        const plain = readFigure(next, marks, currency.decimals);
        // A keystroke that would leave something this currency cannot hold is
        // not applied at all: the field keeps what it had, and nothing on
        // screen changes. Rejecting the keystroke rather than the value is
        // what keeps the caret where the person left it.
        if (plain === null) return;
        const figure = amountOf(plain);
        const amount = figure === null ? null : money(figure, currency.code);
        setText(textOf(plain, marks));
        // What was emitted, not what was typed: `05` and `5` are one amount,
        // and the caller hands back the one the kernel writes. Without this
        // the next render would read a subject nothing here had mirrored and
        // rewrite the field under the person's caret.
        setMirrored(subjectOf(amount, currency));
        onChange(amount);
      }}
      {...(isRequired === undefined ? {} : { isRequired })}
      {...(isDisabled === undefined ? {} : { isDisabled })}
      {...(autoFocus === undefined ? {} : { autoFocus })}
      {...(errorMessage === undefined ? {} : { isInvalid: true })}
      validationBehavior="aria"
      className={clsx('flex flex-col gap-[var(--vx-gap-xs)]', className)}
    >
      <Label className="text-footnote font-medium text-fg-secondary">{label}</Label>
      <div className="relative flex">
        <Input
          // `decimal` rather than `numeric`: a till or a tablet has to offer
          // the separator, and `numeric` is the keypad without one.
          inputMode="decimal"
          // The figure is laid out left to right and its digits align on the
          // decimal, exactly as `Money` renders one (§9, §12): an amount is
          // machine text in the middle of a sentence nobody reads that way.
          dir="ltr"
          className={clsx(
            'h-[var(--vx-h-control)] w-full rounded px-[var(--vx-pad-md)]',
            'bg-fill-field text-fg text-body tabular-nums',
            'border border-line-strong',
            'outline-none data-[focused]:shadow-[var(--vx-focus-ring)]',
            'data-[invalid]:border-line-danger',
            'disabled:text-fg-disabled disabled:cursor-not-allowed',
            'transition-[box-shadow,border-color] duration-[var(--vx-dur-snap)] ease-out',
            // Room for the code sitting over the end of the field, so a long
            // figure runs under it rather than behind it.
            'pe-[calc(var(--vx-h-control)+var(--vx-pad-xs))]',
          )}
        />
        {/* The currency, never omitted and never the symbol alone: a bare
            symbol is how a figure in one currency gets read as another, and
            this product trades in four at one till (§12). Decorative, because
            the label already names the field and the code is announced with
            the value through the description below. */}
        <span
          aria-hidden="true"
          className={clsx(
            'absolute inset-y-0 end-0 flex items-center',
            'pe-[var(--vx-pad-md)] text-footnote text-fg-muted',
          )}
          dir="ltr"
        >
          {currency.code}
        </span>
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

/**
 * The glyphs one locale writes a figure with: its ten digits, its decimal mark
 * and its group mark.
 *
 * Taken from `Intl` rather than from a table of Unicode ranges, so that what
 * this field accepts is by construction what `formatExact` writes — the
 * alternative is two lists of characters for one numbering system, and the
 * day they disagree is the day a shopkeeper cannot type back a figure the
 * screen has just shown them.
 */
interface Marks {
  readonly digits: readonly string[];
  readonly decimal: string;
  readonly group: string;
}

const CACHE = new Map<string, Marks>();

function marksOf(locale: string): Marks {
  const held = CACHE.get(locale);
  if (held !== undefined) return held;

  const plain = new Intl.NumberFormat(locale, { useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, digit) => plain.format(digit));
  const parts = new Intl.NumberFormat(locale, {
    useGrouping: true,
    minimumFractionDigits: 1,
  }).formatToParts(1234.5);
  const marks: Marks = {
    digits,
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
  };
  CACHE.set(locale, marks);
  return marks;
}

/** The amount and the currency it is being typed against, as one comparable string. */
function subjectOf(value: Money | null, currency: Currency): string {
  return `${plainOf(value)}|${currency.code}|${String(currency.decimals)}`;
}

/** An amount as this file works with it: plain ASCII digits and a full stop. */
function plainOf(value: Money | null): string {
  return value === null ? '' : toDecimalString(value);
}

/**
 * A figure written in the reader's own digits and decimal mark.
 *
 * So that a figure pasted in Latin digits by somebody reading in Arabic-Indic
 * ones settles into the digits everything else on the page is written in —
 * and so that what was typed comes back in the same glyphs `Money` renders it
 * in, rather than in two numbering systems on one screen.
 */
const ZERO = '0'.codePointAt(0) ?? 48;

function textOf(plain: string, marks: Marks): string {
  let written = '';
  for (const character of plain) {
    if (character === '.') {
      written += marks.decimal;
      continue;
    }
    const digit = character.codePointAt(0);
    written +=
      digit === undefined || character < '0' || character > '9'
        ? character
        : (marks.digits[digit - ZERO] ?? character);
  }
  return written;
}

/**
 * The exact decimal string a field holding this text stands for, or null while
 * it stands for no figure yet.
 *
 * A lone decimal mark, and a mark with nothing after it, are moments every
 * figure with a fraction passes through: they name no amount, and the field is
 * empty of one until a digit follows.
 */
function amountOf(plain: string): string | null {
  const figure = plain.endsWith('.') ? plain.slice(0, -1) : plain;
  return figure === '' || figure === '.' ? null : figure;
}

/**
 * What the field would hold after a keystroke, in plain digits — or null when
 * the keystroke is not one this currency can take.
 *
 * Group marks are dropped rather than refused: they are what `Intl` writes,
 * never what a figure means, and somebody pasting `1,234.50` means what
 * somebody typing `1234.5` means.
 */
function readFigure(typed: string, marks: Marks, decimals: number): string | null {
  let plain = '';
  for (const character of typed) {
    if (character === marks.group || character === ',' || character === ' ') continue;
    if (character === marks.decimal || character === '.') {
      plain += '.';
      continue;
    }
    const written = marks.digits.indexOf(character);
    if (written !== -1) {
      plain += String(written);
      continue;
    }
    if (character >= '0' && character <= '9') {
      plain += character;
      continue;
    }
    return null;
  }

  // A trailing mark with nothing after it yet is how every figure with a
  // fraction is typed, so it is held rather than refused — and a currency kept
  // to no places has no such moment, which is why the mark is refused outright
  // there rather than left to be rejected one keystroke later.
  const shape =
    decimals === 0 ? /^\d*$/u : new RegExp(`^\\d*(\\.\\d{0,${String(decimals)}})?$`, 'u');
  return shape.test(plain) ? plain : null;
}
