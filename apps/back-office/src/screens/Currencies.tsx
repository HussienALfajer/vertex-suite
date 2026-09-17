import { useMemo, useState, type ReactNode } from 'react';

import { isRoundingMode, ROUNDING_MODES, type Result, type RoundingMode } from '@vertex/kernel';
import type { CurrencyRefusal, NewCurrency, TenantCurrency } from '@vertex/fx/contract';
import {
  actionsColumnWidth,
  Badge,
  Banner,
  Button,
  Code,
  ConfirmationDialog,
  DataTable,
  Dialog,
  PageHeader,
  Panel,
  Select,
  Switch,
  TableRowAction,
  TableRowActions,
  TextInput,
  useAttempt,
  useToast,
  useTranslator,
  type DataTableColumn,
  type SelectOption,
} from '@vertex/ui';

import { useCurrencies } from '../currencies.js';
import { useDeliveryMessage } from '../organisation.js';
import type { CurrenciesOfRecord } from '../system.js';
import { RenameIcon, RestoreIcon, StatusBadge, WithdrawIcon } from './structure.js';

/**
 * `FX-01`: the tenant's currencies, each with its own rounding rule.
 * `FX-02`: which one the books are kept in, marked on the row it is already
 * on rather than asked as a question of its own.
 *
 * The four seeded currencies are ready the moment this screen is (`FX-01`'s
 * `seed` is idempotent, and `dev-system.ts` runs it before this port ever
 * answers), so unlike `Roles` or `Branches` there is no first-run emptiness
 * to explain — this table is never the first thing an owner has to fill in.
 *
 * No search bar: a tenant's currencies number in the low single digits for as
 * long as this product exists, and `ListingBar`'s search exists for lists an
 * owner scrolls, not one an owner reads in full at a glance. The withdrawn
 * switch is offered anyway, for the same reason `SYS-09`'s structural screens
 * all offer it: a currency taken out of use is exactly the one an owner is
 * most likely to come back and re-enable, and it stays hidden by default so
 * a shop's small, active set of currencies is what a glance actually shows.
 */
