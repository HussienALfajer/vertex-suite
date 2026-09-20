import { useState, type ReactNode } from 'react';

import type { LocalDate } from '@vertex/kernel';
import type { ExceptionDecision, PostingException } from '@vertex/fin/contract';
import {
  actionsColumnWidth,
  Badge,
  Banner,
  Button,
  Code,
  DataTable,
  DateInput,
  DateTime,
  Dialog,
  PageHeader,
  Panel,
  Switch,
  TableRowAction,
  TableRowActions,
  TextArea,
  useAttempt,
  useToast,
  useTranslator,
  type DataTableColumn,
} from '@vertex/ui';

import { messageForRefusal } from '../catalogue.js';
import { useLedger } from '../ledger.js';
import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import { useNavigateTo } from '../routing.js';
import { Figure, useBranchName, useEntryTitle, useMomentWriter } from './books.js';
import { OpenListIcon, ReadState } from './structure.js';

/**
 * `FIN-05`'s exceptions queue: what arrived for a month that had already been
 * closed, waiting for somebody to decide.
 *
 * **Every one of these is a sale that happened.** A register that traded
 * offline posts its entries where it stands and sends them on; the month may
 * have been closed in the meantime, and `FIN-02` allows no business event
 * without its entry — so the entry is not refused and not dropped, it is put
 * here exactly as it was made, and a person decides.
 *
 * **Two decisions and no third**, which is the contract's own shape. The entry
 * may be posted **as dated**, once the owner has reopened its period — which is
 * why reopening exists (`FIN-05`, the fiscal-calendar screen). Or it may be
 * posted **on another day** that falls in a period still open, against a
 * written reason: the ordinary way a late fact enters closed books. There is
 * no dismissal, because an event that should never have happened is posted and
 * then reversed, where both acts can be read.
 */
