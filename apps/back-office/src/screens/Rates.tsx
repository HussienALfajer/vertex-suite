import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { toDate } from '@vertex/kernel';
import { isQuoteForm } from '@vertex/fx';
import {
  QUOTE_FORMS,
  type QuoteForm,
  type RateBoard,
  type RateBoardLine,
  type RateQuote,
  type TenantCurrency,
} from '@vertex/fx/contract';
import {
  actionsColumnWidth,
  Badge,
  Banner,
  Button,
  Code,
  CurrencyRate,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Panel,
  Select,
  TableRowAction,
  TableRowActions,
  TextInput,
  formatExact,
  useAttempt,
  useToast,
  useTranslator,
  useVertex,
  type DataTableColumn,
  type SelectOption,
} from '@vertex/ui';
import type { Branch } from '@vertex/sys/contract';

import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import { useRates } from '../rates.js';
import { hrefOf, redirect, useNavigateTo, useRoute } from '../routing.js';
import { ReadState, RenameIcon, StaleBanner } from './structure.js';

/**
 * `FX-04`: a branch's own daily rate board.
 *
 * Scoped to one branch, chosen in the address bar, for the reason
 * `Locations.tsx` and `Registers.tsx` already are: a branch's rates are its
 * own, and nobody works across forty of them at once.
 *
 * `board()` can refuse — the tenant's currencies may not be set up yet, or the
 * branch named in the address bar may no longer exist — which no other
 * per-branch read on this application does. Reading it through `useRates()`'s
 * own `run` rather than a bare promise is what keeps that refusal a sentence
 * rather than the generic "unreachable" banner every other screen's transport
 * failure gets (`organisation.tsx`'s own `Delivery`, reused rather than
 * reinvented here).
 *
 * **Adopting is one button for the whole board**, never a per-row control:
 * `RateAdministration.adopt` takes a branch and nothing else, and `FX-04`'s
 * own words are "adopts... as its own with one action". Publishing a
 * suggestion is the owner's, tenant-wide, and does not depend on which branch
 * happens to be open here — offered from the page header rather than from a
 * row, and refused server-side (`fx.not-permitted`) for anybody else, exactly
 * as `currencies.makeFunctional.action` is never hidden from a manager either.
 *
 * `confirmLastKnown` (`FX-04`'s register-offline exception) and `override`
 * (`FX-06`, on a document) have no screen here: both are asked from a
 * register, and this codebase does not host one yet (`modules.md` §2 —
 * `apps/back-office` and `apps/sandbox` only; `U07` brings `apps/register`).
 */