export function Currencies(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { currencies, functional, isLoading, run } = useCurrencies();
  const messageFor = useDeliveryMessage();

  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [isDefining, setIsDefining] = useState(false);
  const [revising, setRevising] = useState<TenantCurrency | null>(null);
  const [disabling, setDisabling] = useState<TenantCurrency | null>(null);
  const [enabling, setEnabling] = useState<TenantCurrency | null>(null);
  const [adopting, setAdopting] = useState<TenantCurrency | null>(null);

  const rows: readonly TenantCurrency[] = useMemo(
    () =>
      [...currencies]
        .filter((currency) => includeWithdrawn || currency.enabled)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [currencies, includeWithdrawn],
  );

  async function command(
    work: (of: CurrenciesOfRecord) => Promise<Result<TenantCurrency, CurrencyRefusal>>,
    said: (code: string) => string,
    code: string,
  ): Promise<void> {
    const delivery = await run(work);
    const message = messageFor(delivery);
    toast.show(message ?? said(code), message === null ? { tone: 'success' } : { tone: 'danger' });
  }

  const columns: readonly DataTableColumn<TenantCurrency>[] = [
    {
      id: 'code',
      header: translator.format('currencies.column.code'),
      isRowHeader: true,
      render: (currency) => <Code>{currency.code}</Code>,
    },
    {
      id: 'symbol',
      header: translator.format('currencies.column.symbol'),
      render: (currency) => currency.symbol,
    },
    {
      id: 'decimals',
      header: translator.format('currencies.column.decimals'),
      render: (currency) =>
        translator.format('currencies.decimals.value', { decimals: currency.decimals }),
    },
    {
      id: 'increment',
      header: translator.format('currencies.column.increment'),
      render: (currency) => <Code>{currency.roundingIncrement}</Code>,
    },
    {
      id: 'roundingMode',
      header: translator.format('currencies.column.roundingMode'),
      render: (currency) => translator.format(`currency.roundingMode.${currency.roundingMode}`),
    },
    {
      id: 'status',
      header: translator.format('currencies.column.status'),
      render: (currency) => (
        <div className="flex flex-wrap items-center gap-[var(--vx-gap-xs)]">
          <StatusBadge isActive={currency.enabled} />
          {functional?.code === currency.code ? (
            <Badge tone="info">{translator.format('currencies.functional.badge')}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: translator.format('currencies.column.actions'),
      align: 'end',
      width: actionsColumnWidth(3),
      render: (currency) => {
        const isFunctional = functional?.code === currency.code;
        return (
          <TableRowActions>
            <TableRowAction
              aria-label={translator.format('currencies.revise.action')}
              onPress={() => {
                setRevising(currency);
              }}
            >
              <RenameIcon />
            </TableRowAction>
            {currency.enabled ? (
              <TableRowAction
                aria-label={translator.format('currencies.disable.title')}
                onPress={() => {
                  setDisabling(currency);
                }}
              >
                <WithdrawIcon />
              </TableRowAction>
            ) : (
              <TableRowAction
                aria-label={translator.format('currencies.enable.title')}
                onPress={() => {
                  setEnabling(currency);
                }}
              >
                <RestoreIcon />
              </TableRowAction>
            )}
            {currency.enabled && !isFunctional ? (
              <TableRowAction
                aria-label={translator.format('currencies.makeFunctional.action')}
                onPress={() => {
                  setAdopting(currency);
                }}
              >
                <MakeFunctionalIcon />
              </TableRowAction>
            ) : null}
          </TableRowActions>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={translator.format('currencies.title')}
        description={translator.format('currencies.description')}
        actions={
          <Button
            tone="primary"
            onPress={() => {
              setIsDefining(true);
            }}
          >
            {translator.format('currencies.define')}
          </Button>
        }
      />

      <CurrenciesStaleBanner />

      <div className="flex justify-end">
        <Switch isSelected={includeWithdrawn} onChange={setIncludeWithdrawn}>
          {translator.format('listing.includeWithdrawn')}
        </Switch>
      </div>

      <Panel flush>
        <DataTable
          label={translator.format('currencies.table')}
          columns={columns}
          rows={rows}
          rowKey={(currency) => currency.code}
          emptyMessage={translator.format(isLoading ? 'data.loading' : 'listing.noMatch')}
        />
      </Panel>

      <CurrencyDialog
        subject={null}
        isOpen={isDefining}
        onOpenChange={setIsDefining}
        onSubmit={async (fields) => {
          const delivery = await run((of) => of.define(fields));
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(translator.format('currencies.defined', { code: fields.code }), {
              tone: 'success',
            });
          }
          return message;
        }}
      />

      <CurrencyDialog
        subject={revising}
        isOpen={revising !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRevising(null);
        }}
        onSubmit={async (fields) => {
          if (revising === null) return null;
          const delivery = await run((of) =>
            of.revise(revising.code, {
              symbol: fields.symbol,
              decimals: fields.decimals,
              roundingIncrement: fields.roundingIncrement,
              roundingMode: fields.roundingMode,
            }),
          );
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(translator.format('currencies.revised', { code: revising.code }), {
              tone: 'success',
            });
          }
          return message;
        }}
      />

      <ConfirmationDialog
        title={translator.format('currencies.disable.title')}
        message={translator.format('currencies.disable.message', { code: disabling?.code ?? '' })}
        confirmLabel={translator.format('currencies.disable')}
        tone="danger"
        isOpen={disabling !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDisabling(null);
        }}
        onConfirm={() => {
          if (disabling === null) return;
          const taken = disabling;
          void command(
            (of) => of.disable(taken.code),
            (code) => translator.format('currencies.disabled', { code }),
            taken.code,
          );
        }}
      />

      <ConfirmationDialog
        title={translator.format('currencies.enable.title')}
        message={translator.format('currencies.enable.message', { code: enabling?.code ?? '' })}
        confirmLabel={translator.format('currencies.enable')}
        isOpen={enabling !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEnabling(null);
        }}
        onConfirm={() => {
          if (enabling === null) return;
          const taken = enabling;
          void command(
            (of) => of.enable(taken.code),
            (code) => translator.format('currencies.enabled', { code }),
            taken.code,
          );
        }}
      />

      <ConfirmationDialog
        title={translator.format('currencies.makeFunctional.title')}
        message={translator.format('currencies.makeFunctional.message', {
          code: adopting?.code ?? '',
        })}
        confirmLabel={translator.format('currencies.makeFunctional.submit')}
        isOpen={adopting !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setAdopting(null);
        }}
        onConfirm={() => {
          if (adopting === null) return;
          const taken = adopting;
          void command(
            (of) => of.makeFunctional(taken.code),
            (code) => translator.format('currencies.functionalChanged', { code }),
            taken.code,
          );
        }}
      />
    </>
  );
}

/**
 * `structure.tsx`'s `StaleBanner`, for `FX` rather than `SYS` — reading a
 * different provider is the whole difference, the same reason `Users.tsx`'s
 * `UsersStaleBanner` is not folded into the shared one either.
 *
 * Exported for the day a second `FX` screen (`FX-04`'s daily rate board)
 * reads the same `CurrenciesProvider`: one banner for a provider that has
 * fallen behind, not one per screen that happens to read it.
 */
