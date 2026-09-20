import { useState, type ReactNode } from 'react';

import type { LocalDate } from '@vertex/kernel';
import type {
  Attachment,
  JournalEntry,
  JournalEntryId,
  JournalLine,
  Posted,
  Reversal,
} from '@vertex/fin/contract';
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
  TableRowAction,
  TableRowActions,
  TextArea,
  useAttempt,
  useToast,
  useTranslator,
  type DataTableColumn,
} from '@vertex/ui';

import { useCalendar } from '../calendar.js';
import { useLedger } from '../ledger.js';
import { useDeliveryMessage, useLoaded, useOrganisation, type Loaded } from '../organisation.js';
import { hrefOf, redirect, useNavigateTo, useRoute } from '../routing.js';
import {
  AccountName,
  BranchFilter,
  EVERY_BRANCH,
  Figure,
  useBooksYear,
  useBranchName,
  useEntryTitle,
  type Span,
} from './books.js';
import { OpenListIcon, ReadState } from './structure.js';

/**
 * `FIN-02` and `FIN-03`: the journal every business event writes itself into,
 * read — and the one correction there is to it.
 *
 * **Nothing here writes an ordinary entry, and that is the feature.** `FIN-02`
 * says every business event produces its entry *with no user action*, in the
 * same transaction as the event; a screen with a "post" button on it would be
 * a second way for an entry to exist, and the one way a sale could end up in
 * the books twice. What a person does here is read, and correct — and a
 * correction is a **reversing entry** and never an edit, because `FIN-03`
 * leaves nothing beneath this interface that could edit or delete a line.
 *
 * **Reversing is offered from the entry and not from its row**, which is the
 * screen making a refusal unreachable rather than explaining it. An entry is
 * reversed once (`fin.entry-already-reversed`), and whether this one has been
 * is an answer only `reversalOf` has — so the control appears beside that
 * answer, next to the lines the person is correcting, rather than on a row
 * that would have to guess.
 *
 * The entry being read is in the **address** (`routing.ts`): a journal is
 * printed, filed and quoted, and a person who found an entry has to be able to
 * send somebody else to it.
 */
