import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { addDays, partsOfDay, toDate, type Instant, type LocalDate } from '@vertex/kernel';
import type {
  AccountingPeriod,
  FiscalYear,
  PeriodReopening,
  YearShape,
} from '@vertex/fin/contract';
import {
  actionsColumnWidth,
  Badge,
  Banner,
  Button,
  DataTable,
  DateInput,
  DateTime,
  Dialog,
  EmptyState,
  formatDay,
  formatMoment,
  PageHeader,
  Panel,
  Select,
  Tabs,
  TableRowAction,
  TableRowActions,
  TextArea,
  useAttempt,
  useToast,
  useTranslator,
  useVertex,
  type DataTableColumn,
  type SelectOption,
  type TabDefinition,
} from '@vertex/ui';

import { useCalendar } from '../calendar.js';
import { useDeliveryMessage, useTenantZone } from '../organisation.js';
import { useUsers } from '../users.js';
import { CloseYearIcon, ReopenYearIcon } from './structure.js';

/**
 * `FIN-05`: the shop's fiscal years and the periods they are divided into,
 * each open or closed.
 *
 * **One year at a time, chosen by name.** A shop trading for a decade has ten
 * years and a hundred and twenty periods; a page showing all of them at once is
 * a page nobody reads, and a year is the unit an accountant actually works in.
 * `Tabs` arrived in this pull request for exactly that (`design-system.md`
 * §15) — a small, ordered, permanent set, which is the one shape a tab strip
 * is right for.
 *
 * **The calendar is installed with the shop** (`SYS-03`), which is why there is
 * no button here to create one. Seeding is idempotent and asks nothing of a
 * particular person; a control for it would either do nothing or re-run an
 * installation.
 *
 * What this screen refuses to imply: that closing a period is reversible in the
 * ordinary way. Reopening is its own act, under the owner's own right, against
 * a written reason, and it is logged where everyone who reads the books can see
 * it — which is the whole argument for allowing it at all, and is stated on the
 * dialog rather than left in a contract.
 */