export function PostingExceptions(): ReactNode {
  const translator = useTranslator();
  const goTo = useNavigateTo();
  const { exceptions } = useLedger();
  const { branches } = useOrganisation();
  const nameOfBranch = useBranchName();
  const titleOf = useEntryTitle();
  const moment = useMomentWriter();

  const [includeResolved, setIncludeResolved] = useState(false);
  const [deciding, setDeciding] = useState<PostingException | null>(null);

  const queue = useLoaded(includeResolved ? 'all' : 'pending', (including) =>
    exceptions.exceptions({ including: including === 'all' ? 'all' : 'pending' }),
  );

  const rows = queue.value ?? [];
  const showBranch = branches.length > 1;

  const columns: readonly DataTableColumn<PostingException>[] = [
    {
      id: 'number',
      header: translator.format('exceptions.column.number'),
      isRowHeader: true,
      width: 180,
      render: (one) => <Code>{one.arrived.entry.number}</Code>,
    },
    {
      id: 'day',
      header: translator.format('exceptions.column.day'),
      width: 140,
      render: (one) => <DateTime value={one.arrived.entry.day} />,
    },
    {
      id: 'arrivedAt',
      header: translator.format('exceptions.column.arrivedAt'),
      width: 220,
      render: (one) => <span className="text-fg-secondary">{moment(one.arrivedAt)}</span>,
    },
    ...(showBranch
      ? [
          {
            id: 'branch',
            header: translator.format('exceptions.column.branch'),
            width: 160,
            render: (one: PostingException) => (
              <span className="text-fg-secondary">{nameOfBranch(one.arrived.entry.branch)}</span>
            ),
          },
        ]
      : []),
    {
      id: 'why',
      header: translator.format('exceptions.column.why'),
      render: (one) => (
        <span className="flex min-w-0 flex-col gap-[var(--vx-gap-xs)]">
          <span className="truncate">
            {titleOf(one.arrived.entry.source, one.arrived.entry.description)}
          </span>
          {/* The calendar's own answer at the moment it arrived, which is what
              the person deciding needs to read first. */}
          <span className="text-caption text-fg-muted truncate">
            {messageForRefusal(translator, one.refused)}
          </span>
        </span>
      ),
    },
    {
      id: 'total',
      header: translator.format('exceptions.column.total'),
      align: 'end',
      width: 180,
      render: (one) => <Figure amount={one.arrived.entry.total} />,
    },
    {
      id: 'state',
      header: translator.format('exceptions.column.state'),
      width: 240,
      render: (one) =>
        one.resolved === null ? (
          <Badge tone="warning">{translator.format('exceptions.state.waiting')}</Badge>
        ) : (
          <span className="flex flex-col gap-[var(--vx-gap-xs)]">
            <Badge tone="success">{translator.format('exceptions.state.posted')}</Badge>
            <span className="text-caption text-fg-muted">
              {translator.format('exceptions.state.postedOn', {
                at: moment(one.resolved.at),
              })}
            </span>
          </span>
        ),
    },
    {
      id: 'actions',
      header: translator.format('exceptions.column.actions'),
      align: 'end',
      // Two: decide on what is waiting, or open the entry a decision produced.
      width: actionsColumnWidth(2),
      render: (one) => (
        <TableRowActions>
          {one.resolved === null ? (
            <TableRowAction
              aria-label={translator.format('exceptions.decide.action')}
              onPress={() => {
                setDeciding(one);
              }}
            >
              <DecideIcon />
            </TableRowAction>
          ) : (
            <TableRowAction
              aria-label={translator.format('exceptions.open.action')}
              onPress={() => {
                goTo('journal', one.arrived.entry.id);
              }}
            >
              <OpenListIcon />
            </TableRowAction>
          )}
        </TableRowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={translator.format('exceptions.title')}
        description={translator.format('exceptions.description')}
      />

      <div className="flex flex-wrap items-end justify-between gap-[var(--vx-gap-md)]">
        <p className="text-body text-fg-secondary max-w-[48rem]">
          {translator.format('exceptions.explanation')}
        </p>
        <Switch isSelected={includeResolved} onChange={setIncludeResolved}>
          {translator.format('exceptions.includeResolved')}
        </Switch>
      </div>

      <ReadState loaded={queue} />

      <Panel flush>
        <DataTable<PostingException>
          label={translator.format('exceptions.table')}
          columns={columns}
          rows={rows}
          emptyMessage={translator.format(
            queue.isLoading
              ? 'data.loading'
              : includeResolved
                ? 'exceptions.empty.all'
                : 'exceptions.empty',
          )}
        />
      </Panel>

      <DecisionDialog
        subject={deciding}
        onClose={() => {
          setDeciding(null);
        }}
        onDone={() => {
          setDeciding(null);
          queue.reload();
        }}
      />
    </>
  );
}

/**
 * The decision, which is one of two.
 *
 * "As dated" is offered whether or not the period is open again, and is
 * **refused** rather than hidden when it is not — because the answer changes
 * between this dialog being opened and the button being pressed, and because
 * the refusal is the one sentence that tells an accountant exactly what to do
 * next: reopen the period, or choose another day. That is the opposite of the
 * chart's parent chooser, and the difference is that this condition is not a
 * property of the thing being chosen.
 */
function DecisionDialog({
  subject,
  onClose,
  onDone,
}: {
  readonly subject: PostingException | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { exceptions, run } = useLedger();
  const messageFor = useDeliveryMessage();

  const [redate, setRedate] = useState(false);
  const [day, setDay] = useState<LocalDate | null>(null);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState({ day: false, reason: false });

  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(subject, () => {
    setRedate(false);
    setDay(subject?.arrived.entry.day ?? null);
    setReason('');
    setMissing({ day: false, reason: false });
  });

  async function attempt(): Promise<void> {
    if (isWorking || subject === null) return;

    if (redate) {
      const blank = { day: day === null, reason: reason.trim() === '' };
      setMissing(blank);
      if (blank.day || blank.reason) {
        reportInvalid();
        return;
      }
    }
    const on = day;
    // As dated is the decision with nothing to say: `post` takes no decision at
    // all, rather than one repeating the day the entry already carries.
    const decision: ExceptionDecision | undefined =
      redate && on !== null ? { day: on, reason: reason.trim() } : undefined;

    await attemptWith(async () => {
      const delivery = await run(() => exceptions.post(subject.id, decision));
      const message = messageFor(delivery);
      if (message === null && delivery.kind === 'done') {
        toast.show(
          translator.format('exceptions.posted', { number: delivery.value.entry.number }),
          { tone: 'success' },
        );
        onDone();
      }
      return message;
    });
  }

  const entry = subject?.arrived.entry ?? null;

  return (
    <Dialog
      title={translator.format('exceptions.decide.title')}
      isOpen={subject !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      footer={
        <>
          <Button tone="secondary" onPress={onClose}>
            {translator.format('action.cancel')}
          </Button>
          <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format('exceptions.decide.submit')}
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
          {translator.format('exceptions.decide.description')}
        </p>
        <div className="flex flex-wrap items-baseline gap-[var(--vx-gap-md)]">
          <Code>{entry?.number ?? ''}</Code>
          {entry === null ? null : <DateTime value={entry.day} />}
          {entry === null ? null : <Figure amount={entry.total} />}
        </div>
        {subject === null ? null : (
          <Banner tone="info">{messageForRefusal(translator, subject.refused)}</Banner>
        )}

        <Switch
          isSelected={redate}
          onChange={(on) => {
            setRedate(on);
            setMissing({ day: false, reason: false });
          }}
        >
          {translator.format('exceptions.decide.redate')}
        </Switch>

        {redate ? (
          <>
            <DateInput
              label={translator.format('exceptions.decide.day')}
              description={translator.format('exceptions.decide.day.description')}
              value={day}
              onChange={(next) => {
                setDay(next);
                setMissing((was) => ({ ...was, day: false }));
              }}
              {...(entry === null ? {} : { placeholder: entry.day })}
              isRequired
              {...(missing.day
                ? { errorMessage: translator.format('exceptions.decide.day.required') }
                : {})}
            />
            <TextArea
              label={translator.format('exceptions.decide.reason')}
              description={translator.format('exceptions.decide.reason.description')}
              value={reason}
              onChange={(next) => {
                setReason(next);
                setMissing((was) => ({ ...was, reason: false }));
              }}
              isRequired
              {...(missing.reason
                ? { errorMessage: translator.format('exceptions.decide.reason.required') }
                : {})}
            />
          </>
        ) : (
          <p className="text-body text-fg-muted">
            {translator.format('exceptions.decide.asDated')}
          </p>
        )}
        {/* The form needs a submit control for Enter to mean anything, and the
            one a person clicks is in the footer where a dialog's actions belong. */}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

/** A gavel over a line: a decision taken, rather than a record edited. */
function DecideIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="fill-none stroke-current"
      strokeWidth="1.5"
    >
      <path d="M4 17h8" strokeLinecap="round" />
      <path d="M7.5 5.5l4-2.5 5 5-2.5 4z" strokeLinejoin="round" />
      <path d="M6 8.5l4 4" strokeLinecap="round" />
    </svg>
  );
}
