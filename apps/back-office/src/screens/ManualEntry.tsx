import { useMemo, useRef, useState, type ReactNode } from 'react';

import {
  add,
  compare,
  newId,
  subtract,
  zero,
  type CurrencyCode,
  type LocalDate,
  type Money,
} from '@vertex/kernel';
import {
  ATTACHMENT_MEDIA_TYPES,
  ATTACHMENT_SIZE_LIMIT,
  CONTROL_ACCOUNTS,
  ENTRY_SIDES,
  type AccountId,
  type EntrySide,
  type JournalEntryId,
  type ManualLine,
  type Posted,
} from '@vertex/fin/contract';
import type { TenantCurrency } from '@vertex/fx/contract';
import {
  AttachmentInput,
  Banner,
  Button,
  Code,
  Combobox,
  DateInput,
  IconButton,
  MoneyInput,
  PageHeader,
  Panel,
  Select,
  TextArea,
  TextInput,
  useAttempt,
  useToast,
  useTranslator,
  type ChosenFile,
  type SelectOption,
} from '@vertex/ui';

import { useCurrencies } from '../currencies.js';
import { useLedger } from '../ledger.js';
import { useDeliveryMessage, useOrganisation } from '../organisation.js';
import { useNavigateTo } from '../routing.js';
import {
  accountOptions,
  Figure,
  overrideQuoteOf,
  RateOverrideFields,
  useBooksYear,
  useLeafAccounts,
  type OverrideDraft,
} from './books.js';
import { RemoveIcon } from './structure.js';

/**
 * `FIN-04`: the accountant's own entry, written by hand.
 *
 * **A screen and not a dialog**, because that is what the feature asks for and
 * because an adjusting entry is not one field: it is a day, a branch, words
 * that have to be there, a set of lines that have to come to the same figure
 * on both sides, and the evidence for all of it. A dialog would put that
 * behind a scroll bar inside a scrim.
 *
 * **Everything the engine would refuse, this makes unreachable where it can.**
 * The accounts offered are leaves in use (`useLeafAccounts`) with the control
 * accounts taken out — inventory, cash, receivables and payables are kept by
 * the documents that move them (`CONTROL_ACCOUNTS`), and a line written onto
 * one by hand is a figure the subledger knows nothing about for ever. Amounts
 * are `MoneyInput`s, so nothing finer than the currency can be typed. What
 * remains — the two sides coming to the same figure, the day falling in an
 * open period — is judged by `FIN`, because a chart and a calendar can both
 * change between this form being filled in and the entry being recorded.
 *
 * **The identifier is minted here, once per draft.** `ManualEntry.id` is the
 * caller's, so that a submission a wire delivers twice makes one entry: a
 * refusal keeps the same identifier, and only an entry that was actually
 * posted starts a new one.
 */
