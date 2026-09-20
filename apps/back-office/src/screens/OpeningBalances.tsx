import { useMemo, useRef, useState, type ReactNode } from 'react';

import { newId, type CurrencyCode, type LocalDate, type Money } from '@vertex/kernel';
import type {
  JournalEntryId,
  OpeningBalances as OpeningBalancesInput,
  OpeningFigure,
  Posted,
} from '@vertex/fin/contract';
import type { TenantCurrency } from '@vertex/fx/contract';
import {
  Banner,
  Button,
  DateInput,
  IconButton,
  MoneyInput,
  PageHeader,
  Panel,
  Select,
  TextInput,
  useAttempt,
  useToast,
  useTranslator,
} from '@vertex/ui';

import { useCurrencies } from '../currencies.js';
import { useLedger } from '../ledger.js';
import { useDeliveryMessage, useOrganisation } from '../organisation.js';
import { useNavigateTo } from '../routing.js';
import { overrideQuoteOf, RateOverrideFields, useBooksYear, type OverrideDraft } from './books.js';
import { RemoveIcon } from './structure.js';

/**
 * `FIN-06`: what a shop has on the day its books open, entered as the four
 * figures it actually has — and posted as one dated opening journal entry.
 *
 * **Four figures and not a set of lines**, which is the feature's own shape
 * and the reason it is not the manual entry screen next door. Inventory, the
 * tills, what customers owe and what is owed to suppliers are the **control
 * accounts** (`CONTROL_ACCOUNTS`): every other figure in them comes from a
 * document that moved them, and this is the one door into them that is not a
 * document. So the accountant enters what the shop *has* and never decides
 * what a debit is — the entry's shape is fixed in `FIN`, and the whole is
 * balanced against opening-balance equity on whichever side balances it.
 *
 * **A till is named by its currency.** `FIN-01` keeps one cash account per
 * currency and a till is counted in its own notes, so each till's figure is
 * stated in that currency and no other — and a currency already counted is
 * taken off the list the next till offers, which is `fin.opening-till-repeated`
 * made unreachable rather than explained.
 *
 * **Every figure is stamped at the rate of the day it is entered**, not the
 * day the books open on: `FX-04` keeps rates for today only, so there is no
 * rate of last January to stamp one with. An accountant who knows the rate was
 * different then types it as an override, with the reason written down where
 * the review will read it.
 */