export function Journal(): ReactNode {
  const translator = useTranslator();
  const route = useRoute();
  const goTo = useNavigateTo();
  const { journal } = useLedger();
  const { branches } = useOrganisation();
  const { isLoading: calendarLoading } = useCalendar();
  const nameOfBranch = useBranchName();
  const titleOf = useEntryTitle();

  const [branch, setBranch] = useState<string>(EVERY_BRANCH);
  const booksYear = useBooksYear();
  const [span, setSpan] = useState<Span>(booksYear);

  // The span the books are open over arrives with the calendar, a render or two
  // after this screen mounts, and it seeds the filter **once**. Adjusted while
  // rendering rather than in an effect, so the first read is already bounded;
  // and only once, so that a person who widened or cleared the dates keeps
  // what they chose.
  const [seeded, setSeeded] = useState(booksYear.from !== null);
  if (!seeded && booksYear.from !== null) {
    setSeeded(true);
    setSpan(booksYear);
  }

  /**
   * The listing, asked under the filter it is a listing of.
   *
   * The key is the filter written down, which is what it actually is: change a
   * bound and it is a different read, and `useLoaded` starts one. It is null
   * until the calendar has answered, so the screen asks once — bounded — rather
   * than reading the whole journal and then reading a year of it.
   */
  const entries = useLoaded(
    calendarLoading ? null : `${branch}|${span.from ?? ''}|${span.to ?? ''}`,
    () =>
      journal.entries({
        ...(branch === EVERY_BRANCH ? {} : { branch: branch as JournalEntry['branch'] }),
        ...(span.from === null ? {} : { from: span.from }),
        ...(span.to === null ? {} : { to: span.to }),
      }),
  );

  const opened = useLoaded(route.subject, async (id) => {
    // The brand is a compile-time claim and the address is text: an identifier
    // that names no entry is answered with null, which is what the read below
    // is written against.
    const entry = id as JournalEntryId;
    const [posted, reversal] = await Promise.all([journal.entry(entry), journal.reversalOf(entry)]);
    return { posted, reversal };
  });

  const rows = entries.value ?? [];
  const showBranch = branch === EVERY_BRANCH && branches.length > 1;

  const columns: readonly DataTableColumn<JournalEntry>[] = [
    {
      id: 'number',
      header: translator.format('journal.column.number'),
      isRowHeader: true,
      width: 180,
      render: (entry) => <Code>{entry.number}</Code>,
    },
    {
      id: 'day',
      header: translator.format('journal.column.day'),
      width: 140,
      render: (entry) => <DateTime value={entry.day} />,
    },
    ...(showBranch
      ? [
          {
            id: 'branch',
            header: translator.format('journal.column.branch'),
            width: 160,
            render: (entry: JournalEntry) => (
              <span className="text-fg-secondary">{nameOfBranch(entry.branch)}</span>
            ),
          },
        ]
      : []),
    {
      id: 'title',
      header: translator.format('journal.column.description'),
      render: (entry) => (
        <span className="flex min-w-0 items-center gap-[var(--vx-gap-sm)]">
          <span className="truncate">{titleOf(entry.source, entry.description)}</span>
          {entry.reverses === null ? null : (
            <Badge tone="warning">{translator.format('journal.badge.reversing')}</Badge>
          )}
          {entry.exception === null ? null : (
            <Badge tone="info">{translator.format('journal.badge.fromQueue')}</Badge>
          )}
        </span>
      ),
    },
    {
      id: 'total',
      header: translator.format('journal.column.total'),
      align: 'end',
      width: 200,
      render: (entry) => <Figure amount={entry.total} />,
    },
    {
      id: 'actions',
      header: translator.format('journal.column.actions'),
      align: 'end',
      // One: an entry is opened, and everything a person does to it is done
      // from the entry itself.
      width: actionsColumnWidth(1),
      render: (entry) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format('journal.open.action')}
            onPress={() => {
              redirect(hrefOf('journal', entry.id));
            }}
          >
            <OpenListIcon />
          </TableRowAction>
        </TableRowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={translator.format('journal.title')}
        description={translator.format('journal.description')}
        actions={
          <Button
            tone="primary"
            onPress={() => {
              goTo('manual-entry');
            }}
          >
            {translator.format('journal.record')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-[var(--vx-gap-md)]">
        <BranchFilter
          label={translator.format('journal.filter.branch')}
          allLabel={translator.format('journal.filter.branch.all')}
          value={branch}
          onChange={setBranch}
          className="w-[16rem] max-w-full"
        />
        <DateInput
          label={translator.format('journal.filter.from')}
          value={span.from}
          onChange={(from) => {
            setSpan((was) => ({ ...was, from }));
          }}
          {...(booksYear.from === null ? {} : { placeholder: booksYear.from })}
          className="w-[12rem]"
        />
        <DateInput
          label={translator.format('journal.filter.to')}
          value={span.to}
          onChange={(to) => {
            setSpan((was) => ({ ...was, to }));
          }}
          {...(booksYear.to === null ? {} : { placeholder: booksYear.to })}
          className="w-[12rem]"
        />
      </div>

      <ReadState loaded={entries} />

      <Panel flush>
        <DataTable<JournalEntry>
          label={translator.format('journal.table')}
          columns={columns}
          rows={rows}
          // Still loading while the calendar is: the listing has not been
          // asked for yet, and "no entries" would be an answer nobody gave.
          emptyMessage={translator.format(
            calendarLoading || entries.isLoading ? 'data.loading' : 'journal.empty',
          )}
        />
      </Panel>

      <EntryDetail
        loaded={opened}
        onClose={() => {
          redirect(hrefOf('journal'));
        }}
        onReversed={() => {
          opened.reload();
          entries.reload();
        }}
      />
    </>
  );
}

interface OpenedEntry {
  readonly posted: Posted | null;
  readonly reversal: Reversal | null;
}

/**
 * The entry itself: its facts, its lines, what was attached to it, and whether
 * it still stands.
 *
 * Below the listing rather than over it in a dialog, for two reasons that
 * point the same way. An entry is read **against** the journal around it — the
 * one before it, the one that reversed it — and a modal takes that away to say
 * one thing. And reversing opens a dialog of its own; a dialog inside a dialog
 * is two layers of focus trap over a page whose content nobody can see.
 */
function EntryDetail({
  loaded,
  onClose,
  onReversed,
}: {
  readonly loaded: Loaded<OpenedEntry>;
  readonly onClose: () => void;
  readonly onReversed: () => void;
}): ReactNode {
  const translator = useTranslator();
  const nameOfBranch = useBranchName();
  const titleOf = useEntryTitle();
  const [reversing, setReversing] = useState(false);

  const opened = loaded.value;
  if (opened === null) return <ReadState loaded={loaded} />;

  if (opened.posted === null) {
    return (
      <Banner
        tone="warning"
        title={translator.format('journal.notFound')}
        actions={<Button onPress={onClose}>{translator.format('journal.close')}</Button>}
      >
        {translator.format('journal.notFound.explanation')}
      </Banner>
    );
  }

  const { entry, lines, attachments } = opened.posted;

  return (
    <>
      <Panel
        title={
          <span className="flex flex-wrap items-baseline gap-[var(--vx-gap-md)]">
            <Code>{entry.number}</Code>
            <span className="text-body text-fg-secondary">
              {titleOf(entry.source, entry.description)}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-[var(--vx-gap-sm)]">
            {/* Offered only where it can succeed: an entry is reversed once
                (`FIN-03`), and this is the one place that has read the answer. */}
            {opened.reversal === null ? (
              <Button
                tone="danger"
                onPress={() => {
                  setReversing(true);
                }}
              >
                {translator.format('journal.reverse.action')}
              </Button>
            ) : null}
            <Button tone="secondary" onPress={onClose}>
              {translator.format('journal.close')}
            </Button>
          </div>
        }
      >
        <EntryFactsList entry={entry} branchName={nameOfBranch(entry.branch)} />

        {opened.reversal === null ? null : (
          <Banner tone="warning" title={translator.format('journal.reversed.title')}>
            {translator.format('journal.reversed.explanation')}
          </Banner>
        )}

        <LineTable lines={lines} />

        <Attachments entry={entry.id} attachments={attachments} />
      </Panel>

      <ReverseDialog
        entry={reversing ? entry : null}
        onClose={() => {
          setReversing(false);
        }}
        onDone={() => {
          setReversing(false);
          onReversed();
        }}
      />
    </>
  );
}

/** What is settled about an entry the moment it is posted, laid out as a list of facts. */
function EntryFactsList({
  entry,
  branchName,
}: {
  readonly entry: JournalEntry;
  readonly branchName: string;
}): ReactNode {
  const translator = useTranslator();

  return (
    <dl className="grid gap-x-[var(--vx-gap-xl)] gap-y-[var(--vx-gap-sm)] sm:grid-cols-2 lg:grid-cols-3">
      <Fact term={translator.format('journal.fact.day')}>
        <DateTime value={entry.day} />
      </Fact>
      <Fact term={translator.format('journal.fact.branch')}>{branchName}</Fact>
      <Fact term={translator.format('journal.fact.source')}>
        <Code>{`${entry.source.kind} · ${entry.source.document}`}</Code>
      </Fact>
      <Fact term={translator.format('journal.fact.total')}>
        <Figure amount={entry.total} />
      </Fact>
      {entry.register === null ? null : (
        <Fact term={translator.format('journal.fact.register')}>
          <Code>{entry.register}</Code>
        </Fact>
      )}
      {entry.description === null ? null : (
        <Fact term={translator.format('journal.fact.description')}>{entry.description}</Fact>
      )}
    </dl>
  );
}

function Fact({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-[var(--vx-gap-xs)]">
      <dt className="text-caption text-fg-muted">{term}</dt>
      <dd className="text-body text-fg min-w-0 truncate">{children}</dd>
    </div>
  );
}

/**
 * The lines, in the order the entry keeps them.
 *
 * Debit and credit are **two columns** and not one figure with a mark, because
 * that is what a journal is: the proof that the two sides came to the same
 * figure is read down the page, and a reader who has to check a badge on every
 * row to know which column a figure belongs in is a reader who cannot see it.
 *
 * A line stated in another currency shows what the document said beside what
 * the books hold (`DraftLine`), because the two are different facts and the
 * first is the one the customer saw.
 */
function LineTable({ lines }: { readonly lines: readonly JournalLine[] }): ReactNode {
  const translator = useTranslator();

  const columns: readonly DataTableColumn<JournalLine>[] = [
    {
      id: 'ordinal',
      header: translator.format('journal.line.ordinal'),
      isRowHeader: true,
      width: 70,
      render: (line) => translator.format('journal.line.ordinal.value', { ordinal: line.ordinal }),
    },
    {
      id: 'account',
      header: translator.format('journal.line.account'),
      render: (line) => (
        <span className="flex min-w-0 items-center gap-[var(--vx-gap-sm)]">
          <AccountName id={line.account} />
          {line.memo === null ? null : (
            <span className="text-caption text-fg-muted truncate">{line.memo}</span>
          )}
        </span>
      ),
    },
    {
      id: 'original',
      header: translator.format('journal.line.original'),
      align: 'end',
      width: 180,
      render: (line) => (line.original === null ? null : <Figure amount={line.original} />),
    },
    {
      id: 'debit',
      header: translator.format('entry.side.debit'),
      align: 'end',
      width: 180,
      render: (line) => (line.side === 'debit' ? <Figure amount={line.amount} /> : null),
    },
    {
      id: 'credit',
      header: translator.format('entry.side.credit'),
      align: 'end',
      width: 180,
      render: (line) => (line.side === 'credit' ? <Figure amount={line.amount} /> : null),
    },
  ];

  return (
    <DataTable<JournalLine>
      label={translator.format('journal.lines')}
      columns={columns}
      rows={lines}
      emptyMessage={translator.format('journal.lines.empty')}
    />
  );
}

/**
 * The evidence for an entry (`FIN-04`): what was attached, and a way to open
 * it.
 *
 * The **record** is what the journal holds — the name, the type, the size and
 * the SHA-256 of the bytes — and the bytes are fetched one at a time and only
 * when somebody asks for them, which is the arrangement `Journal.attachment`
 * exists for: ten megabytes of scanned invoice have no business travelling
 * with a listing of the journal.
 */
function Attachments({
  entry,
  attachments,
}: {
  readonly entry: JournalEntryId;
  readonly attachments: readonly Attachment[];
}): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { journal } = useLedger();
  const [fetching, setFetching] = useState<number | null>(null);

  if (attachments.length === 0) return null;

  async function open(attachment: Attachment): Promise<void> {
    setFetching(attachment.ordinal);
    try {
      const file = await journal.attachment(entry, attachment.ordinal);
      if (file === null) {
        toast.show(translator.format('journal.attachment.missing'), { tone: 'danger' });
        return;
      }
      handOver(file.attachment.name, file.attachment.mediaType, file.bytes);
    } catch {
      toast.show(translator.format('refusal.unknown'), { tone: 'danger' });
    } finally {
      setFetching(null);
    }
  }

  return (
    <section className="flex flex-col gap-[var(--vx-gap-sm)]">
      <h3 className="text-footnote font-medium text-fg-secondary">
        {translator.format('journal.attachments')}
      </h3>
      <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
        {attachments.map((attachment) => (
          <li
            key={attachment.id}
            className="bg-fill-secondary border-line flex items-center gap-[var(--vx-gap-sm)] rounded border px-[var(--vx-pad-md)] py-[var(--vx-pad-xs)]"
          >
            <span className="text-body text-fg min-w-0 flex-1 truncate">{attachment.name}</span>
            {/* The hash, shortened, because what it is for is comparing: an
                auditor holding a copy of the file checks the first characters
                against their own and has an answer in a second. */}
            <Code className="text-fg-muted shrink-0">{attachment.sha256.slice(0, 12)}</Code>
            <Button
              tone="secondary"
              isDisabled={fetching !== null}
              onPress={() => void open(attachment)}
            >
              {translator.format('journal.attachment.open')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Hands the bytes to the browser as a file.
 *
 * An object URL and a link clicked in code, because that is the only way a
 * page gives somebody a file it holds in memory: the alternative is a second
 * request for bytes this application already has, through a URL that would
 * have to be reachable without the session that authorised it. The URL is
 * revoked immediately — the browser has taken what it needs by the time the
 * click returns — so nothing is left pinning ten megabytes in memory.
 */
function handOver(name: string, mediaType: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType }));
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * `FIN-03`'s correction: a reversing entry that references the original.
 *
 * Two fields and no third. The **day**, which may not be before the original's
 * — a book that showed the cure before the illness — and defaults to the
 * original's own, so a correction made in the same open period is one keystroke.
 * And the **reason**, which the contract requires: a correction nobody can
 * explain a month later is an error an auditor has to assume.
 *
 * Nothing about the lines is offered, because a reversal is not a new entry: it
 * is the same lines on the other side, at the same amounts and the same stamps
 * — a reversal undoes at the rate the original used, or it is not a reversal.
 */
function ReverseDialog({
  entry,
  onClose,
  onDone,
}: {
  readonly entry: JournalEntry | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { journal, run } = useLedger();
  const messageFor = useDeliveryMessage();

  const [day, setDay] = useState<LocalDate | null>(null);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState({ day: false, reason: false });

  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(entry, () => {
    setDay(entry?.day ?? null);
    setReason('');
    setMissing({ day: false, reason: false });
  });

  async function attempt(): Promise<void> {
    if (isWorking || entry === null) return;

    const blank = { day: day === null, reason: reason.trim() === '' };
    setMissing(blank);
    if (blank.day || blank.reason) {
      reportInvalid();
      return;
    }
    const on = day;
    if (on === null) return;

    await attemptWith(async () => {
      const delivery = await run(() =>
        journal.reverse(entry.id, { day: on, reason: reason.trim() }),
      );
      const message = messageFor(delivery);
      if (message === null) {
        toast.show(
          translator.format('journal.reversed', {
            number: delivery.kind === 'done' ? delivery.value.entry.number : '',
          }),
          { tone: 'success' },
        );
        onDone();
      }
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('journal.reverse.title')}
      isOpen={entry !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      footer={
        <>
          <Button tone="secondary" onPress={onClose}>
            {translator.format('action.cancel')}
          </Button>
          <Button tone="danger" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format('journal.reverse.submit')}
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
          {translator.format('journal.reverse.description')}
        </p>
        <div className="flex items-baseline gap-[var(--vx-gap-sm)]">
          <Code>{entry?.number ?? ''}</Code>
          {entry === null ? null : <Figure amount={entry.total} />}
        </div>
        <DateInput
          label={translator.format('journal.reverse.day')}
          description={translator.format('journal.reverse.day.description')}
          value={day}
          onChange={(next) => {
            setDay(next);
            setMissing((was) => ({ ...was, day: false }));
          }}
          {...(entry === null ? {} : { placeholder: entry.day })}
          isRequired
          {...(missing.day
            ? { errorMessage: translator.format('journal.reverse.day.required') }
            : {})}
        />
        <TextArea
          label={translator.format('journal.reverse.reason')}
          description={translator.format('journal.reverse.reason.description')}
          value={reason}
          onChange={(next) => {
            setReason(next);
            setMissing((was) => ({ ...was, reason: false }));
          }}
          autoFocus
          isRequired
          {...(missing.reason
            ? { errorMessage: translator.format('journal.reverse.reason.required') }
            : {})}
        />
        {/* The form needs a submit control for Enter to mean anything, and the
            one a person clicks is in the footer where a dialog's actions belong. */}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