export function ManualEntry(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const goTo = useNavigateTo();
  const { journal, run } = useLedger();
  const { branches } = useOrganisation();
  const { currencies, functional } = useCurrencies();
  const messageFor = useDeliveryMessage();
  const accounts = useLeafAccounts();
  const booksYear = useBooksYear();

  const openBranches = useMemo(() => branches.filter((one) => one.active), [branches]);
  const spendable = useMemo(() => currencies.filter((one) => one.enabled), [currencies]);

  /**
   * Every account a line may be written onto by hand.
   *
   * The control accounts are gone rather than refused: `fin.account-controlled`
   * is the one refusal on this screen whose cause a person cannot see from the
   * chart, and a subledger that disagrees with the ledger for ever is the one
   * mistake this feature exists to not make.
   */
  const postable = useMemo(
    () =>
      accountOptions(
        translator,
        accounts.filter(
          (account) => account.reserved === null || !CONTROL_ACCOUNTS.includes(account.reserved),
        ),
      ),
    [accounts, translator],
  );

  // Bumped after an entry is posted, which is what resets the form: `useAttempt`
  // resets on a change of its subject, and a draft is a subject. It starts at
  // one because nought is falsy and would look to the hook like no draft at all.
  const [draft, setDraft] = useState(1);
  const [entryId, setEntryId] = useState<JournalEntryId>(() => newId<'journal-entry'>());
  const [branch, setBranch] = useState<string | null>(null);
  const [day, setDay] = useState<LocalDate | null>(null);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<readonly LineDraft[]>([]);
  const [files, setFiles] = useState<readonly ChosenFile[]>([]);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [posted, setPosted] = useState<Posted | null>(null);

  const nextKey = useRef(0);
  const blankLine = (): LineDraft => {
    nextKey.current += 1;
    return {
      key: String(nextKey.current),
      account: null,
      side: 'debit',
      currency: functional?.code ?? '',
      amount: null,
      memo: '',
      override: null,
    };
  };

  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(draft, () => {
    setBranch(openBranches[0]?.id ?? null);
    setDay(null);
    setDescription('');
    setLines([blankLine(), blankLine()]);
    setFiles([]);
    setInvalid(new Set());
  });

  // A branch chosen before the organisation had answered would be a branch
  // nobody picked, so the first one is taken as soon as there is one — and only
  // while nothing else is chosen, so it never overrides a person's choice.
  if (branch === null && openBranches.length > 0) {
    setBranch(openBranches[0]?.id ?? null);
  }

  function edit(key: string, change: Partial<LineDraft>): void {
    setLines((was) => was.map((line) => (line.key === key ? { ...line, ...change } : line)));
  }

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blanks = new Set<string>();
    if (branch === null) blanks.add('branch');
    if (day === null) blanks.add('day');
    if (description.trim() === '') blanks.add('description');
    if (lines.length === 0) blanks.add('lines');
    for (const line of lines) {
      if (line.account === null) blanks.add(`${line.key}.account`);
      if (line.amount === null) blanks.add(`${line.key}.amount`);
      if (line.override !== null) {
        if (line.override.rate.trim() === '') blanks.add(`${line.key}.rate`);
        if (line.override.reason.trim() === '') blanks.add(`${line.key}.reason`);
      }
    }
    setInvalid(blanks);
    if (blanks.size > 0) {
      reportInvalid();
      return;
    }

    const on = day;
    const at = branch;
    if (on === null || at === null) return;

    await attemptWith(async () => {
      const delivery = await run(() =>
        journal.record({
          id: entryId,
          branch: at as Posted['entry']['branch'],
          day: on,
          description: description.trim(),
          lines: lines.map(lineOf),
          ...(files.length === 0 ? {} : { attachments: files.map(uploadOf) }),
        }),
      );
      const message = messageFor(delivery);
      if (message === null && delivery.kind === 'done') {
        setPosted(delivery.value);
        toast.show(
          translator.format('manualEntry.posted', { number: delivery.value.entry.number }),
          { tone: 'success' },
        );
        // A posted entry is finished with; the next one is a new draft, and a
        // new draft is a new identifier. A refusal keeps both, so that trying
        // again lands on the entry this draft was always going to be.
        setEntryId(newId<'journal-entry'>());
        setDraft((was) => was + 1);
      }
      return message;
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void attempt();
      }}
      className="flex flex-col gap-[var(--vx-gap-lg)]"
    >
      <PageHeader
        title={translator.format('manualEntry.title')}
        description={translator.format('manualEntry.description')}
        actions={
          <>
            <Button
              tone="secondary"
              onPress={() => {
                goTo('journal');
              }}
            >
              {translator.format('manualEntry.toJournal')}
            </Button>
            <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
              {translator.format('manualEntry.submit')}
            </Button>
          </>
        }
      />

      {refused === null ? null : <Banner tone="danger">{refused}</Banner>}

      {posted === null ? null : (
        <Banner
          tone="success"
          title={translator.format('manualEntry.posted.title')}
          actions={
            <Button
              onPress={() => {
                goTo('journal', posted.entry.id);
              }}
            >
              {translator.format('manualEntry.posted.open')}
            </Button>
          }
        >
          {translator.format('manualEntry.posted.explanation', {
            number: posted.entry.number,
          })}
        </Banner>
      )}

      <Panel title={translator.format('manualEntry.heading')}>
        <div className="grid gap-[var(--vx-gap-md)] sm:grid-cols-2">
          <Select
            label={translator.format('manualEntry.branch')}
            description={translator.format('manualEntry.branch.description')}
            options={openBranches.map((one) => ({ id: one.id, label: one.name }))}
            value={branch}
            onChange={(key) => {
              setBranch(String(key));
            }}
            isRequired
            {...(invalid.has('branch')
              ? { errorMessage: translator.format('manualEntry.branch.required') }
              : {})}
          />
          <DateInput
            label={translator.format('manualEntry.day')}
            description={translator.format('manualEntry.day.description')}
            value={day}
            onChange={setDay}
            {...(booksYear.from === null ? {} : { placeholder: booksYear.from })}
            isRequired
            {...(invalid.has('day')
              ? { errorMessage: translator.format('manualEntry.day.required') }
              : {})}
          />
        </div>
        <TextArea
          label={translator.format('manualEntry.words')}
          description={translator.format('manualEntry.words.description')}
          value={description}
          onChange={setDescription}
          isRequired
          {...(invalid.has('description')
            ? { errorMessage: translator.format('manualEntry.words.required') }
            : {})}
        />
      </Panel>

      <Panel
        title={translator.format('manualEntry.lines')}
        actions={
          <Button
            onPress={() => {
              setLines((was) => [...was, blankLine()]);
            }}
          >
            {translator.format('manualEntry.line.add')}
          </Button>
        }
      >
        {invalid.has('lines') ? (
          <Banner tone="danger">{translator.format('manualEntry.lines.required')}</Banner>
        ) : null}
        <ul className="flex flex-col gap-[var(--vx-gap-md)]">
          {lines.map((line, index) => (
            <li key={line.key}>
              <LineFields
                line={line}
                ordinal={index + 1}
                accounts={postable}
                currencies={spendable}
                functional={functional}
                invalid={invalid}
                onChange={(change) => {
                  edit(line.key, change);
                }}
                onRemove={
                  lines.length > 1
                    ? () => {
                        setLines((was) => was.filter((one) => one.key !== line.key));
                      }
                    : null
                }
              />
            </li>
          ))}
        </ul>
        <Totals lines={lines} />
      </Panel>

      <Panel title={translator.format('manualEntry.evidence')}>
        <AttachmentInput
          label={translator.format('manualEntry.attachments')}
          description={translator.format('manualEntry.attachments.description')}
          value={files}
          onChange={setFiles}
          accept={ATTACHMENT_MEDIA_TYPES}
          maxBytes={ATTACHMENT_SIZE_LIMIT}
          onReject={(rejected) => {
            for (const one of rejected) {
              toast.show(
                translator.format(`manualEntry.attachment.rejected.${one.reason}`, {
                  name: one.name,
                }),
                { tone: 'danger' },
              );
            }
          }}
        />
      </Panel>

      {/* The form needs a submit control for Enter to mean anything, and the one
          a person presses is in the header where this screen's actions are. */}
      <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
    </form>
  );
}