export function CurrenciesStaleBanner(): ReactNode {
  const translator = useTranslator();
  const { unreachable, reload } = useCurrencies();
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

/** `20 20` outline, `stroke-current`, matching every icon `structure.tsx` builds. */
const iconClasses = 'fill-none stroke-current';

/** A five-point mark: what this shop's books are kept in, adopted rather than assigned. */
function MakeFunctionalIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={iconClasses} strokeWidth="1.5">
      <path
        d="M10 2.7l2.1 4.4 4.7.6-3.5 3.4.9 4.8L10 13.6l-4.2 2.3.9-4.8-3.5-3.4 4.8-.6z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The decimals a revision may choose: never below what is already stored (`fx.currency-decimals-reduced`). */
function decimalsOptions(
  translator: ReturnType<typeof useTranslator>,
  atLeast: number,
): readonly SelectOption[] {
  const options: SelectOption[] = [];
  for (let value = atLeast; value <= 12; value += 1) {
    options.push({
      id: String(value),
      label: translator.format('currencies.decimals.value', { decimals: value }),
    });
  }
  return options;
}

function roundingModeOptions(
  translator: ReturnType<typeof useTranslator>,
): readonly SelectOption[] {
  return ROUNDING_MODES.map((mode) => ({
    id: mode,
    label: translator.format(`currency.roundingMode.${mode}`),
  }));
}

interface CurrencyDialogProps {
  /** The currency being revised, or null while one is being defined. */
  readonly subject: TenantCurrency | null;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSubmit: (fields: NewCurrency) => Promise<string | null>;
}

/**
 * Defining a currency, and revising one — one dialog, because the
 * difference between them is which parts are still a question:
 * `Numbering.tsx`'s `SeriesDialog` draws the identical line between defining
 * a series and revising one, for the identical reason. A currency's code is
 * its identity (`FX-01`), so it is asked for only while there is none yet;
 * revising shows it instead of offering to change it, the same way a
 * series' scope is shown and not reopened once it exists.
 */
function CurrencyDialog({
  subject,
  isOpen,
  onOpenChange,
  onSubmit,
}: CurrencyDialogProps): ReactNode {
  const translator = useTranslator();
  const [code, setCode] = useState(subject?.code ?? '');
  const [symbol, setSymbol] = useState(subject?.symbol ?? '');
  const [decimals, setDecimals] = useState(String(subject?.decimals ?? 2));
  const [increment, setIncrement] = useState(subject?.roundingIncrement ?? '');
  const [roundingMode, setRoundingMode] = useState<RoundingMode>(
    subject?.roundingMode ?? 'half-up',
  );
  const [missing, setMissing] = useState({ code: false, symbol: false, increment: false });

  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(subject ?? isOpen, () => {
    setCode(subject?.code ?? '');
    setSymbol(subject?.symbol ?? '');
    setDecimals(String(subject?.decimals ?? 2));
    setIncrement(subject?.roundingIncrement ?? '');
    setRoundingMode(subject?.roundingMode ?? 'half-up');
    setMissing({ code: false, symbol: false, increment: false });
  });

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = {
      code: subject === null && code.trim() === '',
      symbol: symbol.trim() === '',
      increment: increment.trim() === '',
    };
    setMissing(blank);
    if (blank.code || blank.symbol || blank.increment) {
      setRefused(null);
      return;
    }

    await attemptWith(async () => {
      const message = await onSubmit({
        code: subject?.code ?? code.trim(),
        symbol: symbol.trim(),
        decimals: Number(decimals),
        roundingIncrement: increment.trim(),
        roundingMode,
      });
      if (message === null) onOpenChange(false);
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format(
        subject === null ? 'currencies.new.title' : 'currencies.revise.title',
      )}
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
            {translator.format(
              subject === null ? 'currencies.new.submit' : 'currencies.revise.submit',
            )}
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
        {subject === null ? (
          <TextInput
            label={translator.format('currencies.new.code')}
            description={translator.format('currencies.new.code.description')}
            value={code}
            onChange={(next) => {
              setCode(next);
              setMissing((was) => ({ ...was, code: false }));
            }}
            isMachineText
            autoFocus
            isRequired
            {...(missing.code
              ? { errorMessage: translator.format('currencies.new.code.required') }
              : {})}
          />
        ) : null}
        <TextInput
          label={translator.format('currencies.new.symbol')}
          value={symbol}
          onChange={(next) => {
            setSymbol(next);
            setMissing((was) => ({ ...was, symbol: false }));
          }}
          autoFocus={subject !== null}
          isRequired
          {...(missing.symbol
            ? { errorMessage: translator.format('currencies.new.symbol.required') }
            : {})}
        />
        <Select
          label={translator.format('currencies.new.decimals')}
          options={decimalsOptions(translator, subject?.decimals ?? 0)}
          value={decimals}
          onChange={(key) => {
            setDecimals(String(key));
          }}
        />
        <TextInput
          label={translator.format('currencies.new.increment')}
          description={translator.format('currencies.new.increment.description')}
          value={increment}
          onChange={(next) => {
            setIncrement(next);
            setMissing((was) => ({ ...was, increment: false }));
          }}
          isMachineText
          isRequired
          {...(missing.increment
            ? { errorMessage: translator.format('currencies.new.increment.required') }
            : {})}
        />
        <Select
          label={translator.format('currencies.new.roundingMode')}
          options={roundingModeOptions(translator)}
          value={roundingMode}
          onChange={(key) => {
            const next = String(key);
            if (isRoundingMode(next)) setRoundingMode(next);
          }}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
