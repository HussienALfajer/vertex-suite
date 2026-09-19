import { useId, useMemo, useState, type ReactNode } from 'react';

import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Dialog,
  SearchInput,
  Select,
  Switch,
  TextInput,
  useAttempt,
  useTranslator,
  type SelectOption,
} from '@vertex/ui';
import type { Role } from '@vertex/sec/contract';
import type { Branch } from '@vertex/sys/contract';

import { useOrganisation, type Loaded } from '../organisation.js';

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
 * Stands for "every company" in a company filter. No identifier can collide
 * with it. Declared once, because the branches screen and every scoped screen
 * (`scope.tsx`) narrow by company and must agree on the value that means
 * "don't".
 */
export const EVERY_COMPANY = '*';

export interface StatusBadgeProps {
  readonly isActive: boolean;
  /**
   * Why a row that is itself in use cannot actually be used — its branch is
   * withdrawn, or its company is. `SYS` does not cascade a withdrawal
   * (`packages/modules/sys/src/structure.ts`), so this cannot be read off
   * `isActive`: withdrawing a branch leaves every till in it marked in use.
   * Undefined where nothing above the row can strand it — a company, a
   * currency, a user, a role.
   *
   * Said in full, as the badge's own words, so a column of them is read
   * without hovering each one; `STATUS_COLUMN_WIDTH` is what gives it room.
   */
  readonly disabledReason?: string | undefined;
}

/**
 * Whether a row is in use, said in words as well as in colour.
 *
 * `SYS-09` deactivates and never deletes, so "withdrawn" is a state a row
 * spends years in and not an error — which is why it is the quiet neutral
 * rather than the danger tone. Danger here would have an administrator
 * searching for a problem that is not there.
 *
 * A third state sits between the two: **active, and stranded.** The warning
 * tone is deliberate and different from both neighbours — neutral would bury
 * a row that cannot actually trade beside every ordinary withdrawn one, and
 * success would tell an administrator a till is ready when nothing can be
 * sold from it until its own branch comes back.
 */
export function StatusBadge({ isActive, disabledReason }: StatusBadgeProps): ReactNode {
  const translator = useTranslator();
  if (isActive && disabledReason !== undefined) {
    return <Badge tone="warning">{disabledReason}</Badge>;
  }
  return isActive ? (
    <Badge tone="success">{translator.format('status.inUse')}</Badge>
  ) : (
    <Badge tone="neutral">{translator.format('status.withdrawn')}</Badge>
  );
}

/**
 * How wide a status column is, so `StatusBadge`'s longest sentence — "متوقف —
 * الشركة مسحوبة من الخدمة" — fits at the badge's caption size without the
 * table's fixed layout starving it. `actionsColumnWidth`'s reasoning, for the
 * one other column whose content cannot be shortened; a screen too narrow
 * for every column scrolls rather than clips one.
 */
export const STATUS_COLUMN_WIDTH = 230;

/**
 * `StatusBadge`'s `disabledReason` for a row, given what is above it — its
 * ancestors nearest first, each with the sentence that says it is withdrawn.
 *
 * The nearest withdrawn one speaks: a till whose own branch is withdrawn says
 * so, rather than naming the branch's company because that check came first.
 * The caller looks the ancestors up, because what "above" means differs by
 * screen — a company over a branch, a branch and then its company over a
 * till — and this has no business knowing either shape.
 */
