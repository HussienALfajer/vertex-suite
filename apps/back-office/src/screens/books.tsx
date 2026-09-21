import { useCallback, useMemo, type ReactNode } from 'react';

import {
  money,
  toDate,
  type Currency,
  type CurrencyCode,
  type Instant,
  type LocalDate,
} from '@vertex/kernel';
import {
  Code,
  Money,
  Select,
  Switch,
  TextArea,
  TextInput,
  formatMoment,
  useTranslator,
  useVertex,
  type ComboboxOption,
  type SelectOption,
} from '@vertex/ui';
import { QUOTE_FORMS, type QuoteForm, type RateOverrideQuote } from '@vertex/fx/contract';
import type {
  Account,
  AccountId,
  AccountNode,
  Balance,
  EntrySource,
  LedgerAmount,
} from '@vertex/fin/contract';
import type { Branch } from '@vertex/sys/contract';

import { useCalendar } from '../calendar.js';
import { useChart } from '../chart.js';
import { useCurrencies } from '../currencies.js';
import { useOrganisation, useTenantZone } from '../organisation.js';

/**
 * What the five ledger screens share, and nothing else.
 *
 * `structure.tsx` is this file's counterpart for `SYS`'s screens, and the line
 * between them is the same one `modules.md` draws: what is here knows about
 * the books — an amount as the ledger stores it, a balance that reads on one
 * side or the other, an account named the way a statement names it, the span
 * a shop's books are open over. None of it knows about any one screen, and all
 * of it would be copied five times if it were not here.
 */

/**
 * An amount as the ledger keeps it (`LedgerAmount`), rendered as §12 requires:
 * with its currency, at its currency's precision, never as a bare figure.
 *
 * The currency comes from the tenant's own list, because the precision an
 * amount is written at is a property of the currency and not of the figure —
 * and a currency the tenant has withdrawn is still the currency of every
 * amount ever recorded in it, which is why the list this reads is the
 * withdrawn-inclusive one.
 *
 * A code the tenant does not have at all is a store answering for a currency
 * this shop never defined. It is shown as the exact figure it is, marked as
 * machine text, rather than hidden or rendered at a precision invented here:
 * the figure is the one fact still worth showing, and inventing a precision
 * for it would be the one thing §12 forbids.
 */
export function Figure({
  amount,
  className,
}: {
  readonly amount: LedgerAmount;
  readonly className?: string;
}): ReactNode {
  const currency = useCurrencyBook()(amount.currency);
  if (currency === null) {
    return (
      <Code {...(className === undefined ? {} : { className })}>
        {`${amount.amount} ${amount.currency}`}
      </Code>
    );
  }
  return (
    <Money
      value={money(amount.amount, amount.currency)}
      currency={currency}
      {...(className === undefined ? {} : { className })}
    />
  );
}

/**
 * A balance (`FIN-07`): the figure, and the side it reads on.
 *
 * The side is written beside the figure rather than implied by a column,
 * because which side a balance falls on is the one thing a reader is looking
 * for and it is **not** the account's normal side — an asset overdrawn reads
 * as a credit, and a statement that filed it under the side its kind usually
 * takes would be hiding exactly that. A balance of nothing has no side, and
 * says nothing about one.
 */
export function BalanceFigure({ balance }: { readonly balance: Balance }): ReactNode {
  const translator = useTranslator();
  return (
    <span className="inline-flex items-baseline gap-[var(--vx-gap-xs)] whitespace-nowrap">
      <Figure amount={balance.amount} />
      {balance.side === null ? null : (
        <span className="text-caption text-fg-muted">
          {translator.format(`entry.side.${balance.side}`)}
        </span>
      )}
    </span>
  );
}

/**
 * The tenant's currencies by code, withdrawn ones included.
 *
 * Withdrawn ones included because `FX` itself has no `remove`: every amount
 * ever recorded names its currency's code, and a figure whose currency has
 * since been taken out of use still has to be written at that currency's
 * precision.
 */
function useCurrencyBook(): (code: CurrencyCode) => Currency | null {
  const { currencies } = useCurrencies();
  // A scan rather than a map, on purpose: a tenant has a handful of currencies
  // (`FX-01`), every figure on a statement asks this, and building a map per
  // figure would cost more than the four comparisons it saves.
  return useMemo(
    () => (code: CurrencyCode) => currencies.find((one) => one.code === code) ?? null,
    [currencies],
  );
}