/** One line of the entry as it is being written. */
interface LineDraft {
  readonly key: string;
  readonly account: string | null;
  readonly side: EntrySide;
  readonly currency: CurrencyCode;
  readonly amount: Money | null;
  readonly memo: string;
  /** `FX-06`, for a line stated in a currency the books are not kept in. */
  readonly override: OverrideDraft | null;
}

/** What the domain takes. Every blank has already been refused by the screen. */
function lineOf(line: LineDraft): ManualLine {
  if (line.account === null || line.amount === null) {
    throw new Error('A line with nothing in it reached the command.');
  }
  const override = overrideQuoteOf(line.override);
  return {
    // The brand is a compile-time claim: what is here came off an `Account`
    // record when the chooser was built, and `FIN` judges it again regardless.
    account: line.account as AccountId,
    side: line.side,
    amount: line.amount,
    ...(override === null ? {} : { override }),
    ...(line.memo.trim() === '' ? {} : { memo: line.memo.trim() }),
  };
}

/** What `FIN-04` takes as evidence; the field has already held it to type and size. */
function uploadOf(file: ChosenFile): {
  readonly name: string;
  readonly mediaType: (typeof ATTACHMENT_MEDIA_TYPES)[number];
  readonly bytes: Uint8Array;
} {
  const mediaType = ATTACHMENT_MEDIA_TYPES.find((one) => one === file.mediaType);
  if (mediaType === undefined) {
    throw new Error(`A file of type "${file.mediaType}" passed a field that does not take one.`);
  }
  return { name: file.name, mediaType, bytes: file.bytes };
}