export function Rates(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const goTo = useNavigateTo();
  const route = useRoute();
  const { branches, isLoading, unreachable } = useOrganisation();
  const { run } = useRates();
  const messageFor = useDeliveryMessage();

  const [editing, setEditing] = useState<RateBoardLine | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);

  const openBranches = useMemo(() => branches.filter((one) => one.active), [branches]);
  const chosen = useMemo(
    () => branches.find((one) => one.id === route.subject) ?? null,
    [branches, route.subject],
  );

  // Arriving with no branch named, or with one that is not this tenant's,
  // lands on the first branch that is open — the same arrangement
  // `Locations.tsx` and `Registers.tsx` use, for the same reason: this board
  // cannot be read without a branch.
  useEffect(() => {
    if (chosen !== null || branches.length === 0) return;
    const first = openBranches[0] ?? branches[0];
    if (first !== undefined) redirect(hrefOf('rates', first.id));
  }, [chosen, branches, openBranches]);

  const readBoard = useCallback((branch: Branch['id']) => run((of) => of.board(branch)), [run]);
  const board = useLoaded(chosen?.id ?? null, readBoard);
  const delivery = board.value;
  const rateBoard: RateBoard | null = delivery?.kind === 'done' ? delivery.value : null;
  // Covers a genuine refusal (the tenant's currencies are not set up yet, or
  // the branch named in the address bar is gone) and a transport failure
  // alike — `useDeliveryMessage` already draws that line, and this board has
  // one banner for both rather than two.
  const boardMessage = delivery === null ? null : messageFor(delivery);

  // A suggestion this branch's own revision was already recorded from is not
  // offered again — otherwise the banner would still ask for one action
  // already taken, on every visit until the owner publishes a newer one.
  const hasSuggestions =
    rateBoard?.lines.some(
      (line) => line.suggestion !== null && line.revision?.adoptedFrom !== line.suggestion.id,
    ) ?? false;

  async function recordOrCorrect(line: RateBoardLine, quote: RateQuote): Promise<string | null> {
    if (chosen === null) return null;
    const delivery = await run((of) => of.record(chosen.id, line.currency.code, quote));
    const message = messageFor(delivery);
    if (message === null) {
      board.reload();
      toast.show(
        translator.format(line.revision === null ? 'rates.recorded' : 'rates.corrected', {
          code: line.currency.code,
        }),
        { tone: 'success' },
      );
    }
    return message;
  }

  async function adopt(): Promise<void> {
    if (chosen === null) return;
    const delivery = await run((of) => of.adopt(chosen.id));
    const message = messageFor(delivery);
    if (message === null) {
      board.reload();
      toast.show(translator.format('rates.adopted'), { tone: 'success' });
    } else {
      toast.show(message, { tone: 'danger' });
    }
  }

  async function suggest(currency: string, quote: RateQuote): Promise<string | null> {
    const delivery = await run((of) => of.suggest(currency, quote));
    const message = messageFor(delivery);
    if (message === null) {
      board.reload();
      toast.show(translator.format('rates.suggested', { code: currency }), { tone: 'success' });
    }
    return message;
  }

  if (branches.length === 0 && unreachable) {
    return (
      <>
        <PageHeader
          title={translator.format('rates.title')}
          description={translator.format('rates.description')}
        />
        <StaleBanner />
      </>
    );
  }

  if (branches.length === 0 && !isLoading) {
    return (
      <>
        <PageHeader
          title={translator.format('rates.title')}
          description={translator.format('rates.description')}
        />
        <StaleBanner />
        <EmptyState
          message={translator.format('rates.noBranches')}
          description={translator.format('rates.noBranches.explanation')}
          action={
            <Button
              tone="primary"
              onPress={() => {
                goTo('branches');
              }}
            >
              {translator.format('rates.noBranches.action')}
            </Button>
          }
        />
      </>
    );
  }

  const branchOptions: readonly SelectOption[] = branches.map((one) => ({
    id: one.id,
    label: one.name,
  }));

  // Reads `line.revision.functional` rather than `rateBoard.functional.code`
  // in the two cells below — the revision already carries it (`FX-04`: what
  // "one unit of the functional currency" meant when it was recorded), so
  // these closures need nothing from outside `line` and the array needs no
  // `rateBoard === null` branch of its own: `rows` is already `[]` then.
  const columns: readonly DataTableColumn<RateBoardLine>[] = [
    {
      id: 'currency',
      header: translator.format('rates.column.currency'),
      isRowHeader: true,
      render: (line) => <Code>{line.currency.code}</Code>,
    },
    {
      id: 'buy',
      header: translator.format('rates.column.buy'),
      // `CurrencyRate` packs a rate, both currency codes, a date and a time
      // zone onto one line, and it wraps rather than overflows if that is
      // wider than this — the number is a comfortable single-line fit for
      // the common case, not a bound trusted to hold for every one.
      width: 260,
      render: (line) =>
        line.revision === null ? (
          <Badge tone="warning">{translator.format('rates.missing')}</Badge>
        ) : (
          <CurrencyRate
            rate={line.revision.buy}
            currency={line.currency.code}
            functionalCurrency={line.revision.functional}
            asOf={toDate(line.revision.recordedAt)}
            timeZone={chosen?.timeZone ?? 'UTC'}
            decimals={line.currency.decimals}
          />
        ),
    },
    {
      id: 'sell',
      header: translator.format('rates.column.sell'),
      width: 260,
      render: (line) =>
        line.revision === null ? (
          <Badge tone="warning">{translator.format('rates.missing')}</Badge>
        ) : (
          <CurrencyRate
            rate={line.revision.sell}
            currency={line.currency.code}
            functionalCurrency={line.revision.functional}
            asOf={toDate(line.revision.recordedAt)}
            timeZone={chosen?.timeZone ?? 'UTC'}
            decimals={line.currency.decimals}
          />
        ),
    },
    {
      id: 'suggested',
      header: translator.format('rates.column.suggested'),
      render: (line) => <SuggestedFigure line={line} />,
    },
    {
      id: 'actions',
      header: translator.format('rates.column.actions'),
      align: 'end',
      width: actionsColumnWidth(1),
      render: (line) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format(
              line.revision === null ? 'rates.record.action' : 'rates.correct.action',
            )}
            onPress={() => {
              setEditing(line);
            }}
          >
            <RenameIcon />
          </TableRowAction>
        </TableRowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={translator.format('rates.title')}
        description={translator.format('rates.description')}
        actions={
          <Button
            onPress={() => {
              setIsSuggesting(true);
            }}
          >
            {translator.format('rates.suggest.action')}
          </Button>
        }
      />

      <StaleBanner />

      {boardMessage === null ? null : (
        <Banner
          tone="danger"
          actions={<Button onPress={board.reload}>{translator.format('action.retry')}</Button>}
        >
          {boardMessage}
        </Banner>
      )}

      {!hasSuggestions ? null : (
        <Banner
          tone="info"
          title={translator.format('rates.adopt.banner.title')}
          actions={
            <Button
              tone="primary"
              onPress={() => {
                void adopt();
              }}
            >
              {translator.format('rates.adopt.banner.action')}
            </Button>
          }
        >
          {translator.format('rates.adopt.banner.description')}
        </Banner>
      )}

      <Select
        label={translator.format('rates.branch')}
        placeholder={translator.format('rates.branch.placeholder')}
        options={branchOptions}
        value={chosen?.id ?? null}
        onChange={(key) => {
          redirect(hrefOf('rates', String(key)));
        }}
        className="w-[16rem] max-w-full"
      />

      <ReadState loaded={board} />

      <Panel flush>
        <DataTable
          label={translator.format('rates.table')}
          columns={columns}
          rows={rateBoard?.lines ?? []}
          rowKey={(line) => line.currency.code}
          emptyMessage={translator.format(board.isLoading ? 'data.loading' : 'listing.noMatch')}
        />
      </Panel>

      {rateBoard === null ? null : (
        <>
          <RateDialog
            line={editing}
            functional={rateBoard.functional}
            onOpenChange={(isOpen) => {
              if (!isOpen) setEditing(null);
            }}
            onSubmit={(quote) => {
              if (editing === null) return Promise.resolve(null);
              return recordOrCorrect(editing, quote);
            }}
          />

          <SuggestDialog
            lines={rateBoard.lines}
            functional={rateBoard.functional}
            isOpen={isSuggesting}
            onOpenChange={setIsSuggesting}
            onSubmit={suggest}
          />
        </>
      )}
    </>
  );
}