/** The chart, flat, with the two questions every ledger screen asks of it. */
interface AccountBook {
  /** Every account, depth first, which is the order the chart is read in. */
  readonly accounts: readonly Account[];
  readonly of: (id: AccountId) => Account | null;
  /** An account's own name (`design-system.md` §12), or the word for an unknown one. */
  readonly nameOf: (id: AccountId) => string;
}

function useAccountBook(): AccountBook {
  const translator = useTranslator();
  const { tree } = useChart();

  const accounts = useMemo(() => flatten(tree), [tree]);
  const byId = useMemo(() => new Map(accounts.map((one) => [one.id, one] as const)), [accounts]);

  return useMemo(
    () => ({
      accounts,
      of: (id) => byId.get(id) ?? null,
      nameOf: (id) => {
        const account = byId.get(id);
        return account === undefined
          ? translator.format('data.unknown')
          : nameOfAccount(translator, account);
      },
    }),
    [accounts, byId, translator],
  );
}

/**
 * An account's own name: what the tenant typed, or the terminology layer's word
 * for a seeded one nobody has renamed (`design-system.md` §12).
 *
 * The same arrangement `roleLabel` uses for `SEC-01`'s seven seeded roles, and
 * for the same reason: a seeded record carries no sentence of its own, so that
 * a tenant renames a concept once rather than editing thirty-three rows.
 */
export function nameOfAccount(
  translator: ReturnType<typeof useTranslator>,
  account: Account,
): string {
  if (account.name !== null) return account.name;
  if (account.seeded === null) return translator.format('data.unknown');
  const key = `account.${account.seeded}`;
  return translator.has(key) ? translator.format(key) : translator.format('data.unknown');
}

/** Every account in the tree, depth first: the order `FIN-01` keeps the chart in. */
export function flatten(nodes: readonly AccountNode[]): readonly Account[] {
  return nodes.flatMap((node) => [node.account, ...flatten(node.children)]);
}

/**
 * Every **leaf** of the chart — the accounts a line lands in, since a group is
 * only ever the sum of what is beneath it.
 *
 * `in-use` is what a screen that **writes** offers: a leaf still in use is
 * `FIN`'s own rule about where a line may go (`resolve` returns only an
 * account a posting may land in), so offering anything else would be offering
 * somebody a choice that ends in `fin.account-has-children` or
 * `fin.account-inactive`. The module still judges what arrives: a chart can
 * change between this list being built and the entry being recorded.
 *
 * `all` is what a screen that **reads** offers. An account withdrawn last
 * month still has every line ever posted to it, and a ledger whose chooser
 * could not name it would be a chooser that hides a year of one account's
 * books — the reason `BranchFilter` names withdrawn branches too.
 */
export function useLeafAccounts(including: 'in-use' | 'all' = 'in-use'): readonly Account[] {
  const { tree } = useChart();
  return useMemo(() => leaves(tree, including === 'all'), [tree, including]);
}

function leaves(nodes: readonly AccountNode[], withdrawnToo: boolean): readonly Account[] {
  return nodes.flatMap((node) =>
    node.children.length === 0
      ? node.account.active || withdrawnToo
        ? [node.account]
        : []
      : leaves(node.children, withdrawnToo),
  );
}

/** An account as a chooser offers one: its code, explained by its name. */
export function accountOptions(
  translator: ReturnType<typeof useTranslator>,
  accounts: readonly Account[],
): readonly ComboboxOption[] {
  return accounts.map((account) => ({
    id: account.id,
    label: account.code,
    detail: nameOfAccount(translator, account),
  }));
}

/**
 * A rate typed over the day's (`FX-06`), as the two screens that write an
 * amount in another currency offer it.
 *
 * Off by default and revealed by a switch, because the day's rate is what
 * almost every figure should take: an override is the exception, it is logged
 * under `FX`'s own right, and a screen that put three fields in front of
 * everybody would be inviting one.
 *
 * The rate is **one figure** and not a buy and a sell, because a single amount
 * is being valued in one direction: `FX-06` takes the side from what the
 * figure is — a debit on a monetary account is money received and takes the
 * buy, a credit is money paid out and takes the sell — so there is nothing
 * here for a second figure to be.
 */
