import { clsx } from 'clsx';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { toDate, type Instant } from '@vertex/kernel';

import { Code } from '../display/Code.js';
import { DateTime } from '../display/DateTime.js';
import { formatMoment } from '../display/format.js';
import { useTranslator, useVertex } from '../providers/context.js';
import { Badge, type BadgeTone } from './Badge.js';
import { Banner } from './Banner.js';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';

/**
 * What the register last learned about its store node. The courier's own
 * vocabulary (`@vertex/platform`), restated as the shape this component draws:
 * the design system depends on no module and on no host, so the status a host
 * holds is handed straight in, and it fits because the two agree on the words.
 */
export type SyncConnection = 'unknown' | 'online' | 'offline' | 'signed-out';

/** Why the store node declined an operation. */
export type SyncFailureReason =
  'conflict' | 'sequence-gap' | 'out-of-order' | 'forbidden' | 'unsupported' | 'invalid';

export interface SyncOperation {
  readonly key: string;
  readonly sequence: number;
  /** What kind of operation this is; the host says what that is in words (`describe`). */
  readonly kind: string;
  readonly stagedAt: Instant;
  readonly failure?: {
    readonly reason: SyncFailureReason;
    readonly expected?: number;
    readonly since: Instant;
    readonly attempts: number;
  };
  readonly escalation?: { readonly at: Instant };
}

export interface SyncState {
  readonly connection: SyncConnection;
  /** Everything not yet acknowledged, in the order the store node must apply it. */
  readonly queue: readonly SyncOperation[];
  readonly lastContact: Instant | null;
  readonly nextAttempt: Instant | null;
}

export interface SyncStatusProps {
  readonly status: SyncState;
  /** The branch's zone, in which every moment in the detail is written (§12). */
  readonly timeZone: string;
  /**
   * An operation in words — "sale", "cash drop". The kinds belong to the
   * modules that stage them, and only the host knows which of those it ships.
   */
  readonly describe: (operation: SyncOperation) => string;
  /** Try now, rather than at the next scheduled attempt. */
  readonly onRetry: () => void;
  /** Hand a failed operation on to a supervisor (SYN-06). */
  readonly onEscalate: (key: string) => void;
  readonly className?: string;
}

/** How many rows the detail lists before it counts the rest. A day offline can queue thousands. */
const LISTED = 50;

type Condition = 'failed' | SyncConnection;

/**
 * The one thing the indicator leads with. A failure outranks the connection:
 * a register that is online and cannot deliver its head is not "connected" in
 * any sense that matters to the person reading it.
 */
function conditionOf(status: SyncState): Condition {
  return status.queue[0]?.failure === undefined ? status.connection : 'failed';
}

const conditionTone: Readonly<Record<Condition, string>> = {
  failed: 'text-fg-danger',
  'signed-out': 'text-fg-warning',
  offline: 'text-fg-warning',
  online: 'text-fg-success',
  unknown: 'text-fg-muted',
};

/**
 * The sync status indicator of the register (POS-18) and the view behind it
 * (SYN-06).
 *
 * **Always on screen, and never colour alone.** The indicator names the
 * connection in words, counts what is waiting, and marks a failure with a
 * badge of its own; the icon's *shape* changes with the condition too, because
 * a cashier may be colour-blind and the system will never know (§4.7).
 *
 * **One press from the detail.** It is a button: `Enter` opens the detail as a
 * dialog, which traps focus and gives it back on `Esc` (§11), because the
 * register has no pointer. The detail says what the connection means for the
 * person at the till, when the store node last answered and when the courier
 * will try again, what is queued in the order it must be applied, and — for
 * an operation the store node refused — why, what it holds up, and the two
 * ways out: retry now, or hand it to a supervisor with a reference to quote.
 *
 * **Heard as well as seen.** A change of condition — the connection, or an
 * operation refused — is announced politely, so a line dropping mid-sale
 * reaches somebody using a screen reader without taking their focus away from
 * the sale. The count is not announced; it is read with the indicator.
 */