function LineFields({
  line,
  ordinal,
  accounts,
  currencies,
  functional,
  invalid,
  onChange,
  onRemove,
}: {
  readonly line: LineDraft;
  readonly ordinal: number;
  readonly accounts: ReturnType<typeof accountOptions>;
  readonly currencies: readonly TenantCurrency[];
  readonly functional: TenantCurrency | null;
  readonly invalid: ReadonlySet<string>;
  readonly onChange: (change: Partial<LineDraft>) => void;
  readonly onRemove: (() => void) | null;
}): ReactNode {
  const translator = useTranslator();
  const currency = currencies.find((one) => one.code === line.currency) ?? functional;
  const isForeign = functional !== null && line.currency !== functional.code;

  const sideOptions: readonly SelectOption[] = ENTRY_SIDES.map((side) => ({
    id: side,
    label: translator.format(`entry.side.${side}`),
  }));

  return (
    <div className="border-line flex flex-col gap-[var(--vx-gap-md)] rounded border p-[var(--vx-pad-md)]">
      <div className="flex items-center justify-between">
        <h3 className="text-footnote font-medium text-fg-secondary">
          {translator.format('manualEntry.line.ordinal', { ordinal })}
        </h3>
        {onRemove === null ? null : (
          <IconButton
            tone="ghost"
            aria-label={translator.format('manualEntry.line.remove', { ordinal })}
            onPress={onRemove}
          >
            <RemoveIcon />
          </IconButton>
        )}
      </div>

      <div className="grid gap-[var(--vx-gap-md)] lg:grid-cols-[2fr_1fr_1fr_1.2fr]">
        <Combobox
          label={translator.format('manualEntry.line.account')}
          options={accounts}
          emptyMessage={translator.format('manualEntry.line.account.none')}
          value={line.account}
          onChange={(account) => {
            onChange({ account });
          }}
          isRequired
          {...(invalid.has(`${line.key}.account`)
            ? { errorMessage: translator.format('manualEntry.line.account.required') }
            : {})}
        />
        <Select
          label={translator.format('manualEntry.line.side')}
          options={sideOptions}
          value={line.side}
          onChange={(key) => {
            const next = String(key);
            const side = ENTRY_SIDES.find((one) => one === next);
            if (side !== undefined) onChange({ side });
          }}
        />
        <Select
          label={translator.format('manualEntry.line.currency')}
          options={currencies.map((one) => ({ id: one.code, label: one.code }))}
          value={line.currency}
          onChange={(key) => {
            // The amount goes with the currency: an amount is in one currency,
            // and pointing the field at another does not convert it. The
            // override goes too — it values a figure that no longer exists.
            onChange({ currency: String(key), amount: null, override: null });
          }}
        />
        {currency === null ? null : (
          <MoneyInput
            label={translator.format('manualEntry.line.amount')}
            currency={currency}
            value={line.amount}
            onChange={(amount) => {
              onChange({ amount });
            }}
            isRequired
            {...(invalid.has(`${line.key}.amount`)
              ? { errorMessage: translator.format('manualEntry.line.amount.required') }
              : {})}
          />
        )}
      </div>

      <TextInput
        label={translator.format('manualEntry.line.memo')}
        value={line.memo}
        onChange={(memo) => {
          onChange({ memo });
        }}
      />

      {/* `FX-06` has nothing to replace on a line already in the currency the
          books are kept in, and is refused there — so it is not offered. */}
      {isForeign ? (
        <RateOverrideFields
          currency={line.currency}
          functional={functional.code}
          value={line.override}
          onChange={(override) => {
            onChange({ override });
          }}
          missing={{
            rate: invalid.has(`${line.key}.rate`),
            reason: invalid.has(`${line.key}.reason`),
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * What the two sides come to, one currency at a time.
 *
 * **Per currency, and not one figure**, because that is the only sum this
 * screen can honestly state. The ledger balances in the functional currency
 * (`fin.entry-unbalanced`, exactly, with no tolerance), and a line stated in
 * another currency is worth whatever `FX` values it at when the entry is
 * recorded — at the branch's rate for today, on the side the line's own side
 * selects. Adding a figure in pounds to one in dollars here would mean this
 * screen holding a second opinion about a rate, which is the one thing
 * `modules.md` §5 spends its length on.
 *
 * So each currency states its own two sides and the difference between them,
 * and an entry written entirely in the books' own currency — which is almost
 * every adjusting entry — shows the one line an accountant is looking for.
 */
function Totals({ lines }: { readonly lines: readonly LineDraft[] }): ReactNode {
  const translator = useTranslator();

  const totals = useMemo(() => {
    const byCurrency = new Map<CurrencyCode, { debits: Money; credits: Money }>();
    for (const line of lines) {
      if (line.amount === null) continue;
      const code = line.amount.currency;
      const held = byCurrency.get(code) ?? { debits: zero(code), credits: zero(code) };
      byCurrency.set(
        code,
        line.side === 'debit'
          ? { ...held, debits: add(held.debits, line.amount) }
          : { ...held, credits: add(held.credits, line.amount) },
      );
    }
    return [...byCurrency.entries()].map(([code, sides]) => ({
      code,
      debits: sides.debits,
      credits: sides.credits,
      difference: subtract(sides.debits, sides.credits),
    }));
  }, [lines]);

  if (totals.length === 0) return null;

  return (
    <dl className="border-line flex flex-col gap-[var(--vx-gap-sm)] border-t pt-[var(--vx-pad-md)]">
      {totals.map((total) => {
        const balanced = compare(total.difference, zero(total.code)) === 0;
        return (
          <div
            key={total.code}
            className="flex flex-wrap items-baseline gap-x-[var(--vx-gap-lg)] gap-y-[var(--vx-gap-xs)]"
          >
            <dt className="text-footnote text-fg-muted">
              <Code>{total.code}</Code>
            </dt>
            <dd className="text-body text-fg flex flex-wrap items-baseline gap-[var(--vx-gap-md)]">
              <span>
                {translator.format('manualEntry.totals.debits')}{' '}
                <Figure amount={{ amount: total.debits.amount.toFixed(), currency: total.code }} />
              </span>
              <span>
                {translator.format('manualEntry.totals.credits')}{' '}
                <Figure amount={{ amount: total.credits.amount.toFixed(), currency: total.code }} />
              </span>
              <span className={balanced ? 'text-fg-success' : 'text-fg-danger'}>
                {balanced
                  ? translator.format('manualEntry.totals.balanced')
                  : translator.format('manualEntry.totals.difference')}{' '}
                {balanced ? null : (
                  <Figure
                    amount={{
                      amount: total.difference.amount.abs().toFixed(),
                      currency: total.code,
                    }}
                  />
                )}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
