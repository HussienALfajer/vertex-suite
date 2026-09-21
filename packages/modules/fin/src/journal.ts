import type { TenantId } from '@vertex/contracts';
import { Dec, ok, refuse, type LocalDate, type Result } from '@vertex/kernel';
import type { UnitOfWork } from '@vertex/platform';
import type { DocumentNumbering, SeriesScope } from '@vertex/sys/contract';

import { referenceArriving } from './arriving.js';
import { admitPosting, fiscalYearLabel, postingPlaceOn } from './calendar.js';
import {
  JOURNAL_ENTRY_DOCUMENT,
  type AccountingPeriodId,
  type Attachment,
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
import {
  appendRecord,
  readRecord,
  scanRecords,
  type Placement,
  type StoredShapes,
} from './records.js';

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
function sealedLine(line: JournalLine): JournalLine {
  return Object.freeze({
    ...line,
    amount: Object.freeze({ ...line.amount }),
    original: line.original === null ? null : Object.freeze({ ...line.original }),
  });
}

function sealedEntry(entry: JournalEntry): JournalEntry {
  return Object.freeze({
    ...entry,
    source: Object.freeze({ ...entry.source }),
    total: Object.freeze({ ...entry.total }),
  });
}

function sealedAttachment(attachment: Attachment): Attachment {
  return Object.freeze({ ...attachment });
}

export function sealedPosted(
  entry: JournalEntry,
  lines: readonly JournalLine[],
  attachments: readonly Attachment[],
): Posted {
  return Object.freeze({
    entry: sealedEntry(entry),
    lines: Object.freeze(lines.map(sealedLine)),
    attachments: Object.freeze(attachments.map(sealedAttachment)),
  });
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
    attachments: Object.freeze(prepared.attachments.map(sealedAttachment)),
  });
}

export function entryIn(
  session: RecordSession,
  tenant: TenantId,
  id: JournalEntryId,
): JournalEntry | null {
  return readRecord(session, 'entry', tenant, [id]);
}

/**
 * What an entry counts, each read **by name**: the entry says how many it has,
 * and every one sits under its own ordinal. Never a scan — the posting path
 * reads an entry back whenever a replay finds its event already posted, and a
 * scan there would make the replay conflict with every command adding a record
 * anywhere. One the entry counts and the store lacks is a store that lost a
 * record written with the entry, and is not answered around.
 */
function countedOf<C extends 'line' | 'attachment'>(
  session: RecordSession,
  tenant: TenantId,
  collection: C,
  entry: JournalEntry,
  count: number,
): readonly StoredShapes[C][] {
  const found: StoredShapes[C][] = [];
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    const one = readRecord(session, collection, tenant, [entry.id, String(ordinal)]);
    if (one === null) {
      throw new Error(
        `${collection} ${String(ordinal)} of entry ${entry.id} of tenant ${tenant} is missing.`,
      );
    }
    found.push(one);
  }
  return found;
}

/**
 * Every line of an entry, in the order the entry holds them.
 *
 * Published because `FIN-07` reads the lines of entries it found by walking
 * the journal, and reads them the same way a posting replay does: by name,
 * one to `lineCount`. A statement that scanned the key space for an entry's
 * lines would scan it once per entry.
 */
export function linesIn(
  session: RecordSession,
  tenant: TenantId,
  entry: JournalEntry,
): readonly JournalLine[] {
  return countedOf(session, tenant, 'line', entry, entry.lineCount);
}

/**
 * One attachment of an entry, by its place — or null for a place the entry has
 * nothing at. A place is counted from one; anything else names nothing.
 */
export function attachmentIn(
  session: RecordSession,
  tenant: TenantId,
  entry: JournalEntry,
  ordinal: number,
): Attachment | null {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > entry.attachmentCount) return null;
  const attachment = readRecord(session, 'attachment', tenant, [entry.id, String(ordinal)]);
  // Counted by the entry and absent from the store: see `countedOf`.
  if (attachment === null) {
    throw new Error(
      `attachment ${String(ordinal)} of entry ${entry.id} of tenant ${tenant} is missing.`,
    );
  }
  return sealedAttachment(attachment);
}

/** One entry with its lines and attachments, sealed, or null. */
export function postedIn(
  session: RecordSession,
  tenant: TenantId,
  id: JournalEntryId,
): Posted | null {
  const entry = entryIn(session, tenant, id);
  if (entry === null) return null;
  return sealedPosted(
    entry,
    linesIn(session, tenant, entry),
    countedOf(session, tenant, 'attachment', entry, entry.attachmentCount),
  );
}

/**
 * The key parts a business event is filed under, wherever it is filed: the
 * placement of its entry and its place in the queue both use this, and both
 * read the reference as the draft read it, so that a source in either spelling
 * — and a source written here or read here — is one source.
 */
export function keyOfSource(source: EntrySource): readonly string[] {
  return [source.kind, referenceArriving(source.document)];
}

/** Where a business event's entry is, by the one key a replay can read by name. */
function placementOf(
  session: RecordSession,
  tenant: TenantId,
  source: EntrySource,
): Placement | null {
  return readRecord(session, 'posted', tenant, keyOfSource(source));
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
 * its lines and its attachments and an entry record must not — each is a
 * record of its own, and the entry carries only how many there are.
 */
export function entryFrom(
  facts: EntryFacts,
  lines: readonly JournalLine[],
  attachments: readonly Attachment[],
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
    lineCount: lines.length,
    attachmentCount: attachments.length,
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
 * Raises unless what an entry counts is numbered one to N, in order.
 *
 * Or the entry could never be read back by name; this module numbers every
 * line and every attachment it prepares, so anything else was altered.
 */
function numberedOrThrow(
  entry: JournalEntry,
  what: string,
  counted: readonly { readonly ordinal: number }[],
): void {
  counted.forEach((one, index) => {
    if (one.ordinal !== index + 1) {
      throw new Error(
        `The ${what} of entry ${entry.id} are not numbered one to ${String(counted.length)}.`,
      );
    }
  });
}

/**
 * Writes an admitted entry: the entry, its lines, its attachments, the
 * placement of its event, and — for a reversal — the pointer from the original
 * (`FIN-03`).
 *
 * Every one an append, and the placement last, so that the key a replay reads
 * by name is written only when everything it points at is.
 */
export function writePosted(
  session: RecordSession,
  entry: JournalEntry,
  lines: readonly JournalLine[],
  attachments: readonly Attachment[],
): Posted {
  const { tenant } = entry;
  numberedOrThrow(entry, 'lines', lines);
  numberedOrThrow(entry, 'attachments', attachments);
  appendRecord(session, 'entry', tenant, [entry.id], entry);
  for (const line of lines) {
    appendRecord(session, 'line', tenant, [entry.id, String(line.ordinal)], {
      ...line,
      entry: entry.id,
      tenant,
    });
  }
  for (const attachment of attachments) {
    appendRecord(session, 'attachment', tenant, [entry.id, String(attachment.ordinal)], {
      ...attachment,
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
  appendRecord(session, 'posted', tenant, keyOfSource(entry.source), {
    tenant,
    source: entry.source,
    entry: entry.id,
  });
  return sealedPosted(entry, lines, attachments);
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

  const entry = entryFrom(prepared, prepared.lines, prepared.attachments, {
    number: numbered.value.number,
    day: prepared.day,
    period: admitted.value.period.id,
    exception: null,
  });
  return ok(writePosted(session, entry, prepared.lines, prepared.attachments));
}