export function SyncStatus({
  status,
  timeZone,
  describe,
  onRetry,
  onEscalate,
  className,
}: SyncStatusProps): ReactNode {
  const translator = useTranslator();
  const condition = conditionOf(status);
  const waiting = status.queue.length;
  const connection = translator.format(`sync.connection.${status.connection}`);
  const pending = waiting === 0 ? null : translator.format('sync.pending', { count: waiting });
  const failed = condition === 'failed' ? translator.format('sync.failed') : null;
  const pendingTone: BadgeTone = status.connection === 'online' ? 'info' : 'warning';

  const trigger = (
    <Button tone="ghost" className={clsx('gap-[var(--vx-gap-xs)]', className)}>
      <ConditionIcon condition={condition} />
      <span>{connection}</span>
      {pending === null ? null : <Badge tone={pendingTone}>{pending}</Badge>}
      {failed === null ? null : <Badge tone="danger">{failed}</Badge>}
    </Button>
  );

  return (
    <>
      <Dialog
        title={translator.format('sync.title')}
        trigger={trigger}
        footer={
          // Never disabled, though with nothing queued it only asks whether the
          // store node is there. A control that disables itself under the focus
          // that pressed it drops that focus out of the dialog, where `Esc` no
          // longer reaches — and "check now" is a question worth being able to ask.
          <Button tone="primary" onPress={onRetry}>
            {translator.format('sync.retry')}
          </Button>
        }
      >
        <SyncDetail
          status={status}
          timeZone={timeZone}
          describe={describe}
          onEscalate={onEscalate}
        />
      </Dialog>
      {/* The trigger's text changes without its focus moving, and nothing reads
          a button again because its label changed. The condition only, not the
          count: at a busy till the count moves with every sale, and a screen
          reader saying so each time would talk over the sale itself. */}
      <span role="status" className="sr-only">
        {connection} {failed}
      </span>
    </>
  );
}

function SyncDetail({
  status,
  timeZone,
  describe,
  onEscalate,
}: Omit<SyncStatusProps, 'onRetry' | 'className'>): ReactNode {
  const translator = useTranslator();
  const heading = useId();
  const head = status.queue[0];
  const listed = status.queue.slice(0, LISTED);
  const unlisted = status.queue.length - listed.length;

  return (
    <div className="flex flex-col gap-[var(--vx-gap-lg)]">
      <div className="flex flex-col gap-[var(--vx-gap-sm)]">
        <p>{translator.format(`sync.explain.${status.connection}`)}</p>
        <dl className="text-footnote grid grid-cols-[auto_1fr] gap-x-[var(--vx-gap-md)] gap-y-[var(--vx-gap-xs)]">
          <dt className="text-fg-secondary">{translator.format('sync.lastContact')}</dt>
          <dd>
            {status.lastContact === null ? (
              translator.format('sync.never')
            ) : (
              <DateTime value={toDate(status.lastContact)} timeZone={timeZone} precision="second" />
            )}
          </dd>
          {status.nextAttempt === null ? null : (
            <>
              <dt className="text-fg-secondary">{translator.format('sync.nextAttempt')}</dt>
              <dd>
                <DateTime
                  value={toDate(status.nextAttempt)}
                  timeZone={timeZone}
                  precision="second"
                />
              </dd>
            </>
          )}
        </dl>
      </div>

      {head?.failure === undefined ? null : (
        <FailureNotice
          operation={head}
          failure={head.failure}
          behind={status.queue.length - 1}
          timeZone={timeZone}
          describe={describe}
          onEscalate={onEscalate}
        />
      )}

      <section className="flex flex-col gap-[var(--vx-gap-sm)]" aria-labelledby={heading}>
        <h3 id={heading} className="text-body font-body-semibold">
          {translator.format('sync.queue.title')}
        </h3>
        {status.queue.length === 0 ? (
          <p className="text-fg-secondary">{translator.format('sync.queue.empty')}</p>
        ) : (
          <ol className="border-line divide-line flex flex-col divide-y rounded border">
            {listed.map((operation) => (
              <QueuedRow
                key={operation.key}
                operation={operation}
                timeZone={timeZone}
                describe={describe}
              />
            ))}
          </ol>
        )}
        {unlisted <= 0 ? null : (
          <p className="text-fg-secondary text-footnote">
            {translator.format('sync.queue.more', { count: unlisted })}
          </p>
        )}
      </section>
    </div>
  );
}