export function OpeningBalances(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const goTo = useNavigateTo();
  const { journal, run } = useLedger();
  const { branches } = useOrganisation();
  const { currencies, functional } = useCurrencies();
  const messageFor = useDeliveryMessage();
  const booksYear = useBooksYear();

  const openBranches = useMemo(() => branches.filter((one) => one.active), [branches]);
  const spendable = useMemo(() => currencies.filter((one) => one.enabled), [currencies]);

  const [draft, setDraft] = useState(1);
  const [entryId, setEntryId] = useState<JournalEntryId>(() => newId<'journal-entry'>());
  const [branch, setBranch] = useState<string | null>(null);
  const [day, setDay] = useState<LocalDate | null>(null);
  const [description, setDescription] = useState('');
  const [inventory, setInventory] = useState<FigureDraft>(() => blank('inventory'));
  const [customerDebts, setCustomerDebts] = useState<FigureDraft>(() => blank('customers'));
  const [supplierDebts, setSupplierDebts] = useState<FigureDraft>(() => blank('suppliers'));
  const [tills, setTills] = useState<readonly FigureDraft[]>([]);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [posted, setPosted] = useState<Posted | null>(null);

  const nextTill = useRef(0);

  function blank(key: string): FigureDraft {
    return { key, currency: functional?.code ?? '', amount: null, override: null };
  }

  function blankTill(taken: readonly CurrencyCode[]): FigureDraft {
    nextTill.current += 1;
    const free = spendable.find((one) => !taken.includes(one.code));
    return {
      key: `till-${String(nextTill.current)}`,
      currency: free?.code ?? functional?.code ?? '',
      amount: null,
      override: null,
    };
  }

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
    setInventory(blank('inventory'));
    setCustomerDebts(blank('customers'));
    setSupplierDebts(blank('suppliers'));
    setTills([]);
    setInvalid(new Set());
  });

  // The first branch as soon as there is one, and only while nothing else is
  // chosen — see `ManualEntry` for why this is adjusted while rendering.
  if (branch === null && openBranches.length > 0) {
    setBranch(openBranches[0]?.id ?? null);
  }

  const figures = [inventory, customerDebts, supplierDebts, ...tills];
  const entered = figures.filter((figure) => figure.amount !== null);

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blanks = new Set<string>();
    if (branch === null) blanks.add('branch');
    if (day === null) blanks.add('day');
    if (entered.length === 0) blanks.add('figures');
    for (const figure of figures) {
      if (figure.amount === null || figure.override === null) continue;
      if (figure.override.rate.trim() === '') blanks.add(`${figure.key}.rate`);
      if (figure.override.reason.trim() === '') blanks.add(`${figure.key}.reason`);
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
      const balances: OpeningBalancesInput = {
        id: entryId,
        // The brand is a compile-time claim: this came off a `Branch` record
        // when the chooser was built, and `SYS` judges it again regardless.
        branch: at as Posted['entry']['branch'],
        day: on,
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        ...figureOf('inventory', inventory),
        ...figureOf('customerDebts', customerDebts),
        ...figureOf('supplierDebts', supplierDebts),
        ...(tills.some((till) => till.amount !== null)
          ? { tills: tills.filter(hasAmount).map(openingFigureOf) }
          : {}),
      };
      const delivery = await run(() => journal.open(balances));
      const message = messageFor(delivery);
      if (message === null && delivery.kind === 'done') {
        setPosted(delivery.value);
        toast.show(translator.format('opening.posted', { number: delivery.value.entry.number }), {
          tone: 'success',
        });
        setEntryId(newId<'journal-entry'>());
        setDraft((was) => was + 1);
      }
      return message;
    });
  }

  const tillCurrencies = tills.map((till) => till.currency);

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
        title={translator.format('opening.title')}
        description={translator.format('opening.description')}
        actions={
          <>
            <Button
              tone="secondary"
              onPress={() => {
                goTo('journal');
              }}
            >
              {translator.format('opening.toJournal')}
            </Button>
            <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
              {translator.format('opening.submit')}
            </Button>
          </>
        }
      />

      {refused === null ? null : <Banner tone="danger">{refused}</Banner>}

      {posted === null ? null : (
        <Banner
          tone="success"
          title={translator.format('opening.posted.title')}
          actions={
            <Button
              onPress={() => {
                goTo('journal', posted.entry.id);
              }}
            >
              {translator.format('opening.posted.open')}
            </Button>
          }
        >
          {translator.format('opening.posted.explanation', { number: posted.entry.number })}
        </Banner>
      )}

      <Panel title={translator.format('opening.heading')}>
        <div className="grid gap-[var(--vx-gap-md)] sm:grid-cols-2">
          <Select
            label={translator.format('opening.branch')}
            description={translator.format('opening.branch.description')}
            options={openBranches.map((one) => ({ id: one.id, label: one.name }))}
            value={branch}
            onChange={(key) => {
              setBranch(String(key));
            }}
            isRequired
            {...(invalid.has('branch')
              ? { errorMessage: translator.format('opening.branch.required') }
              : {})}
          />
          <DateInput
            label={translator.format('opening.day')}
            description={translator.format('opening.day.description')}
            value={day}
            onChange={setDay}
            {...(booksYear.from === null ? {} : { placeholder: booksYear.from })}
            isRequired
            {...(invalid.has('day')
              ? { errorMessage: translator.format('opening.day.required') }
              : {})}
          />
        </div>
        <TextInput
          label={translator.format('opening.words')}
          description={translator.format('opening.words.description')}
          value={description}
          onChange={setDescription}
        />
      </Panel>

      {invalid.has('figures') ? (
        <Banner tone="danger">{translator.format('opening.figures.required')}</Banner>
      ) : null}

      <Panel title={translator.format('opening.whatTheShopHas')}>
        <FigureFields
          label={translator.format('opening.inventory')}
          description={translator.format('opening.inventory.description')}
          figure={inventory}
          currencies={spendable}
          functional={functional}
          invalid={invalid}
          onChange={setInventory}
        />
        <FigureFields
          label={translator.format('opening.customerDebts')}
          description={translator.format('opening.customerDebts.description')}
          figure={customerDebts}
          currencies={spendable}
          functional={functional}
          invalid={invalid}
          onChange={setCustomerDebts}
        />
      </Panel>

      <Panel
        title={translator.format('opening.tills')}
        actions={
          <Button
            isDisabled={tills.length >= spendable.length}
            onPress={() => {
              setTills((was) => [...was, blankTill(was.map((till) => till.currency))]);
            }}
          >
            {translator.format('opening.till.add')}
          </Button>
        }
      >
        {tills.length === 0 ? (
          <p className="text-body text-fg-muted">{translator.format('opening.tills.none')}</p>
        ) : (
          <ul className="flex flex-col gap-[var(--vx-gap-md)]">
            {tills.map((till) => (
              <li key={till.key}>
                <FigureFields
                  label={translator.format('opening.till')}
                  description={translator.format('opening.till.description')}
                  figure={till}
                  // A currency already counted is off the list: `FIN-01` keeps
                  // one cash account per currency, so two figures for one
                  // currency are one till counted twice — and a sum would hide
                  // exactly the mistake this screen exists to not make.
                  currencies={spendable.filter(
                    (one) => one.code === till.currency || !tillCurrencies.includes(one.code),
                  )}
                  functional={functional}
                  invalid={invalid}
                  onChange={(next) => {
                    setTills((was) => was.map((one) => (one.key === till.key ? next : one)));
                  }}
                  onRemove={() => {
                    setTills((was) => was.filter((one) => one.key !== till.key));
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={translator.format('opening.whatTheShopOwes')}>
        <FigureFields
          label={translator.format('opening.supplierDebts')}
          description={translator.format('opening.supplierDebts.description')}
          figure={supplierDebts}
          currencies={spendable}
          functional={functional}
          invalid={invalid}
          onChange={setSupplierDebts}
        />
      </Panel>

      {/* The form needs a submit control for Enter to mean anything, and the one
          a person presses is in the header where this screen's actions are. */}
      <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
    </form>
  );
}

/** One of the four figures as it is being entered. */
interface FigureDraft {
  readonly key: string;
  readonly currency: CurrencyCode;
  readonly amount: Money | null;
  readonly override: OverrideDraft | null;
}

function hasAmount(figure: FigureDraft): figure is FigureDraft & { readonly amount: Money } {
  return figure.amount !== null;
}

/** What the domain takes for one figure. */
function openingFigureOf(figure: FigureDraft & { readonly amount: Money }): OpeningFigure {
  const override = overrideQuoteOf(figure.override);
  return { amount: figure.amount, ...(override === null ? {} : { override }) };
}

/**
 * A figure, or nothing at all.
 *
 * `FIN-06` says every figure is optional and what a shop does not have is left
 * out, **not entered as nought**: an opening entry naming an account with
 * nothing in it is a line that says the shop counted and found none, which is
 * not what an empty field means.
 */
function figureOf(
  name: 'inventory' | 'customerDebts' | 'supplierDebts',
  figure: FigureDraft,
): Partial<Record<typeof name, OpeningFigure>> {
  return hasAmount(figure) ? { [name]: openingFigureOf(figure) } : {};
}

function FigureFields({
  label,
  description,
  figure,
  currencies,
  functional,
  invalid,
  onChange,
  onRemove,
}: {
  readonly label: string;
  readonly description: string;
  readonly figure: FigureDraft;
  readonly currencies: readonly TenantCurrency[];
  readonly functional: TenantCurrency | null;
  readonly invalid: ReadonlySet<string>;
  readonly onChange: (next: FigureDraft) => void;
  readonly onRemove?: () => void;
}): ReactNode {
  const translator = useTranslator();
  const currency = currencies.find((one) => one.code === figure.currency) ?? functional;
  const isForeign = functional !== null && figure.currency !== functional.code;

  return (
    <div className="flex flex-col gap-[var(--vx-gap-md)]">
      <div className="grid items-end gap-[var(--vx-gap-md)] sm:grid-cols-[1fr_2fr_auto]">
        <Select
          label={translator.format('opening.figure.currency')}
          options={currencies.map((one) => ({ id: one.code, label: one.code }))}
          value={figure.currency}
          onChange={(key) => {
            // The amount goes with the currency, and the override with it: an
            // amount is in one currency, and a rate values a figure that no
            // longer exists.
            onChange({ ...figure, currency: String(key), amount: null, override: null });
          }}
        />
        {currency === null ? null : (
          <MoneyInput
            label={label}
            description={description}
            currency={currency}
            value={figure.amount}
            onChange={(amount) => {
              onChange({ ...figure, amount, ...(amount === null ? { override: null } : {}) });
            }}
          />
        )}
        {onRemove === undefined ? (
          <span />
        ) : (
          <IconButton
            tone="ghost"
            aria-label={translator.format('opening.till.remove', { currency: figure.currency })}
            onPress={onRemove}
          >
            <RemoveIcon />
          </IconButton>
        )}
      </div>
      {/* Offered only where there is a rate to override: a figure already in
          the currency the books are kept in is valued by nothing. And only
          once a figure has been entered, since an override with no amount
          beneath it values nothing at all. */}
      {isForeign && figure.amount !== null ? (
        <RateOverrideFields
          currency={figure.currency}
          functional={functional.code}
          value={figure.override}
          onChange={(override) => {
            onChange({ ...figure, override });
          }}
          missing={{
            rate: invalid.has(`${figure.key}.rate`),
            reason: invalid.has(`${figure.key}.reason`),
          }}
        />
      ) : null}
    </div>
  );
}
