import { useState, type ReactNode } from 'react';

import {
  Badge,
  Banner,
  Button,
  Dialog,
  SearchInput,
  Switch,
  TextInput,
  useAttempt,
  useTranslator,
} from '@vertex/ui';

import { useOrganisation } from '../organisation.js';

/**
 * What the four structural screens of `SYS-09` have in common.
 *
 * Companies, branches, locations and registers are the same shape of thing four
 * times over: a named row that is in use or withdrawn, found in a list, renamed
 * in place, and taken out of use without ever being deleted. The parts of that
 * which are identical live here, and what differs — the columns, the fields a
 * new one needs, where a row leads — stays in the screen it belongs to.
 *
 * Nothing here is a control. Every one is assembled out of what `packages/ui`
 * publishes and each knows something this application knows — a refusal of
 * `SYS`, a key out of this catalogue — which is what makes this the right
 * altitude for them and the design system the wrong one.
 */

/**
 * Whether a row is in use, said in words as well as in colour.
 *
 * `SYS-09` deactivates and never deletes, so "withdrawn" is a state a row
 * spends years in and not an error — which is why it is the quiet neutral
 * rather than the danger tone. Danger here would have an administrator
 * searching for a problem that is not there.
 */
export function StatusBadge({ isActive }: { readonly isActive: boolean }): ReactNode {
  const translator = useTranslator();
  return isActive ? (
    <Badge tone="success">{translator.format('status.inUse')}</Badge>
  ) : (
    <Badge tone="neutral">{translator.format('status.withdrawn')}</Badge>
  );
}

export interface ListingBarProps {
  readonly searchLabel: string;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly includeWithdrawn: boolean;
  readonly onIncludeWithdrawn: (include: boolean) => void;
  /** A filter only one screen has — the company a branch belongs to, the branch a location is in. */
  readonly children?: ReactNode;
}

/**
 * The row of controls above a list.
 *
 * The switch rather than a checkbox: it changes what is on screen the moment it
 * is moved, and a checkbox promises a form that has yet to be saved.
 */
export function ListingBar({
  searchLabel,
  query,
  onQuery,
  includeWithdrawn,
  onIncludeWithdrawn,
  children,
}: ListingBarProps): ReactNode {
  const translator = useTranslator();
  return (
    <div className="flex flex-wrap items-end justify-between gap-[var(--vx-gap-md)]">
      <div className="flex flex-wrap items-end gap-[var(--vx-gap-md)]">
        <SearchInput
          label={searchLabel}
          placeholder={searchLabel}
          value={query}
          onChange={onQuery}
          className="w-[18rem] max-w-full"
        />
        {children}
      </div>
      <Switch isSelected={includeWithdrawn} onChange={onIncludeWithdrawn}>
        {translator.format('listing.includeWithdrawn')}
      </Switch>
    </div>
  );
}

/**
 * Whether a row survives what was typed into the search field.
 *
 * Folded the way `SYS` folds a name before deciding two are the same one:
 * Arabic is written with combining marks that two keyboards encode differently,
 * so a search that compared bytes would hide a branch from the person who named
 * it. Nothing typed means everything matches.
 */
export function matchesQuery(name: string, query: string): boolean {
  const fold = (value: string): string => value.normalize('NFC').trim().toLowerCase();
  const wanted = fold(query);
  return wanted === '' || fold(name).includes(wanted);
}

export interface NameDialogProps {
  readonly title: string;
  readonly label: string;
  readonly description?: string;
  readonly submitLabel: string;
  /** What the field starts with: the current name when renaming, nothing when creating. */
  readonly initialName?: string;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /**
   * Returns the message to show **inside the dialog**, or null once it worked.
   *
   * A refusal belongs where the field that caused it is: a name already taken
   * is corrected by typing, and a dialog that closed and left a message behind
   * it on the page would make somebody reopen it to fix what it said.
   */
  readonly onSubmit: (name: string) => Promise<string | null>;
}