/**
 * The tenant's candidate figures for a currency, or a dash when none was
 * published.
 *
 * Not `<CurrencyRate>`: that component's contract is a rate **in force** — a
 * defined day, and `isCurrent` answering whether it is today's — and a
 * suggestion is neither; it is a candidate nobody has adopted yet, with no
 * branch day of its own to show and no honest way to set `isCurrent` that
 * would not read as a claim about what this branch is actually trading at.
 * §12's own figure carries its unit through a component; the unit here is
 * simply the two currency codes already named in this row's own header.
 */
function SuggestedFigure({ line }: { readonly line: RateBoardLine }): ReactNode {
  const translator = useTranslator();
  const { formattingLocale } = useVertex();

  if (line.suggestion === null) return translator.format('rates.suggested.none');

  const buy = formatExact(line.suggestion.buy, line.currency.decimals, formattingLocale).text;
  const sell = formatExact(line.suggestion.sell, line.currency.decimals, formattingLocale).text;
  return (
    <span dir="ltr" className="tabular-nums text-fg-secondary">
      {translator.format('rates.suggested.value', { buy, sell })}
    </span>
  );
}

function quoteFormOptions(
  translator: ReturnType<typeof useTranslator>,
  currency: string,
  functional: string,
): readonly SelectOption[] {
  return QUOTE_FORMS.map((form) => ({
    id: form,
    label: translator.format(`rate.quoteForm.${form}`, { currency, functional }),
  }));
}