export function parentWithdrawalNotice(
  ...ancestors: readonly (readonly [
    parent: { readonly active: boolean } | undefined,
    message: string,
  ])[]
): string | undefined {
  for (const [parent, message] of ancestors) {
    if (parent !== undefined && !parent.active) return message;
  }
  return undefined;
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

/**
 * A role's own name — what a tenant typed, or the terminology layer's word for
 * one of `SEC-01`'s seven while nobody has renamed it.
 *
 * Shared by `Users.tsx`'s scope dialog and `Roles.tsx`, which both render the
 * same `Role` records from opposite sides of the same assignment.
 */
export function roleLabel(translator: ReturnType<typeof useTranslator>, role: Role): string {
  if (role.name !== null) return role.name;
  return role.seeded === null
    ? translator.format('data.unknown')
    : translator.format(`role.${role.seeded}`);
}

/**
 * Every named branch, joined the way the locale in force joins a list —
 * `Intl.ListFormat` rather than a written-out separator, which §12 refuses in
 * code: even a comma is a choice a locale makes, and Arabic's is not a Latin
 * one followed by a space.
 *
 * Shared by `Users.tsx`'s scope dialog and `Roles.tsx`'s holders section: both
 * say the same sentence about a confinement, one from the user's side and one
 * from the role's, and a confinement reads on screen the same way from either.
 */
export function branchNames(
  formattingLocale: string,
  branches: readonly Branch[],
  ids: readonly Branch['id'][],
): string {
  const named = ids.map((id) => branches.find((one) => one.id === id)?.name ?? id);
  return new Intl.ListFormat(formattingLocale, { style: 'long', type: 'conjunction' }).format(
    named,
  );
}

export interface ReachFieldsProps {
  readonly branches: readonly Branch[];
  readonly reach: 'tenant' | 'branches';
  readonly onReachChange: (reach: 'tenant' | 'branches') => void;
  readonly chosenBranches: ReadonlySet<string>;
  readonly onChosenBranchesChange: (chosen: ReadonlySet<string>) => void;
  readonly branchesMissing: boolean;
}

/**
 * `SEC-04`'s reach, picked the same way wherever an assignment is made: every
 * branch, or a chosen few. `Users.tsx`'s scope dialog fixes the role and picks
 * among users; `Roles.tsx`'s holders section fixes the role and picks among
 * users the other way round — both then ask this exact question, so it is
 * asked once. `Confinement`'s own further narrowing, to specific locations
 * within a branch, is not offered here yet for the reason `ScopeDialog`
 * already gave: a control is built with the screen that first needs it.
 */
export function ReachFields({
  branches,
  reach,
  onReachChange,
  chosenBranches,
  onChosenBranchesChange,
  branchesMissing,
}: ReachFieldsProps): ReactNode {
  const translator = useTranslator();
  const activeBranches = useMemo(() => branches.filter((one) => one.active), [branches]);
  const reachOptions: readonly SelectOption[] = [
    { id: 'tenant', label: translator.format('users.scope.tenantWide') },
    { id: 'branches', label: translator.format('users.scope.someBranches') },
  ];

  return (
    <>
      <Select
        label={translator.format('users.scope.reach')}
        options={reachOptions}
        value={reach}
        onChange={(key) => {
          onReachChange(key === 'branches' ? 'branches' : 'tenant');
        }}
      />
      {reach === 'branches' ? (
        <div className="flex flex-col gap-[var(--vx-gap-xs)]">
          {activeBranches.map((branch) => (
            <Checkbox
              key={branch.id}
              isSelected={chosenBranches.has(branch.id)}
              onChange={(isSelected) => {
                const next = new Set(chosenBranches);
                if (isSelected) next.add(branch.id);
                else next.delete(branch.id);
                onChosenBranchesChange(next);
              }}
            >
              {branch.name}
            </Checkbox>
          ))}
          {branchesMissing ? (
            <p className="text-footnote text-fg-danger">
              {translator.format('users.scope.branches.required')}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export interface RoleReachFieldsProps {
  /** Already filtered to the active ones — a withdrawn role is nothing to assign. */
  readonly roles: readonly Role[];
  readonly selectedRoleIds: ReadonlySet<string>;
  readonly onSelectedRoleIdsChange: (ids: ReadonlySet<string>) => void;
  /**
   * Roles this user already holds some assignment of — marked rather than
   * hidden or disabled. Re-selecting one is not a mistake: `RoleAdministration`
   * states it plainly — "assigning a role the user already holds replaces its
   * confinement" — so it is the way this screen offers to widen or narrow an
   * existing assignment's reach without withdrawing it first. Hiding the option
   * would remove that; this only tells whoever is choosing what they are about
   * to do.
   */
  readonly heldRoleIds: ReadonlySet<string>;
  readonly rolesMissing: boolean;
  readonly branches: readonly Branch[];
  readonly reach: 'tenant' | 'branches';
  readonly onReachChange: (reach: 'tenant' | 'branches') => void;
  readonly chosenBranches: ReadonlySet<string>;
  readonly onChosenBranchesChange: (chosen: ReadonlySet<string>) => void;
  readonly branchesMissing: boolean;
}

/**
 * Roles and where they reach, asked together — `SEC-01` and `SEC-04` in the
 * same breath, for whichever screen has already fixed the **user** and is
 * choosing what to give them. `Users.tsx`'s scope dialog and the enrolment
 * wizard's second step both ask exactly this; `Roles.tsx`'s holders section
 * asks the mirror question (a role fixed, a user chosen) and keeps its own
 * `Select`, since a user picker is not this one with its options swapped.
 *
 * **Several roles, one reach.** A checkbox list rather than `Select`, the same
 * device `ReachFields` already uses for "a chosen few" branches, so choosing
 * three roles at once for the same stretch of the shop group is one screen
 * rather than three round trips through this dialog. A role that needs a
 * *different* reach from the others is still its own, separate assignment —
 * this asks for one reach applied to everything checked here, not a second
 * axis of choice.
 */
export function RoleReachFields({
  roles,
  selectedRoleIds,
  onSelectedRoleIdsChange,
  heldRoleIds,
  rolesMissing,
  branches,
  reach,
  onReachChange,
  chosenBranches,
  onChosenBranchesChange,
  branchesMissing,
}: RoleReachFieldsProps): ReactNode {
  const translator = useTranslator();
  const labelId = useId();
  const errorId = useId();

  return (
    <>
      {/* Marked invalid the way every field is, so a refused submit moves
          focus here (`reportInvalid`) and the error is read with the group. */}
      <div
        className="flex flex-col gap-[var(--vx-gap-xs)]"
        {...(rolesMissing ? { 'data-invalid': true } : {})}
      >
        <p id={labelId} className="text-footnote font-medium text-fg-secondary">
          {translator.format('users.scope.role')}
        </p>
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={rolesMissing ? errorId : undefined}
          className="flex flex-col gap-[var(--vx-gap-xs)]"
        >
          {roles.map((role) => (
            <Checkbox
              key={role.id}
              isSelected={selectedRoleIds.has(role.id)}
              onChange={(isSelected) => {
                const next = new Set(selectedRoleIds);
                if (isSelected) next.add(role.id);
                else next.delete(role.id);
                onSelectedRoleIdsChange(next);
              }}
            >
              <span className="inline-flex items-center gap-[var(--vx-gap-sm)]">
                {roleLabel(translator, role)}
                {heldRoleIds.has(role.id) ? (
                  <Badge tone="neutral">{translator.format('users.scope.role.alreadyHeld')}</Badge>
                ) : null}
              </span>
            </Checkbox>
          ))}
        </div>
        {rolesMissing ? (
          <p id={errorId} className="text-footnote text-fg-danger">
            {translator.format('users.scope.role.required')}
          </p>
        ) : null}
      </div>
      <ReachFields
        branches={branches}
        reach={reach}
        onReachChange={onReachChange}
        chosenBranches={chosenBranches}
        onChosenBranchesChange={onChosenBranchesChange}
        branchesMissing={branchesMissing}
      />
    </>
  );
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
    formRef,
    reportInvalid,
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
      reportInvalid();
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
        ref={formRef}
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
 * What a screen shows for a read that has not answered, or cannot.
 *
 * Every per-record read on these screens — a branch's locations and tills, a
 * person's roles, a role's holders, a series' specimen — once rendered nothing
 * while it waited and nothing when it failed. Nothing is the one answer that is
 * worse than either: a person was told they held no role when the question had
 * never been answered, and granted one on that basis.
 */
export function ReadState({ loaded }: { readonly loaded: Loaded<unknown> }): ReactNode {
  const translator = useTranslator();
  if (loaded.unreachable) {
    return (
      <Banner
        tone="warning"
        title={translator.format('data.unreachable')}
        actions={<Button onPress={loaded.reload}>{translator.format('action.retry')}</Button>}
      >
        {translator.format('data.unreachable.explanation')}
      </Banner>
    );
  }
  if (loaded.isLoading && loaded.value === null) {
    return (
      <p role="status" className="text-body text-fg-muted">
        {translator.format('data.loading')}
      </p>
    );
  }
  return null;
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

/** A shield with a keyhole: the security dialog — a password and the sessions behind it. */
export function SecurityIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path d="M10 2.5l6 2.5v4.5c0 4-2.5 6.7-6 7.9-3.5-1.2-6-3.9-6-7.9V5z" strokeLinejoin="round" />
      <circle cx="10" cy="9.5" r="1.5" />
      <path d="M10 11v2.2" strokeLinecap="round" />
    </svg>
  );
}

/** A badge on a ribbon: the role a person is trusted with, and where it reaches. */
export function ScopeIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <circle cx="10" cy="7" r="4" />
      <path d="M7.5 10.3L6 17.5l4-2 4 2-1.5-7.2" strokeLinejoin="round" />
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

/** A pin, which is what a map marker looks like everywhere a person has seen one. */
export function PlaceIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path d="M10 17.5s5.5-5 5.5-9a5.5 5.5 0 10-11 0c0 4 5.5 9 5.5 9z" strokeLinejoin="round" />
      <circle cx="10" cy="8.5" r="2" />
    </svg>
  );
}

/** Two arrows crossing in opposite directions: one currency traded for another. */
export function RateIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path d="M4 7h10.5M12 4.2L14.7 7 12 9.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 13H5.5M8 10.2L5.3 13 8 15.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A sheet with lines on it: the profile a document is printed from. */
export function ProfileIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path d="M5 2.5h6.5L16 7v10.5H5z" strokeLinejoin="round" />
      <path d="M11 2.5V7h4.5M7.5 10.5h5M7.5 13.5h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
