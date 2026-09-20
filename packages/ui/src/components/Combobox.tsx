import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  ComboBox,
  FieldError,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
} from 'react-aria-components';

import { useTranslator } from '../providers/context.js';
import { focusRing } from './styles.js';

export interface ComboboxOption {
  readonly id: string;
  /** What identifies it: an account's code, a branch's name. */
  readonly label: string;
  /** What explains it, searched alongside the label and shown beside it. */
  readonly detail?: string;
  readonly isDisabled?: boolean;
}

export interface ComboboxProps {
  /** Required. A field without a label is a field someone has to guess at. */
  readonly label: string;
  readonly options: readonly ComboboxOption[];
  /** The chosen option's id, or null while nothing is chosen. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  /** What to say when what was typed matches nothing. */
  readonly emptyMessage: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly placeholder?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

/**
 * A choice from a closed list, narrowed by typing.
 *
 * **`Select` and this are not the same control at two sizes.** A `Select` is a
 * list a person reads; this is a list a person searches. The line between them
 * is how many options there are before reading them all stops being possible —
 * a shop's chart of accounts runs to three hundred, and a dropdown of three
 * hundred is a control that technically offers the account and practically
 * hides it.
 *
 * **The list is still closed.** What comes back is an option's id or nothing:
 * typing is how the list is narrowed, never how a value is invented. A field
 * that accepted what was typed would be a field that lets an accountant post
 * to an account that does not exist.
 *
 * Each option may carry a `detail` — an account's name under its code — and
 * **both are searched**, because an accountant knows a third of the chart by
 * its codes and the rest by its words.
 *
 * Filtering folds what it compares (`NFC`, case, and the marks Arabic is
 * written with) rather than using a plain substring: the same word typed on two
 * keyboards is two different sequences of code points, and a search that
 * matched only one of them would be a search that answers "nothing" about an
 * account that is sitting in the list.
 *
 * Validation is `aria` and the prop is not offered, for the reason `TextInput`
 * and `Select` give: the browser writes its own validation message in its own
 * language, and a string this repository cannot translate must never reach a
 * screen (§12).
 */
export function Combobox({
  label,
  options,
  value,
  onChange,
  emptyMessage,
  description,
  errorMessage,
  placeholder,
  isRequired,
  isDisabled,
  autoFocus,
  className,
}: ComboboxProps): ReactNode {
  const translator = useTranslator();

  return (
    <ComboBox
      // `defaultItems` rather than `items`: the second hands React Aria a
      // collection somebody else filtered, and this control's whole subject is
      // that it filters. Changes to the array still reach it.
      defaultItems={options}
      // `value` and `onChange` rather than the `selectedKey` pair React Aria
      // has deprecated: what this control holds is the chosen option, and the
      // text in the box is its own business.
      value={value}
      onChange={(key) => {
        onChange(key === null ? null : String(key));
      }}
      defaultFilter={matches}
      // The popover stays open with nothing in it, so that "no account is
      // called that" is an answer rather than a list that silently shuts.
      allowsEmptyCollection
      {...(isRequired === undefined ? {} : { isRequired })}
      {...(isDisabled === undefined ? {} : { isDisabled })}
      {...(errorMessage === undefined ? {} : { isInvalid: true })}
      validationBehavior="aria"
      className={clsx('group flex flex-col gap-[var(--vx-gap-xs)]', className)}
    >
      <Label className="text-footnote font-medium text-fg-secondary">{label}</Label>
      <Group
        className={clsx(
          'h-[var(--vx-h-control)] w-full rounded',
          'flex items-center',
          'bg-fill-field text-fg text-body',
          'border border-line-strong',
          // React Aria marks the combo box invalid, not the group inside it —
          // the same arrangement `Select` and `DateInput` read from their own.
          'group-data-[invalid]:border-line-danger',
          'group-data-[disabled]:text-fg-disabled group-data-[disabled]:cursor-not-allowed',
          'transition-[box-shadow,border-color] duration-[var(--vx-dur-snap)] ease-out',
          'data-[focus-within]:shadow-[var(--vx-focus-ring)]',
        )}
      >
        <Input
          {...(placeholder === undefined ? {} : { placeholder })}
          {...(autoFocus === undefined ? {} : { autoFocus })}
          className={clsx(
            'h-full min-w-0 flex-1 rounded bg-transparent px-[var(--vx-pad-md)]',
            'text-fg text-body outline-none',
            'placeholder:text-fg-muted',
            'disabled:text-fg-disabled disabled:cursor-not-allowed',
          )}
        />
        <AriaButton
          // Named here rather than left to React Aria's own bundled wording:
          // every sentence a person hears in this product comes from the
          // catalogue, where a tenant can rename it (§12, `SYS-08`).
          //
          // React Aria keeps it out of the tab order, and that is right here
          // where it was wrong for `TextInput`'s reveal control: the list is
          // already opened from the keyboard by `↓` on the field itself, so
          // this is a second route to a function the keyboard has, not the
          // only route to one it would otherwise lack (§11.1).
          aria-label={translator.format('combobox.showOptions')}
          className={clsx(
            'flex items-center justify-center rounded',
            'size-[var(--vx-h-control-nested)] me-[var(--vx-pad-xs)] shrink-0',
            '[&_svg]:size-[var(--vx-icon)] text-fg-muted hover:text-fg cursor-pointer',
            'disabled:text-fg-disabled disabled:cursor-not-allowed',
            focusRing,
          )}
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="fill-none stroke-current"
            strokeWidth="1.5"
          >
            <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </AriaButton>
      </Group>

      {description === undefined ? null : (
        <Text slot="description" className="text-footnote text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-footnote text-fg-danger">{errorMessage}</FieldError>

      <Popover
        className={clsx(
          'bg-surface-3 rounded-card border border-line shadow-lg',
          'min-w-(--trigger-width) max-h-[18rem] overflow-auto p-[var(--vx-pad-xs)]',
          // §8, over `dur-base` — see `Dialog` for why these are the classes.
          'transition-opacity duration-[var(--vx-dur-base)] ease-out starting:opacity-0',
          'data-[exiting]:opacity-0 data-[exiting]:ease-in',
        )}
      >
        {/* policy-exempt: §7.3 — focus stays in the input, which carries the
            ring; the listbox holds virtual focus and its items indicate it. */}
        <ListBox
          className="outline-none"
          renderEmptyState={() => (
            <p className="text-footnote text-fg-muted px-[var(--vx-pad-md)] py-[var(--vx-pad-sm)]">
              {emptyMessage}
            </p>
          )}
        >
          {(option: ComboboxOption) => (
            <ListBoxItem
              id={option.id}
              textValue={textOf(option)}
              {...(option.isDisabled === true ? { isDisabled: true } : {})}
              className={clsx(
                'flex min-h-[var(--vx-h-control)] items-center justify-between',
                'gap-[var(--vx-gap-md)] rounded px-[var(--vx-pad-md)]',
                'text-body text-fg cursor-pointer outline-none',
                'data-[focused]:bg-fill-ghost-hover',
                'data-[selected]:font-body-medium',
                'data-[disabled]:text-fg-disabled data-[disabled]:cursor-not-allowed',
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.detail === undefined ? null : (
                <span className="text-footnote text-fg-muted truncate">{option.detail}</span>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}

/** What an option is searched and filled in by: what identifies it, then what explains it. */
function textOf(option: ComboboxOption): string {
  return option.detail === undefined ? option.label : `${option.label} — ${option.detail}`;
}

/**
 * Folded for comparison: composed the one way (`NFC`), lower-cased, and
 * stripped of the marks Arabic may or may not be typed with.
 *
 * Two keyboards produce two different sequences of code points for one Arabic
 * word — a tatweel between letters, a fatha nobody typed on the other machine —
 * and a chart searched by a plain substring answers "nothing" about an account
 * that is sitting in front of the person asking.
 *
 * The vowel marks are matched by their Unicode category rather than by a range,
 * so this folds a Kurdish or Urdu name in a Syrian shop as readily as an Arabic
 * one. The tatweel is not a mark but a letter that means nothing, and it is
 * built from its code point rather than typed — a character that is invisible
 * between two letters is one nobody can see was put in the source (`format.ts`
 * takes the direction marks the same way).
 */
const TATWEEL = String.fromCodePoint(0x0640);

const MARKS = /[\p{Mn}\p{Me}]/gu;

function fold(value: string): string {
  return value.normalize('NFC').toLowerCase().replaceAll(MARKS, '').replaceAll(TATWEEL, '').trim();
}

function matches(textValue: string, inputValue: string): boolean {
  const wanted = fold(inputValue);
  return wanted === '' || fold(textValue).includes(wanted);
}