function FailureNotice({
  operation,
  failure,
  behind,
  timeZone,
  describe,
  onEscalate,
}: {
  readonly operation: SyncOperation;
  readonly failure: NonNullable<SyncOperation['failure']>;
  readonly behind: number;
  readonly timeZone: string;
  readonly describe: (operation: SyncOperation) => string;
  readonly onEscalate: (key: string) => void;
}): ReactNode {
  const translator = useTranslator();
  const { formattingLocale } = useVertex();
  // Inside a sentence, a moment is text the message places, not an element
  // beside it — the translator decides where the date goes (§12).
  const moment = (at: Instant): string =>
    formatMoment(toDate(at), { locale: formattingLocale, timeZone, precision: 'minute' });

  /**
   * Escalating removes the button that did it, and focus on a removed element
   * falls to the page behind the dialog — where `Esc` no longer closes it and
   * the next key lands nowhere. Focus goes instead to the notice, which now
   * says the operation was escalated: the answer to what the person just did.
   */
  const notice = useRef<HTMLDivElement>(null);
  const escalated = operation.escalation !== undefined;
  useEffect(() => {
    const focused = document.activeElement;
    if (escalated && (focused === null || focused === document.body)) notice.current?.focus();
  }, [escalated]);

  return (
    <Banner
      tone="danger"
      title={translator.format('sync.failure.title', { operation: describe(operation) })}
      actions={
        operation.escalation === undefined ? (
          <Button
            tone="secondary"
            onPress={() => {
              onEscalate(operation.key);
            }}
          >
            {translator.format('sync.escalate')}
          </Button>
        ) : undefined
      }
    >
      {/* policy-exempt: §7.3 — a programmatic focus landing point, not a
          control; see `Dialog` for the same case. */}
      <div ref={notice} tabIndex={-1} className="flex flex-col gap-[var(--vx-gap-xs)] outline-none">
        <p>
          {translator.format(`sync.failure.reason.${failure.reason}`, {
            expected: failure.expected ?? 0,
          })}
        </p>
        <p>
          {translator.format('sync.failure.attempts', {
            attempts: failure.attempts,
            since: moment(failure.since),
          })}{' '}
          {translator.format('sync.failure.behind', { count: behind })}
        </p>
        <p>
          {operation.escalation === undefined
            ? translator.format('sync.failure.escalateHint')
            : translator.format('sync.failure.escalated', { at: moment(operation.escalation.at) })}
        </p>
        <p className="flex flex-wrap items-baseline gap-[var(--vx-gap-xs)]">
          <span>{translator.format('sync.failure.reference')}</span>
          <Code>{operation.key}</Code>
        </p>
      </div>
    </Banner>
  );
}

function QueuedRow({
  operation,
  timeZone,
  describe,
}: {
  readonly operation: SyncOperation;
  readonly timeZone: string;
  readonly describe: (operation: SyncOperation) => string;
}): ReactNode {
  const translator = useTranslator();
  return (
    <li className="flex flex-wrap items-center justify-between gap-[var(--vx-gap-sm)] px-[var(--vx-pad-md)] py-[var(--vx-pad-sm)]">
      <span className="flex items-baseline gap-[var(--vx-gap-sm)]">
        <span className="text-fg-secondary tabular-nums">
          {translator.format('sync.queue.sequence', { sequence: operation.sequence })}
        </span>
        <span>{describe(operation)}</span>
      </span>
      <span className="flex items-center gap-[var(--vx-gap-sm)]">
        <DateTime
          value={toDate(operation.stagedAt)}
          timeZone={timeZone}
          className="text-fg-secondary text-footnote"
        />
        {operation.failure === undefined ? (
          <Badge tone="neutral">{translator.format('sync.queue.waiting')}</Badge>
        ) : (
          <Badge tone="danger">{translator.format('sync.queue.failed')}</Badge>
        )}
        {operation.escalation === undefined ? null : (
          <Badge tone="warning">{translator.format('sync.queue.escalated')}</Badge>
        )}
      </span>
    </li>
  );
}

/**
 * A shape per condition, read without any colour: a tick for connected, a
 * struck-through signal for offline, a padlock for a session to renew, the
 * octagon `Banner` stops with for a failure, and an open ring for not yet known.
 */
function ConditionIcon({ condition }: { condition: Condition }): ReactNode {
  const shared = clsx(
    'size-[var(--vx-icon)] shrink-0 fill-none stroke-current',
    conditionTone[condition],
  );
  switch (condition) {
    case 'failed':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <path d="M7 2.5h6l4.5 4.5v6L13 17.5H7L2.5 13V7z" strokeLinejoin="round" />
          <path d="M10 6v5M10 13.5v.5" strokeLinecap="round" />
        </svg>
      );
    case 'offline':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <path d="M2.5 7.5a11 11 0 0115 0M5 10.5a7 7 0 0110 0M7.5 13.5a3 3 0 015 0" />
          <path d="M3 3l14 14" strokeLinecap="round" />
        </svg>
      );
    case 'signed-out':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <rect x="4" y="9" width="12" height="8.5" rx="1.5" />
          <path d="M7 9V6.5a3 3 0 016 0V9" />
        </svg>
      );
    case 'online':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M6.5 10.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'unknown':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.5" strokeDasharray="3 3" />
        </svg>
      );
  }
}
