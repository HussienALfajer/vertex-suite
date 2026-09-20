import type { TenantId } from '@vertex/contracts';
import { Dec, ok, refuse, type LocalDate, type Result } from '@vertex/kernel';
import type { UnitOfWork } from '@vertex/platform';
import type { DocumentNumbering, SeriesScope } from '@vertex/sys/contract';

import { referenceArriving } from './arriving.js';
import { admitPosting, fiscalYearLabel, postingPlaceOn } from './calendar.js';
import {
  JOURNAL_ENTRY_DOCUMENT,
  type AccountingPeriodId,
  type EntryFacts,
  type EntrySource,
  type JournalEntry,
  type JournalEntryId,
  type JournalLine,
  type JournalListing,
  type Posted,
  type PostingExceptionId,
  type PostingRefusal,
  type PreparedEntry,
  type RecordSession,
  type Reversal,
} from './contract.js';
import { appendRecord, readRecord, scanRecords, type Placement } from './records.js';

/**
 * The journal: `FIN-02`'s second half, which writes, and `FIN-03`, which is the
 * shape of the writing.
 *
 * Every write here goes through `appendRecord`, and only through it. That is
 * the whole of "journal entries cannot be edited or deleted": not a rule about
 * what a function may do to an entry, but the absence of any function that
 * does anything to one but write it where nothing was.
 */

type Outcome<T> = Result<T, PostingRefusal>;

/**
 * Sealed on the way **out**, where it matters: the store hands back a fresh
 * copy of whatever was committed, and a caller given one unsealed could edit
 * an amount and hand it to something that believed it. Every nested object an
 * entry or a line carries is frozen with it.
 */
export function sealedLine(line: JournalLine): JournalLine {
  return Object.freeze({
    ...line,
    amount: Object.freeze({ ...line.amount }),
    original: line.original === null ? null : Object.freeze({ ...line.original }),
  });
}

export function sealedEntry(entry: JournalEntry): JournalEntry {
  return Object.freeze({
    ...entry,
    source: Object.freeze({ ...entry.source }),
    total: Object.freeze({ ...entry.total }),
  });
}

export function sealedPosted(entry: JournalEntry, lines: readonly JournalLine[]): Posted {
  return Object.freeze({ entry: sealedEntry(entry), lines: Object.freeze(lines.map(sealedLine)) });
}

/**
 * A prepared entry sealed all the way down before it is handed out, for the
 * reason `FX` freezes a prepared stamp: it travels through a caller before
 * `post` writes it without asking again.
 */
export function sealedPrepared(prepared: PreparedEntry): PreparedEntry {
  return Object.freeze({
    ...prepared,
    source: Object.freeze({ ...prepared.source }),
    total: Object.freeze({ ...prepared.total }),
    lines: Object.freeze(prepared.lines.map(sealedLine)),
  });
}

export function entryIn(
  session: RecordSession,
  tenant: TenantId,
  id: JournalEntryId,
): JournalEntry | null {
  return readRecord(session, 'entry', tenant, [id]);
}

/** An entry's lines, in their order — read by the entry's own prefix, never by scanning every line. */
export function linesOf(
  session: RecordSession,
  tenant: TenantId,
  entry: JournalEntryId,
): readonly JournalLine[] {
  return scanRecords(session, 'line', tenant, [entry]).sort(
    (one, other) => one.ordinal - other.ordinal,
  );
}

/** One entry with its lines, sealed, or null. */
export function postedIn(
  session: RecordSession,
  tenant: TenantId,
  id: JournalEntryId,
): Posted | null {
  const entry = entryIn(session, tenant, id);
  return entry === null ? null : sealedPosted(entry, linesOf(session, tenant, id));
}

/**
 * Where a business event's entry is, by the one key a replay can read by name.
 *
 * The reference is read as the draft read it, so that the journal asked about a
 * document in either spelling answers about the same document.
 */
export function placementOf(
  session: RecordSession,
  tenant: TenantId,
  source: EntrySource,
): Placement | null {
  return readRecord(session, 'posted', tenant, [source.kind, referenceArriving(source.document)]);
}