export function FiscalCalendar(): ReactNode {
  const translator = useTranslator();
  const { formattingLocale } = useVertex();
  const toast = useToast();
  const { years, reopenings, isLoading, unreachable, reload, run } = useCalendar();
  const messageFor = useDeliveryMessage();

  const [chosen, setChosen] = useState<string | null>(null);
  const [appending, setAppending] = useState(false);
  const [redefining, setRedefining] = useState<FiscalYear | null>(null);
  const [closing, setClosing] = useState<AccountingPeriod | null>(null);
  const [reopening, setReopening] = useState<AccountingPeriod | null>(null);

  const last = years.at(-1) ?? null;

  const tabs = useMemo<readonly TabDefinition[]>(
    () =>
      years.map((year) => ({
        id: year.id,
        label: labelOfYear(translator, year),
        content: (
          <Year
            year={year}
            isLast={year.id === last?.id}
            reopenings={reopenings.filter((one) => one.year === year.id)}
            onRedefine={() => {
              setRedefining(year);
            }}
            onClose={setClosing}
            onReopen={setReopening}
          />
        ),
      })),
    [years, reopenings, translator, last],
  );

  // The year a person chose, or the last one — which is the one being worked
  // in. Falling back rather than holding a stale choice means a year that went
  // away underneath the screen cannot leave an empty page behind it.
  const selected = tabs.some((tab) => tab.id === chosen) ? chosen : (last?.id ?? null);

  return (
    <>
      <PageHeader
        title={translator.format('calendar.title')}
        description={translator.format('calendar.description')}
        actions={
          <Button
            tone="primary"
            isDisabled={last === null}
            onPress={() => {
              setAppending(true);
            }}
          >
            {translator.format('calendar.append.action')}
          </Button>
        }
      />

      {unreachable ? (
        <Banner
          tone="warning"
          title={translator.format('data.unreachable')}
          actions={<Button onPress={reload}>{translator.format('action.retry')}</Button>}
        >
          {translator.format('data.unreachable.explanation')}
        </Banner>
      ) : null}

      {tabs.length === 0 ? (
        <Panel>
          <EmptyState
            message={translator.format(isLoading ? 'data.loading' : 'calendar.empty')}
            {...(isLoading ? {} : { description: translator.format('calendar.empty.explanation') })}
          />
        </Panel>
      ) : (
        <Tabs
          label={translator.format('calendar.years')}
          tabs={tabs}
          {...(selected === null ? {} : { selectedKey: selected })}
          onSelectionChange={(key) => {
            setChosen(String(key));
          }}
        />
      )}

      <ShapeDialog
        title={translator.format('calendar.append.title')}
        description={
          last === null
            ? ''
            : translator.format('calendar.append.description', {
                from: formatDay(dayAfter(last.closesOn), formattingLocale),
              })
        }
        submitLabel={translator.format('calendar.append.submit')}
        shape={last === null ? null : shapeOf(last)}
        opensOn={null}
        isOpen={appending}
        onOpenChange={setAppending}
        onSubmit={async ({ shape }) => {
          const delivery = await run((of) => of.append(shape));
          const message = messageFor(delivery);
          if (message === null && delivery.kind === 'done') {
            toast.show(
              translator.format('calendar.appended', {
                label: labelOfYear(translator, delivery.value),
              }),
              { tone: 'success' },
            );
          }
          return message;
        }}
      />

      <ShapeDialog
        title={translator.format('calendar.redefine.title')}
        description={translator.format('calendar.redefine.description')}
        submitLabel={translator.format('calendar.redefine.submit')}
        shape={redefining === null ? null : shapeOf(redefining)}
        opensOn={redefining?.opensOn ?? null}
        isOpen={redefining !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRedefining(null);
        }}
        onSubmit={async ({ shape, opensOn }) => {
          if (redefining === null || opensOn === null) return null;
          const year = redefining.id;
          const delivery = await run((of) => of.redefine(year, { ...shape, opensOn }));
          const message = messageFor(delivery);
          if (message === null && delivery.kind === 'done') {
            toast.show(
              translator.format('calendar.redefined', {
                label: labelOfYear(translator, delivery.value),
              }),
              { tone: 'success' },
            );
          }
          return message;
        }}
      />

      <CloseDialog
        period={closing}
        onClose={() => {
          setClosing(null);
        }}
        onConfirm={async (period) => {
          const delivery = await run((of) => of.close(period.id));
          const message = messageFor(delivery);
          toast.show(
            message ?? translator.format('calendar.closed', { ordinal: period.ordinal }),
            message === null ? { tone: 'success' } : { tone: 'danger' },
          );
        }}
      />

      <ReopenDialog
        period={reopening}
        onClose={() => {
          setReopening(null);
        }}
        onSubmit={async (period, reason) => {
          const delivery = await run((of) => of.reopen(period.id, reason));
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(translator.format('calendar.reopened', { ordinal: period.ordinal }), {
              tone: 'success',
            });
          }
          return message;
        }}
      />
    </>
  );
}

/**
 * What a fiscal year is called on screen: the calendar year it covers, or the
 * two it spans.
 *
 * The same rule `FIN` prints on a document number (`fiscalYearLabel`), written
 * here through the translator so the figures follow the tenant's digits (§5.5)
 * — the module's version is machine text for a receipt, and a screen is read
 * by somebody who chose Arabic-Indic numerals.
 */
function labelOfYear(translator: ReturnType<typeof useTranslator>, year: FiscalYear): string {
  const from = partsOfDay(year.opensOn).year;
  const to = partsOfDay(year.closesOn).year;
  return from === to
    ? translator.format('calendar.year.tab', { year: from })
    : translator.format('calendar.year.tab.spanning', { from, to });
}

/**
 * The shape a year already has, derived from its own periods rather than
 * stored — `FIN`'s own `shapeOf`, for the same reason it derives it: a second
 * copy of the division would be free to disagree with the spans beside it.
 */
function shapeOf(year: FiscalYear): YearShape {
  const months = monthsBetween(year.opensOn, dayAfter(year.closesOn));
  return { months, monthsPerPeriod: months / Math.max(year.periods.length, 1) };
}

function dayAfter(day: LocalDate): LocalDate {
  return addDays(day, 1);
}

function monthsBetween(from: LocalDate, to: LocalDate): number {
  const start = partsOfDay(from);
  const end = partsOfDay(to);
  return (end.year - start.year) * 12 + (end.month - start.month);
}