export interface OverrideDraft {
  readonly form: QuoteForm;
  readonly rate: string;
  readonly reason: string;
}

const BLANK_OVERRIDE: OverrideDraft = Object.freeze({
  form: 'units-per-functional',
  rate: '',
  reason: '',
});

/** What the domain takes, or null where nothing is being overridden. */
export function overrideQuoteOf(draft: OverrideDraft | null): RateOverrideQuote | null {
  if (draft === null) return null;
  return { form: draft.form, rate: draft.rate.trim(), reason: draft.reason.trim() };
}

export interface RateOverrideFieldsProps {
  readonly currency: CurrencyCode;
  readonly functional: CurrencyCode;
  /** Null while the day's rate is being used, which is the default. */
  readonly value: OverrideDraft | null;
  readonly onChange: (next: OverrideDraft | null) => void;
  /** Which of the two fields the screen has just marked as left blank. */
  readonly missing?: { readonly rate: boolean; readonly reason: boolean };
}

export function RateOverrideFields({
  currency,
  functional,
  value,
  onChange,
  missing,
}: RateOverrideFieldsProps): ReactNode {
  const translator = useTranslator();

  return (
    <div className="flex flex-col gap-[var(--vx-gap-sm)]">
      <Switch
        isSelected={value !== null}
        onChange={(on) => {
          onChange(on ? BLANK_OVERRIDE : null);
        }}
      >
        {translator.format('override.use')}
      </Switch>
      {value === null ? null : (
        <div className="flex flex-col gap-[var(--vx-gap-sm)]">
          <Select
            label={translator.format('override.form')}
            options={QUOTE_FORMS.map((form) => ({
              id: form,
              label: translator.format(`rate.quoteForm.${form}`, { currency, functional }),
            }))}
            value={value.form}
            onChange={(key) => {
              const next = String(key);
              const form = QUOTE_FORMS.find((one) => one === next);
              if (form !== undefined) onChange({ ...value, form });
            }}
          />
          <TextInput
            label={translator.format('override.rate')}
            value={value.rate}
            onChange={(rate) => {
              onChange({ ...value, rate });
            }}
            isMachineText
            isRequired
            {...(missing?.rate === true
              ? { errorMessage: translator.format('override.rate.required') }
              : {})}
          />
          <TextArea
            label={translator.format('override.reason')}
            description={translator.format('override.reason.description')}
            value={value.reason}
            onChange={(reason) => {
              onChange({ ...value, reason });
            }}
            rows={2}
            isRequired
            {...(missing?.reason === true
              ? { errorMessage: translator.format('override.reason.required') }
              : {})}
          />
        </div>
      )}
    </div>
  );
}

/** An account written as a statement writes one: its code, then its name. */
export function AccountName({ id }: { readonly id: AccountId }): ReactNode {
  const book = useAccountBook();
  const account = book.of(id);
  return (
    <span className="inline-flex min-w-0 items-baseline gap-[var(--vx-gap-sm)]">
      {account === null ? null : <Code className="text-fg-secondary shrink-0">{account.code}</Code>}
      <span className="truncate">{book.nameOf(id)}</span>
    </span>
  );
}

/**
 * What an entry is called when nobody wrote it a description: the event it
 * records, in the words this application has for the three kinds `FIN` posts
 * on its own account.
 *
 * Every other kind is another module's — `pos.sale`, `pur.goods-receipt` —
 * and `FIN` never learns what one means (`EntrySource`: a ledger that knew
 * the sixteen kinds of `FIN-02` would be welded to sixteen modules). This
 * application does not learn either: a kind it has no word for is shown as the
 * machine text it is, and gains a word here when the module that posts it
 * arrives with its own screens.
 */
export function useEntryTitle(): (source: EntrySource, description: string | null) => ReactNode {
  const translator = useTranslator();
  return useMemo(
    () => (source, description) => {
      if (description !== null && description.trim() !== '') return description;
      const key = `entry.kind.${source.kind}`;
      return translator.has(key) ? (
        translator.format(key)
      ) : (
        <Code className="text-fg-secondary">{source.kind}</Code>
      );
    },
    [translator],
  );
}