/**
 * The entry a business event produced, or null.
 *
 * A placement with no entry behind it is a store that lost a record written in
 * the same transaction as the placement, which is not something to answer with
 * "nothing has been posted".
 */
export function postedFor(
  session: RecordSession,
  tenant: TenantId,
  source: EntrySource,
): Posted | null {
  const placed = placementOf(session, tenant, source);
  if (placed === null) return null;
  const posted = postedIn(session, tenant, placed.entry);
  if (posted === null) {
    throw new Error(
      `The journal of tenant ${tenant} places ${source.kind} ${source.document} at entry ` +
        `${placed.entry}, which is not there.`,
    );
  }
  return posted;
}

/**
 * Entries in day order, then in the order they were recorded, ties broken by
 * identifier: a UUIDv7 sorts by the time it was made, so two entries recorded
 * in one millisecond still read back the same way on every machine.
 *
 * Days compare as the strings they are, which is the order of the days: a
 * `LocalDate` has one spelling, and it was chosen so that this holds.
 */
export function entriesIn(
  session: RecordSession,
  tenant: TenantId,
  listing: JournalListing = {},
): readonly JournalEntry[] {
  const { branch, from, to } = listing;
  return scanRecords(session, 'entry', tenant)
    .filter(
      (one) =>
        (branch === undefined || one.branch === branch) &&
        (from === undefined || one.day >= from) &&
        (to === undefined || one.day <= to),
    )
    .sort(
      (one, other) =>
        (one.day < other.day ? -1 : one.day > other.day ? 1 : 0) ||
        one.at - other.at ||
        (one.id < other.id ? -1 : one.id > other.id ? 1 : 0),
    )
    .map(sealedEntry);
}

export function reversalIn(
  session: RecordSession,
  tenant: TenantId,
  original: JournalEntryId,
): Reversal | null {
  const found = readRecord(session, 'reversal', tenant, [original]);
  return found === null ? null : Object.freeze({ ...found });
}

/**
 * Raises unless the entry belongs to the tenant whose command is holding it.
 *
 * A prepared entry is a value that crosses back in from a caller, and so is an
 * entry arriving from a register: neither is read out of the store when it
 * does, because the whole point of each is that it is not in this store yet.
 * So what can be checked about it is checked here, and the tenant is the one
 * that matters. It raises rather than refusing, for the reason `FX` gives of a
 * stamp: a caller that prepared its own entry under its own context cannot
 * reach this, so arriving here is a defect in a caller, and the alternative is
 * one tenant's sale written into another tenant's books.
 */
export function ownedBy<T extends EntryFacts>(facts: T, tenant: TenantId): T {
  if (facts.tenant !== tenant) {
    throw new Error(
      'This entry belongs to another tenant. A command reads and writes its own tenant’s ' +
        'records and nobody else’s.',
    );
  }
  return facts;
}

/**
 * Raises unless the lines balance and come to the total.
 *
 * A prepared entry balances by construction and an arriving one was prepared
 * by this module somewhere, so an entry that reaches a writer unbalanced is
 * one that was altered on the way — and the one thing this ledger must never
 * do is write it anyway.
 */
export function balancedOrThrow(facts: EntryFacts, lines: readonly JournalLine[]): void {
  let debits = new Dec(0);
  let credits = new Dec(0);
  for (const line of lines) {
    if (line.side === 'debit') debits = debits.plus(line.amount.amount);
    else credits = credits.plus(line.amount.amount);
  }
  if (lines.length === 0 || !debits.equals(credits) || !debits.equals(facts.total.amount)) {
    throw new Error(
      `The entry ${facts.id} does not balance: ${debits.toFixed()} against ${credits.toFixed()}, ` +
        `for a total of ${facts.total.amount}. An entry is balanced when it is prepared and ` +
        'never altered after; this one was.',
    );
  }
}

/**
 * The entry as it will be written: the facts, and what only posting settles.
 *
 * Picked field by field rather than spread, because a `PreparedEntry` carries
 * its lines and an entry record must not — the lines are records of their own.
 */