interface YearProps {
  readonly year: FiscalYear;
  /** Only the last year may be redefined: changing an earlier one moves every year after it. */
  readonly isLast: boolean;
  readonly reopenings: readonly PeriodReopening[];
  readonly onRedefine: () => void;
  readonly onClose: (period: AccountingPeriod) => void;
  readonly onReopen: (period: AccountingPeriod) => void;
}

/** One year: what it spans, its periods, and what has been done to them. */
function Year({ year, isLast, reopenings, onRedefine, onClose, onReopen }: YearProps): ReactNode {
  const translator = useTranslator();
  const { formattingLocale } = useVertex();
  const isOpen = year.periods.some((period) => period.closed === null);

  const columns: readonly DataTableColumn<AccountingPeriod>[] = [
    {
      id: 'ordinal',
      header: translator.format('calendar.period.ordinal'),
      isRowHeader: true,
      render: (period) =>
        translator.format('calendar.period.ordinal.value', { ordinal: period.ordinal }),
    },
    {
      id: 'opensOn',
      header: translator.format('calendar.period.opensOn'),
      render: (period) => <DateTime value={period.opensOn} />,
    },
    {
      id: 'closesOn',
      header: translator.format('calendar.period.closesOn'),
      render: (period) => <DateTime value={period.closesOn} />,
    },
    {
      id: 'state',
      header: translator.format('calendar.period.state'),
      render: (period) => <PeriodState period={period} />,
    },
    {
      id: 'actions',
      header: translator.format('calendar.period.actions'),
      align: 'end',
      width: actionsColumnWidth(1),
      render: (period) => (
        <TableRowActions>
          {period.closed === null ? (
            <TableRowAction
              aria-label={translator.format('calendar.close.action')}
              onPress={() => {
                onClose(period);
              }}
            >
              <CloseYearIcon />
            </TableRowAction>
          ) : (
            <TableRowAction
              aria-label={translator.format('calendar.reopen.action')}
              onPress={() => {
                onReopen(period);
              }}
            >
              <ReopenYearIcon />
            </TableRowAction>
          )}
        </TableRowActions>
      ),
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-[var(--vx-gap-md)]">
        <div className="flex flex-wrap items-center gap-[var(--vx-gap-sm)]">
          <span className="text-body text-fg-secondary">
            {translator.format('calendar.year.span', {
              from: formatDay(year.opensOn, formattingLocale),
              to: formatDay(year.closesOn, formattingLocale),
            })}
          </span>
          <Badge tone={isOpen ? 'success' : 'neutral'}>
            {translator.format(isOpen ? 'calendar.year.state.open' : 'calendar.year.state.closed')}
          </Badge>
        </div>
        {isLast ? (
          <Button onPress={onRedefine}>{translator.format('calendar.redefine.action')}</Button>
        ) : null}
      </div>

      <Panel flush>
        <DataTable
          label={translator.format('calendar.periods')}
          columns={columns}
          rows={year.periods}
          emptyMessage={translator.format('listing.noMatch')}
        />
      </Panel>

      <Reopenings reopenings={reopenings} year={year} />
    </>
  );
}

/**
 * Whether a period is open, and — when it is not — who closed it and when.
 *
 * `closed` is a fact with an author rather than a flag (`AccountingPeriod`), so
 * the badge and the sentence beside it cannot disagree about the same thing.
 */
function PeriodState({ period }: { readonly period: AccountingPeriod }): ReactNode {
  const translator = useTranslator();
  const { users } = useUsers();
  const moment = useMomentWriter();
  const closed = period.closed;
  const who = closed === null ? null : nameOfUser(users, closed.by);

  return (
    <div className="flex flex-wrap items-center gap-[var(--vx-gap-xs)]">
      <Badge tone={closed === null ? 'success' : 'neutral'}>
        {translator.format(
          closed === null ? 'calendar.period.state.open' : 'calendar.period.state.closed',
        )}
      </Badge>
      {/* Neutral, beside a green "open": `info` is teal (§4.3) and two tints
          that close together in one cell are two states nobody can tell apart
          at caption size. Whether a period has postings is ordinary; whether it
          is open is the thing being read. */}
      {period.posted ? (
        <Badge tone="neutral">{translator.format('calendar.period.posted')}</Badge>
      ) : null}
      {closed === null ? null : (
        <span className="text-caption text-fg-muted">
          {who === null
            ? translator.format('calendar.period.closedBySomebody', { at: moment(closed.at) })
            : translator.format('calendar.period.closedBy', { user: who, at: moment(closed.at) })}
        </span>
      )}
    </div>
  );
}

/**
 * What a person is called, or null where the act had no author — a command the
 * system ran on its own behalf (`systemContext`) carries no user at all, and
 * inventing a name for it would be this screen claiming something it does not
 * know.
 */
function nameOfUser(users: ReturnType<typeof useUsers>['users'], id: string | null): string | null {
  if (id === null) return null;
  return users.find((user) => user.id === id)?.name ?? null;
}

/**
 * Writes a moment for the sentences on this screen, in the tenant's own zone.
 *
 * `Instant` is a count of milliseconds, so a message that interpolated one
 * would print the count — which is how this screen once read. It goes through
 * `formatMoment` and not through `<DateTime>` for §12's own reason: these are
 * moments **inside** a sentence, and ICU interpolates text, so a message broken
 * into fragments around an element would have had its word order decided here
 * rather than by whoever translates it.
 *
 * The zone is the tenant's rather than any branch's, because closing a period
 * closes it for the whole shop (`FIN-05`) — see `useTenantZone`. `formatMoment`
 * names it in the text, so a reader elsewhere is not left guessing whose
 * afternoon this was.
 */
function useMomentWriter(): (at: Instant) => string {
  const { formattingLocale } = useVertex();
  const timeZone = useTenantZone();
  return useCallback(
    (at: Instant) => formatMoment(toDate(at), { locale: formattingLocale, timeZone }),
    [formattingLocale, timeZone],
  );
}

/**
 * Every period of this year that was opened again, and why (`FIN-05`).
 *
 * Its own section under the table rather than a column in it: a reopening is
 * read by whoever is reviewing what was done to the books, not by whoever is
 * closing this month, and a period reopened twice has two lines here where a
 * column would have kept only the last.
 */
function Reopenings({
  reopenings,
  year,
}: {
  readonly reopenings: readonly PeriodReopening[];
  readonly year: FiscalYear;
}): ReactNode {
  const translator = useTranslator();
  const { users } = useUsers();
  const moment = useMomentWriter();

  /**
   * Which period of this year was opened again — or null, where it no longer
   * exists.
   *
   * Redefining a year keeps its identity and gives it new periods, and a period
   * that was reopened may be redefined away: `FIN` refuses a redefinition only
   * while a period is **closed**, and a reopened one is open. The reopening
   * stays in the log, because what was done to the books is not unmade by
   * changing the shape of the year, and the line then names no ordinal rather
   * than naming a period nobody can find. Printing `0` — which is what a
   * fallback ordinal reads as — is worse than saying so.
   */
  const ordinalOf = (period: PeriodReopening['period']): number | null =>
    year.periods.find((one) => one.id === period)?.ordinal ?? null;

  return (
    <div className="flex flex-col gap-[var(--vx-gap-sm)]">
      <h3 className="text-footnote font-body-medium text-fg-secondary">
        {translator.format('calendar.reopenings')}
      </h3>
      {reopenings.length === 0 ? (
        <p className="text-body text-fg-muted">{translator.format('calendar.reopenings.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
          {reopenings.map((one) => {
            const who = nameOfUser(users, one.by);
            const ordinal = ordinalOf(one.period);
            return (
              <li key={one.id} className="text-body text-fg-secondary">
                <span>
                  {translator.format(
                    ordinal === null
                      ? 'calendar.reopening.line.redefined'
                      : 'calendar.reopening.line',
                    {
                      ordinal: ordinal ?? 0,
                      closedAt: moment(one.undone.at),
                      at: moment(one.at),
                    },
                  )}
                </span>
                {who === null ? null : (
                  <span className="text-fg-muted">
                    {' — '}
                    {translator.format('calendar.reopening.by', { user: who })}
                  </span>
                )}
                <p className="text-footnote text-fg-muted">{one.reason}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The divisors of a year's length: the only period lengths that tile it exactly. */
function periodOptions(
  translator: ReturnType<typeof useTranslator>,
  months: number,
): readonly SelectOption[] {
  const options: SelectOption[] = [];
  for (let length = 1; length <= months; length += 1) {
    if (months % length !== 0) continue;
    options.push({
      id: String(length),
      label: translator.format('calendar.shape.monthsPerPeriod.value', { months: length }),
    });
  }
  return options;
}

const MOST_MONTHS = 24;

function monthOptions(translator: ReturnType<typeof useTranslator>): readonly SelectOption[] {
  const options: SelectOption[] = [];
  for (let months = 1; months <= MOST_MONTHS; months += 1) {
    options.push({
      id: String(months),
      label: translator.format('calendar.shape.months.value', { months }),
    });
  }
  return options;
}

interface ShapeFields {
  readonly shape: YearShape;
  /** The day the year opens on — asked only where it may be chosen. */
  readonly opensOn: LocalDate | null;
}

interface ShapeDialogProps {
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  /** The shape to start from: the year being redefined, or the one the new year follows. */
  readonly shape: YearShape | null;
  /** The day being redefined, or null when the start is not the accountant's to choose. */
  readonly opensOn: LocalDate | null;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSubmit: (fields: ShapeFields) => Promise<string | null>;
}

/**
 * Adding the next year, and redefining one — one dialog, because the
 * difference between them is a single question: **when the year starts.**
 *
 * Appending never asks it. "Appended without gaps" means the only day a new
 * year may begin on is the one after the calendar currently reaches, so the
 * dialog says which day that is rather than offering a field `FIN` would
 * refuse every other answer to. Redefining asks it, because that is the whole
 * point of redefining — the shop whose books turn out to run from April.
 *
 * The two choices cannot produce an invalid pair: the period lengths offered
 * are the divisors of the year's length, which is exactly `FIN`'s own rule.
 * `FIN` still judges what arrives, because a screen is not where a rule lives.
 */
function ShapeDialog({
  title,
  description,
  submitLabel,
  shape,
  opensOn,
  isOpen,
  onOpenChange,
  onSubmit,
}: ShapeDialogProps): ReactNode {
  const translator = useTranslator();
  const [months, setMonths] = useState('12');
  const [perPeriod, setPerPeriod] = useState('1');
  const [day, setDay] = useState<LocalDate | null>(null);
  const [isMissing, setIsMissing] = useState(false);

  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
    // Keyed on `isOpen` alone. `shape` is derived (`shapeOf`) and is therefore a
    // fresh object on every render of the screen around this dialog, so keying
    // on it re-ran the reset whenever anything else on the page changed —
    // blanking a year length somebody had just chosen. `isOpen` changes exactly
    // when this dialog is opened, which is what `useAttempt` asks for; there is
    // one of these per act, so neither is ever retargeted while open.
  } = useAttempt(isOpen, () => {
    setMonths(String(shape?.months ?? 12));
    setPerPeriod(String(shape?.monthsPerPeriod ?? 1));
    setDay(opensOn);
    setIsMissing(false);
  });

  const lengths = useMemo(() => periodOptions(translator, Number(months)), [translator, months]);
  const periods = Number(months) / Number(perPeriod);

  async function attempt(): Promise<void> {
    if (isWorking) return;
    // The day is asked for only where it is the accountant's to give, so a
    // blank one is a question unanswered rather than a value to guess at.
    if (opensOn !== null && day === null) {
      setIsMissing(true);
      reportInvalid();
      return;
    }
    await attemptWith(async () => {
      const message = await onSubmit({
        shape: { months: Number(months), monthsPerPeriod: Number(perPeriod) },
        opensOn: day,
      });
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
          <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <p className="text-body text-fg-secondary">{description}</p>
        {opensOn === null ? null : (
          <DateInput
            label={translator.format('calendar.redefine.opensOn')}
            value={day}
            onChange={(next) => {
              setDay(next);
              setIsMissing(false);
            }}
            placeholder={opensOn}
            autoFocus
            isRequired
            {...(isMissing
              ? { errorMessage: translator.format('calendar.redefine.opensOn.required') }
              : {})}
          />
        )}
        <Select
          label={translator.format('calendar.shape.months')}
          description={translator.format('calendar.shape.months.description')}
          options={monthOptions(translator)}
          value={months}
          onChange={(key) => {
            const next = String(key);
            setMonths(next);
            // A period length that no longer divides the year is not a
            // choice any more; monthly always is, and is the default a shop
            // that has just changed its year end would pick anyway.
            if (Number(next) % Number(perPeriod) !== 0) setPerPeriod('1');
          }}
        />
        <Select
          label={translator.format('calendar.shape.monthsPerPeriod')}
          description={translator.format('calendar.shape.monthsPerPeriod.description')}
          options={lengths}
          value={perPeriod}
          onChange={(key) => {
            setPerPeriod(String(key));
          }}
        />
        <p className="text-footnote text-fg-muted">
          {translator.format('calendar.shape.periods', { periods })}
        </p>
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

interface CloseDialogProps {
  readonly period: AccountingPeriod | null;
  readonly onClose: () => void;
  readonly onConfirm: (period: AccountingPeriod) => Promise<void>;
}

/**
 * Closing a period.
 *
 * A confirmation rather than a bare button, and one that says what it costs in
 * the words `FIN-05` uses: every posting dated inside the span is refused from
 * here on, and a late arrival from a register that was offline is routed to the
 * exceptions queue rather than lost.
 */
function CloseDialog({ period, onClose, onConfirm }: CloseDialogProps): ReactNode {
  const translator = useTranslator();
  const { formattingLocale } = useVertex();

  return (
    <Dialog
      title={translator.format('calendar.close.title')}
      isOpen={period !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      footer={
        <>
          <Button tone="secondary" onPress={onClose}>
            {translator.format('action.cancel')}
          </Button>
          <Button
            tone="primary"
            onPress={() => {
              if (period === null) return;
              const taken = period;
              onClose();
              void onConfirm(taken);
            }}
          >
            {translator.format('calendar.close.submit')}
          </Button>
        </>
      }
    >
      <p className="text-body text-fg">
        {period === null
          ? ''
          : translator.format('calendar.close.message', {
              from: formatDay(period.opensOn, formattingLocale),
              to: formatDay(period.closesOn, formattingLocale),
            })}
      </p>
    </Dialog>
  );
}

interface ReopenDialogProps {
  readonly period: AccountingPeriod | null;
  readonly onClose: () => void;
  readonly onSubmit: (period: AccountingPeriod, reason: string) => Promise<string | null>;
}

/**
 * Opening a closed period again.
 *
 * The reason is required here as well as in `FIN`, and the dialog says why the
 * act is allowed at all: the alternative — dating an entry that belongs in a
 * closed month into an open one — is a distortion nobody can see, where this is
 * one every reader of the log can. The right is the owner's and is sensitive
 * (`SEC-05`), so in a shop this dialog is reached by one person and is answered
 * by a second question the platform asks; here it is offered and `FIN` refuses
 * whoever may not.
 */
function ReopenDialog({ period, onClose, onSubmit }: ReopenDialogProps): ReactNode {
  const translator = useTranslator();
  const [reason, setReason] = useState('');
  const [isMissing, setIsMissing] = useState(false);

  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(period, () => {
    setReason('');
    setIsMissing(false);
  });

  async function attempt(): Promise<void> {
    if (isWorking || period === null) return;
    if (reason.trim() === '') {
      setIsMissing(true);
      reportInvalid();
      return;
    }
    const taken = period;
    await attemptWith(async () => {
      const message = await onSubmit(taken, reason.trim());
      if (message === null) onClose();
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('calendar.reopen.title')}
      isOpen={period !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      footer={
        <>
          <Button tone="secondary" onPress={onClose}>
            {translator.format('action.cancel')}
          </Button>
          <Button tone="danger" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format('calendar.reopen.submit')}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <p className="text-body text-fg-secondary">
          {translator.format('calendar.reopen.description')}
        </p>
        <TextArea
          label={translator.format('calendar.reopen.reason')}
          description={translator.format('calendar.reopen.reason.description')}
          value={reason}
          onChange={(next) => {
            setReason(next);
            setIsMissing(false);
          }}
          autoFocus
          isRequired
          {...(isMissing
            ? { errorMessage: translator.format('calendar.reopen.reason.required') }
            : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