/**
 * Writes a moment for the sentences on the ledger screens, in the tenant's own zone.
 *
 * `Instant` is a count of milliseconds, so a message that interpolated one
 * would print the count — which is how the fiscal-calendar screen once read. It goes through
 * `formatMoment` and not through `<DateTime>` for §12's own reason: these are
 * moments **inside** a sentence, and ICU interpolates text, so a message broken
 * into fragments around an element would have had its word order decided here
 * rather than by whoever translates it.
 *
 * The zone is the tenant's rather than any branch's, because the books are the
 * tenant's: a period closed, an entry that arrived late, a decision taken on
 * one — none of them belongs to a single branch (`FIN-05`) — see `useTenantZone`. `formatMoment`
 * names it in the text, so a reader elsewhere is not left guessing whose
 * afternoon this was.
 */
export function useMomentWriter(): (at: Instant) => string {
  const { formattingLocale } = useVertex();
  const timeZone = useTenantZone();
  return useCallback(
    (at: Instant) => formatMoment(toDate(at), { locale: formattingLocale, timeZone }),
    [formattingLocale, timeZone],
  );
}

/** Stands for "every branch", where a filter offers one branch or all of them. */
export const EVERY_BRANCH = '*';

/**
 * The branch filter the ledger screens share.
 *
 * Unlike `scope.tsx`, which exists because `SYS` and `FX` answer per branch and
 * the screen assembles the aggregate itself, every read here takes a branch or
 * takes none: the books are the tenant's, a branch is a fact of the **entry**
 * and not of its lines, and `FIN` subtotals whole entries by branch on its own
 * (`StatementScope`). So this is one chooser over one read, and nothing here
 * goes into the address — the address on these screens names the entry being
 * read, which is the record on screen.
 */
export function BranchFilter({
  label,
  allLabel,
  value,
  onChange,
  className,
}: {
  readonly label: string;
  readonly allLabel: string;
  readonly value: string;
  readonly onChange: (branch: string) => void;
  readonly className?: string;
}): ReactNode {
  const { branches } = useOrganisation();
  return (
    <Select
      label={label}
      options={branchOptions(allLabel, branches)}
      value={value}
      onChange={(key) => {
        onChange(String(key));
      }}
      {...(className === undefined ? {} : { className })}
    />
  );
}

function branchOptions(allLabel: string, branches: readonly Branch[]): readonly SelectOption[] {
  return [
    { id: EVERY_BRANCH, label: allLabel },
    // Withdrawn branches included: a shop that closed last year still has
    // every entry it ever posted, and a filter that could not name it would
    // be a filter that hides a year of books.
    ...branches.map((one) => ({ id: one.id, label: one.name })),
  ];
}

/** A branch's name, for a row that names its branch by identifier. */
export function useBranchName(): (id: Branch['id']) => string {
  const translator = useTranslator();
  const { branches } = useOrganisation();
  const byId = useMemo(() => new Map(branches.map((one) => [one.id, one] as const)), [branches]);
  return useMemo(
    () => (id) => byId.get(id)?.name ?? translator.format('data.unknown'),
    [byId, translator],
  );
}

/** A span of days, as every ledger screen filters by one. */
export interface Span {
  readonly from: LocalDate | null;
  readonly to: LocalDate | null;
}

/**
 * The span the ledger screens open on: the last fiscal year the calendar
 * defines.
 *
 * **Derived from the books rather than from a clock**, which is the only
 * honest source available here. Nothing in this application may read the
 * device's own time (`README.md`: a register runs for years on a machine whose
 * clock nobody checks), and the port offers no moment — so "this year" is
 * taken to be the last year the accountant has defined, which is the year the
 * seed installs and the one `append` extends the calendar to. A person
 * reading another year changes the two fields, and the span is echoed on
 * whatever they are reading (`StatementScope`) so a printed page always says
 * what it covers.
 *
 * Both are null for a tenant whose calendar has not arrived yet, which is a
 * screen still loading rather than a shop with no books.
 */
export function useBooksYear(): Span {
  const { years } = useCalendar();
  return useMemo(() => {
    const last = years.at(-1);
    return last === undefined
      ? { from: null, to: null }
      : { from: last.opensOn, to: last.closesOn };
  }, [years]);
}