export function entryFrom(
  facts: EntryFacts,
  settled: {
    readonly number: string;
    readonly day: LocalDate;
    readonly period: AccountingPeriodId;
    readonly exception: PostingExceptionId | null;
  },
): JournalEntry {
  return {
    id: facts.id,
    tenant: facts.tenant,
    number: settled.number,
    source: Object.freeze({ ...facts.source }),
    branch: facts.branch,
    register: facts.register,
    day: settled.day,
    period: settled.period,
    description: facts.description,
    total: Object.freeze({ ...facts.total }),
    reverses: facts.reverses,
    exception: settled.exception,
    by: facts.by,
    device: facts.device,
    at: facts.at,
  };
}

/**
 * Writes an admitted entry: the entry, its lines, the placement of its event,
 * and — for a reversal — the pointer from the original (`FIN-03`).
 *
 * Every one an append, and the placement last, so that the key a replay reads
 * by name is written only when everything it points at is.
 */
export function writePosted(
  session: RecordSession,
  entry: JournalEntry,
  lines: readonly JournalLine[],
): Posted {
  const { tenant } = entry;
  appendRecord(session, 'entry', tenant, [entry.id], entry);
  for (const line of lines) {
    appendRecord(session, 'line', tenant, [entry.id, String(line.ordinal)], {
      ...line,
      entry: entry.id,
      tenant,
    });
  }
  if (entry.reverses !== null) {
    appendRecord(session, 'reversal', tenant, [entry.reverses], {
      tenant,
      original: entry.reverses,
      reversal: entry.id,
    });
  }
  appendRecord(session, 'posted', tenant, [entry.source.kind, entry.source.document], {
    tenant,
    source: entry.source,
    entry: entry.id,
  });
  return sealedPosted(entry, lines);
}

/**
 * Posts a prepared entry inside the caller's transaction
 * (`PostingEngine.post`).
 *
 * Three things are decided here and nowhere else, because only the transaction
 * can decide them. Whether the event already has an entry, read by name from
 * the placement — first, before the calendar, so that a replay of an entry
 * posted last month is answered with it and never refused for the month having
 * closed since. Which period the day is in **now** (`FIN-05`). And what number
 * comes next, taken from `SYS` against this same transaction, so that an event
 * which rolls back takes its number with it (`SYS-02`).
 *
 * Every refusal comes before every write. The period is read first and marked
 * last, on either side of the number: `SYS` may refuse to number the entry,
 * and a refusal returned after the period had been marked would leave that mark
 * in a transaction the caller may yet commit.
 */
export async function postEntry(
  uow: UnitOfWork<RecordSession>,
  numbering: DocumentNumbering,
  prepared: PreparedEntry,
): Promise<Outcome<Posted>> {
  const { session } = uow;
  const { tenant } = uow.context;
  ownedBy(prepared, tenant);
  balancedOrThrow(prepared, prepared.lines);

  const already = postedFor(session, tenant, prepared.source);
  if (already !== null) return ok(already);

  const placed = postingPlaceOn(session, tenant, prepared.day);
  if (!placed.ok) return placed;

  const scope: SeriesScope = {
    documentType: JOURNAL_ENTRY_DOCUMENT,
    branch: prepared.branch,
    register: prepared.register,
    fiscalYear: fiscalYearLabel(placed.value.year),
  };
  const numbered = await numbering.next(uow, scope, prepared.id);
  if (!numbered.ok) {
    return refuse('fin.numbering-refused', {
      reason: numbered.error.code,
      ...numbered.error.values,
    });
  }

  // The same day, read again inside the same transaction and now marked. It
  // cannot answer differently: nothing between the two reads wrote to this
  // session's calendar, and what another transaction commits meanwhile is what
  // this one's commit is refused for.
  const admitted = admitPosting(session, tenant, prepared.day);
  if (!admitted.ok) return admitted;

  const entry = entryFrom(prepared, {
    number: numbered.value.number,
    day: prepared.day,
    period: admitted.value.period.id,
    exception: null,
  });
  return ok(writePosted(session, entry, prepared.lines));
}
