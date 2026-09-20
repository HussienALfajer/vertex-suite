import type { TenantId } from '@vertex/contracts';
import { newId, ok, refuse, type Instant, type LocalDate, type Result } from '@vertex/kernel';

import { dayArriving, shown, written } from './arriving.js';
import { admitPosting, type Keeping } from './calendar.js';
import type {
  Accepted,
  ExceptionDecision,
  ExceptionListing,
  Posted,
  PostingException,
  PostingExceptionId,
  PostingRefusal,
  RecordSession,
} from './contract.js';
import {
  balancedOrThrow,
  entryFrom,
  ownedBy,
  postedFor,
  postedIn,
  sealedPosted,
  writePosted,
} from './journal.js';
import { appendRecord, readRecord, scanRecords, writeRecord } from './records.js';

/**
 * The exceptions queue of `FIN-05`, and the door an entry made elsewhere comes
 * through.
 *
 * "Closing a period blocks all postings dated within it, including late offline
 * sync arrivals, which are instead routed to an exceptions queue for a
 * decision." The first half is the calendar's; this file is the second. An
 * entry that arrives from a register is a fact — the sale happened, the
 * receipt is in a customer's hand — so what the system of record cannot do is
 * refuse it for its date. What it can do is hold it, exactly as it arrived,
 * until somebody decides.
 */

type Outcome<T> = Result<T, PostingRefusal>;

/** A value's fields as they may actually arrive. */
type Arriving<T> = { readonly [Field in keyof T]: unknown };

function fieldsOf<T>(arriving: unknown): Arriving<T> {
  return (arriving ?? {}) as Arriving<T>;
}

/**
 * Sealed on the way out, all the way down: the entry it holds, every line of
 * it, the refusal, the decision. An exception is read by the person deciding
 * and by the command that posts what they decided, and the second must find
 * exactly what the first saw.
 */
function sealedException(exception: PostingException): PostingException {
  return Object.freeze({
    ...exception,
    arrived: sealedPosted(exception.arrived.entry, exception.arrived.lines),
    refused: Object.freeze({
      ...exception.refused,
      values: Object.freeze({ ...exception.refused.values }),
    }),
    resolved: exception.resolved === null ? null : Object.freeze({ ...exception.resolved }),
  });
}

export function exceptionIn(
  session: RecordSession,
  tenant: TenantId,
  id: PostingExceptionId,
): PostingException | null {
  const found = readRecord(session, 'exception', tenant, [id]);
  return found === null ? null : sealedException(found);
}

/**
 * The queue, oldest arrival first, ties broken by identifier so that two
 * arrivals in one millisecond read back the same way on every machine.
 */
export function exceptionsIn(
  session: RecordSession,
  tenant: TenantId,
  listing: ExceptionListing = {},
): readonly PostingException[] {
  return scanRecords(session, 'exception', tenant)
    .filter((one) => listing.including === 'all' || one.resolved === null)
    .sort(
      (one, other) =>
        one.arrivedAt - other.arrivedAt || (one.id < other.id ? -1 : one.id > other.id ? 1 : 0),
    )
    .map(sealedException);
}

/**
 * Takes in an entry posted elsewhere (`PostingEngine.accept`).
 *
 * What it already has, first: an event already posted is answered with its
 * entry and one already waiting with its place in the queue, before the
 * calendar is asked anything — `SYN-02` delivers at least once, and the second
 * delivery of an entry that arrived last week must not be judged by this
 * week's calendar. Then the calendar, whose refusal is what routes the entry
 * to the queue rather than back to the sender: the day is closed, the day is
 * outside the years, the calendar was never installed — each a decision for
 * somebody here. A day that is not a day is none of those; it is an entry that
 * was never made by this module, and it is refused as what it is.
 */