/** Naming something, or renaming it: one field, and the refusal beside it. */
export function NameDialog({
  title,
  label,
  description,
  submitLabel,
  initialName = '',
  isOpen,
  onOpenChange,
  onSubmit,
}: NameDialogProps): ReactNode {
  const translator = useTranslator();
  const [name, setName] = useState(initialName);
  const [isMissing, setIsMissing] = useState(false);
  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(isOpen, () => {
    setName(initialName);
    setIsMissing(false);
  });

  async function attempt(): Promise<void> {
    if (isWorking) return;

    // Answered from this catalogue rather than left to the browser, which would
    // write the message itself in its own language under an Arabic label (§12).
    if (name.trim() === '') {
      setIsMissing(true);
      setRefused(null);
      return;
    }

    await attemptWith(async () => {
      const message = await onSubmit(name.trim());
      if (message === null) onOpenChange(false);
      return message;
    });
  }

  return (
    <Dialog
      title={title}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      footer={
        <>
          <Button
            tone="secondary"
            onPress={() => {
              onOpenChange(false);
            }}
          >
            {translator.format('action.cancel')}
          </Button>
          <Button
            tone="primary"
            isDisabled={isWorking}
            onPress={() => {
              void attempt();
            }}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          // §11.1 has Enter submit the form somebody is standing in, rather than
          // navigating the document away from it.
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <TextInput
          label={label}
          value={name}
          onChange={(next) => {
            setName(next);
            setIsMissing(false);
          }}
          autoFocus
          isRequired
          {...(description === undefined ? {} : { description })}
          {...(isMissing ? { errorMessage: translator.format('name.required') } : {})}
        />
        {/* The form needs a submit control for Enter to mean anything, and the
            one a person clicks is in the footer where a dialog's actions belong. */}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

/**
 * The banner a screen shows when the structure on it may be out of date.
 *
 * It says so rather than showing nothing, because a stale list and an empty
 * shop look identical and call for opposite reactions.
 */
export function StaleBanner(): ReactNode {
  const translator = useTranslator();
  const { unreachable, reload } = useOrganisation();
  if (!unreachable) return null;

  return (
    <Banner
      tone="warning"
      title={translator.format('data.unreachable')}
      actions={<Button onPress={reload}>{translator.format('action.retry')}</Button>}
    >
      {translator.format('data.unreachable.explanation')}
    </Banner>
  );
}

const iconClasses = 'fill-none stroke-current';

/** A nib over a line: an object rather than a direction, so §9 leaves it unmirrored. */
export function RenameIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path d="M12.5 4.5l3 3L7 16H4v-3z" strokeLinejoin="round" />
      <path d="M11 6l3 3" strokeLinecap="round" />
    </svg>
  );
}

/** A box with its lid closing: what withdrawing from use looks like, not a bin. */
export function WithdrawIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <rect x="2.5" y="4" width="15" height="3.5" rx="1" />
      <path d="M4 7.5v7a1.5 1.5 0 001.5 1.5h9a1.5 1.5 0 001.5-1.5v-7" strokeLinejoin="round" />
      <path d="M8 11h4" strokeLinecap="round" />
    </svg>
  );
}

/** The same box, opening again. */
export function RestoreIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <rect x="2.5" y="8" width="15" height="3.5" rx="1" />
      <path d="M4 11.5v3.5a1.5 1.5 0 001.5 1.5h9a1.5 1.5 0 001.5-1.5v-3.5" strokeLinejoin="round" />
      <path d="M10 6V2.5M10 2.5L8 4.5M10 2.5l2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A list inside a frame: where a row leads, without pointing anywhere. */
export function OpenListIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <rect x="3" y="3.5" width="14" height="13" rx="2" />
      <path d="M6.5 8h7M6.5 11.5h4.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A machine with a plug trailing from it: the thing standing at the till, which
 * is not the till. Unmirrored — §9 mirrors direction, and this depicts an object.
 */
export function DeviceIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <rect x="3" y="3" width="14" height="9" rx="1.5" />
      <path d="M10 12v3M6.5 17.5h7" strokeLinecap="round" />
    </svg>
  );
}

/** Braces around a line: a shape a value is poured into, which is what a format is. */
export function FormatIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path
        d="M7.5 4.5c-2 0-2 2.2-2 3.5s-.8 2-2 2c1.2 0 2 .7 2 2s0 3.5 2 3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 4.5c2 0 2 2.2 2 3.5s.8 2 2 2c-1.2 0-2 .7-2 2s0 3.5-2 3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 8.5v3" strokeLinecap="round" />
    </svg>
  );
}

/** A sheet with lines on it: the profile a document is printed from. */
/** A pin, which is what a map marker looks like everywhere a person has seen one. */
export function PlaceIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path d="M10 17.5s5.5-5 5.5-9a5.5 5.5 0 10-11 0c0 4 5.5 9 5.5 9z" strokeLinejoin="round" />
      <circle cx="10" cy="8.5" r="2" />
    </svg>
  );
}

export function ProfileIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path d="M5 2.5h6.5L16 7v10.5H5z" strokeLinejoin="round" />
      <path d="M11 2.5V7h4.5M7.5 10.5h5M7.5 13.5h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