interface RateDialogProps {
  /** The row being recorded or corrected. Null exactly while the dialog is closed. */
  readonly line: RateBoardLine | null;
  readonly functional: TenantCurrency;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSubmit: (quote: RateQuote) => Promise<string | null>;
}

/**
 * Recording today's first rate for a currency, and correcting it: one dialog,
 * for the reason `Currencies.tsx`'s own `CurrencyDialog` gives — the
 * difference between them is which parts are still a question. Here it is
 * none of them: a correction prefills the form its own last quote was typed
 * in, because `FX-04` says a correction is "a new revision the same day", not
 * a blank form somebody has to re-type from a board.
 */
function RateDialog({ line, functional, onOpenChange, onSubmit }: RateDialogProps): ReactNode {
  const translator = useTranslator();
  // Never a state of its own: two props that could disagree, held apart from
  // the field they'd disagree about, is exactly the bug `line` being null
  // exists to make unrepresentable.
  const isOpen = line !== null;
  const isCorrecting = line !== null && line.revision !== null;
  const [form, setForm] = useState<QuoteForm>(
    line?.revision?.quoted.form ?? 'units-per-functional',
  );
  const [buy, setBuy] = useState(line?.revision?.quoted.buy ?? '');
  const [sell, setSell] = useState(line?.revision?.quoted.sell ?? '');
  const [missing, setMissing] = useState({ buy: false, sell: false });

  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(line, () => {
    setForm(line?.revision?.quoted.form ?? 'units-per-functional');
    setBuy(line?.revision?.quoted.buy ?? '');
    setSell(line?.revision?.quoted.sell ?? '');
    setMissing({ buy: false, sell: false });
  });

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = { buy: buy.trim() === '', sell: sell.trim() === '' };
    setMissing(blank);
    if (blank.buy || blank.sell) {
      setRefused(null);
      return;
    }

    await attemptWith(async () => {
      const message = await onSubmit({ form, buy: buy.trim(), sell: sell.trim() });
      if (message === null) onOpenChange(false);
      return message;
    });
  }

  const currency = line?.currency.code ?? '';

  return (
    <Dialog
      title={translator.format(isCorrecting ? 'rates.correct.title' : 'rates.record.title', {
        code: currency,
      })}
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
          <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format(isCorrecting ? 'rates.correct.submit' : 'rates.record.submit')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <Select
          label={translator.format('rates.field.form')}
          options={quoteFormOptions(translator, currency, functional.code)}
          value={form}
          onChange={(key) => {
            const next = String(key);
            if (isQuoteForm(next)) setForm(next);
          }}
        />
        <TextInput
          label={translator.format('rates.field.buy')}
          description={translator.format('rates.field.buy.description')}
          value={buy}
          onChange={(next) => {
            setBuy(next);
            setMissing((was) => ({ ...was, buy: false }));
          }}
          isMachineText
          autoFocus
          isRequired
          {...(missing.buy ? { errorMessage: translator.format('rates.field.buy.required') } : {})}
        />
        <TextInput
          label={translator.format('rates.field.sell')}
          description={translator.format('rates.field.sell.description')}
          value={sell}
          onChange={(next) => {
            setSell(next);
            setMissing((was) => ({ ...was, sell: false }));
          }}
          isMachineText
          isRequired
          {...(missing.sell
            ? { errorMessage: translator.format('rates.field.sell.required') }
            : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

interface SuggestDialogProps {
  readonly lines: readonly RateBoardLine[];
  readonly functional: TenantCurrency;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSubmit: (currency: string, quote: RateQuote) => Promise<string | null>;
}

/**
 * The owner's own side of `FX-04`: a rate published once, for every branch to
 * adopt. Independent of whichever branch happens to be open on this screen —
 * the command itself takes no branch — and offered to everybody, refused
 * server-side for anybody who is not the owner (`fx.not-permitted`), exactly
 * as `currencies.makeFunctional.action` already is.
 */
function SuggestDialog({
  lines,
  functional,
  isOpen,
  onOpenChange,
  onSubmit,
}: SuggestDialogProps): ReactNode {
  const translator = useTranslator();
  const options: readonly SelectOption[] = lines.map((line) => ({
    id: line.currency.code,
    label: line.currency.code,
  }));

  const [currency, setCurrency] = useState(lines[0]?.currency.code ?? '');
  const [form, setForm] = useState<QuoteForm>('units-per-functional');
  const [buy, setBuy] = useState('');
  const [sell, setSell] = useState('');
  const [missing, setMissing] = useState({ currency: false, buy: false, sell: false });

  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(isOpen, () => {
    setCurrency(lines[0]?.currency.code ?? '');
    setForm('units-per-functional');
    setBuy('');
    setSell('');
    setMissing({ currency: false, buy: false, sell: false });
  });

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = {
      currency: currency.trim() === '',
      buy: buy.trim() === '',
      sell: sell.trim() === '',
    };
    setMissing(blank);
    if (blank.currency || blank.buy || blank.sell) {
      setRefused(null);
      return;
    }

    await attemptWith(async () => {
      const message = await onSubmit(currency, { form, buy: buy.trim(), sell: sell.trim() });
      if (message === null) onOpenChange(false);
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('rates.suggest.title')}
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
          <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format('rates.suggest.submit')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <p className="text-body text-fg-secondary">
          {translator.format('rates.suggest.description')}
        </p>
        <Select
          label={translator.format('rates.suggest.field.currency')}
          placeholder={translator.format('rates.suggest.field.currency.placeholder')}
          options={options}
          value={currency === '' ? null : currency}
          onChange={(key) => {
            setCurrency(String(key));
            setMissing((was) => ({ ...was, currency: false }));
          }}
          {...(missing.currency
            ? { errorMessage: translator.format('rates.suggest.field.currency.required') }
            : {})}
        />
        <Select
          label={translator.format('rates.field.form')}
          options={quoteFormOptions(translator, currency, functional.code)}
          value={form}
          onChange={(key) => {
            const next = String(key);
            if (isQuoteForm(next)) setForm(next);
          }}
        />
        <TextInput
          label={translator.format('rates.field.buy')}
          description={translator.format('rates.field.buy.description')}
          value={buy}
          onChange={(next) => {
            setBuy(next);
            setMissing((was) => ({ ...was, buy: false }));
          }}
          isMachineText
          isRequired
          {...(missing.buy ? { errorMessage: translator.format('rates.field.buy.required') } : {})}
        />
        <TextInput
          label={translator.format('rates.field.sell')}
          description={translator.format('rates.field.sell.description')}
          value={sell}
          onChange={(next) => {
            setSell(next);
            setMissing((was) => ({ ...was, sell: false }));
          }}
          isMachineText
          isRequired
          {...(missing.sell
            ? { errorMessage: translator.format('rates.field.sell.required') }
            : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