export function acceptEntry(
  session: RecordSession,
  tenant: TenantId,
  arrived: Posted,
  arrivedAt: Instant,
): Outcome<Accepted> {
  const { entry, lines } = arrived;
  ownedBy(entry, tenant);
  balancedOrThrow(entry, lines);

  const already = postedFor(session, tenant, entry.source);
  if (already !== null) return ok(Object.freeze({ outcome: 'posted', posted: already }));

  const queued = readRecord(session, 'queued', tenant, [entry.source.kind, entry.source.document]);
  if (queued !== null) {
    const waiting = exceptionIn(session, tenant, queued.exception);
    // Queued and neither waiting nor posted is a store that lost a record
    // written with its pointer, which is not something to answer around.
    if (waiting === null) {
      throw new Error(
        `The queue of tenant ${tenant} points ${entry.source.kind} ${entry.source.document} at ` +
          `exception ${queued.exception}, which is not there.`,
      );
    }
    return ok(Object.freeze({ outcome: 'queued', exception: waiting }));
  }

  const admitted = admitPosting(session, tenant, entry.day);
  if (!admitted.ok) {
    if (admitted.error.code === 'fin.day-invalid') return admitted;
    const exception: PostingException = {
      id: newId<'posting-exception'>(),
      tenant,
      // As it arrived, with nothing of this store's on it: the period and the
      // queue mark are this store's to settle when the entry is posted here.
      arrived: sealedPosted(
        entryFrom(entry, {
          number: entry.number,
          day: entry.day,
          period: entry.period,
          exception: null,
        }),
        lines,
      ),
      refused: admitted.error,
      arrivedAt,
      resolved: null,
    };
    writeRecord(session, 'exception', tenant, [exception.id], exception);
    appendRecord(session, 'queued', tenant, [entry.source.kind, entry.source.document], {
      tenant,
      source: entry.source,
      exception: exception.id,
    });
    return ok(Object.freeze({ outcome: 'queued', exception: sealedException(exception) }));
  }

  // The system of record adds the period it admits the entry into, and nothing
  // else: the number is the one the register printed (`SYS-02`).
  const posted = writePosted(
    session,
    entryFrom(entry, {
      number: entry.number,
      day: entry.day,
      period: admitted.value.period.id,
      exception: null,
    }),
    lines,
  );
  return ok(Object.freeze({ outcome: 'posted', posted }));
}

/**
 * Posts a queued entry as decided (`PostingExceptionAdministration.post`).
 *
 * As dated, or on the day given against a written reason. The calendar is
 * asked about that day exactly as it is asked about any other, so an entry
 * posted as dated needs its period reopened first — which is the decision
 * `FIN-05` leaves to the owner — and one posted on another day needs that day
 * open. A resolved exception is answered with the entry it became and nothing
 * moves: a decision taken twice is one decision.
 */
export function resolveException(
  session: RecordSession,
  tenant: TenantId,
  id: PostingExceptionId,
  decision: ExceptionDecision | undefined,
  keeping: Keeping,
): Outcome<Posted> {
  const found = readRecord(session, 'exception', tenant, [id]);
  if (found === null) return refuse('fin.exception-not-found', { exception: shown(id) });
  const { arrived } = found;

  if (found.resolved !== null) {
    const posted = postedIn(session, tenant, arrived.entry.id);
    if (posted === null) {
      throw new Error(`Exception ${id} of tenant ${tenant} is decided and its entry is not there.`);
    }
    return ok(posted);
  }

  const { day, reason } = fieldsOf<ExceptionDecision>(decision);
  let on: LocalDate = arrived.entry.day;
  if (day !== undefined) {
    const dated = dayArriving(day);
    if (!dated.ok) return dated;
    on = dated.value;
  }
  let why: string | null = null;
  if (on !== arrived.entry.day) {
    why = written(reason);
    if (why === null) return refuse('fin.redate-reason-required', { exception: id, day: on });
  }

  const admitted = admitPosting(session, tenant, on);
  if (!admitted.ok) return admitted;

  const posted = writePosted(
    session,
    entryFrom(arrived.entry, {
      number: arrived.entry.number,
      day: on,
      period: admitted.value.period.id,
      exception: id,
    }),
    arrived.lines,
  );
  writeRecord(session, 'exception', tenant, [id], {
    ...found,
    resolved: { day: on, reason: why, by: keeping.by, at: keeping.at },
  });
  return ok(posted);
}
