import type { PermissionId } from '@vertex/contracts';
import { ok, refuse, type Result } from '@vertex/kernel';
import type { CommandContext, ModuleContext, UnitOfWork } from '@vertex/platform';
import { RateStamps, type PreparedStamp } from '@vertex/fx/contract';
import { DocumentNumbering } from '@vertex/sys/contract';

import {
  attachmentsArriving,
  digested,
  fetchAttachment,
  keepAttachments,
  type JudgedUpload,
} from './attachments.js';
import {
  FIN_PERMISSIONS,
  type AttachedFile,
  type AttachmentStore,
  type JournalEntryId,
  type ManualEntry,
  type OpeningBalances,
  type Posted,
  type PostingRefusal,
  type PreparedEntry,
  type RecordSession,
} from './contract.js';
import { assembled } from './drafts.js';
import { booksOf, making, reading, registerOf, tradingBranch, valuing } from './engine.js';
import { attachmentIn, entryIn, postedFor, postEntry } from './journal.js';
import { judgedManualLine, manualArriving, manualLinesArriving, placeLines } from './manual.js';
import { openingArriving, openingFiguresArriving, openingLines, placeFigures } from './opening.js';

/**
 * What the accountant writes into the journal by hand — a manual entry
 * (`FIN-04`) and the opening balances (`FIN-06`) — driven through the same
 * engine every business event posts through, under this module's own rights,
 * in transactions of this module's own.
 *
 * Both commands ask in the same order, and the order is the whole design:
 * the right first, so that somebody refused learns nothing; then everything
 * that can be judged from the draft alone; then `SYS`, whether the branch
 * trades; then `FX`, what the tenant's money is; then one read of this
 * module's own, for the accounts and the period; then `FX` again, to value
 * what was stated in another currency; then the attachments hashed and kept;
 * and only then the transaction that writes. Every step that can refuse comes
 * before the first that writes anything, and the one write outside the
 * transaction — the attachment's bytes — is the one that is harmless done
 * twice (`AttachmentStore`).
 */

type Outcome<T> = Result<T, PostingRefusal>;

/** The two commands, and the read of an attachment that goes with them. */
export interface Bookkeeping {
  readonly record: (by: CommandContext, entry: ManualEntry) => Promise<Outcome<Posted>>;
  readonly open: (by: CommandContext, balances: OpeningBalances) => Promise<Outcome<Posted>>;
  readonly attachment: (
    by: CommandContext,
    entry: JournalEntryId,
    ordinal: number,
  ) => Promise<AttachedFile | null>;
}

export function bookkeeping<Session extends RecordSession>(
  context: ModuleContext<Session>,
  store: AttachmentStore,
): Bookkeeping {
  const read = reading(context);
  const { journalEntry, openingBalance } = FIN_PERMISSIONS;

  /**
   * Asks the right, at the tenant-wide place: the books are the tenant's, and
   * what is written into them by hand is judged there (`SEC-04`).
   */
  const permitted = async (by: CommandContext, right: PermissionId): Promise<Outcome<void>> =>
    (await context.authorise(by, right)) ? ok(undefined) : refuse('fin.not-permitted', { right });

  /**
   * Writes a prepared entry and the stamps its lines used, in one transaction
   * of this module's own.
   *
   * What the entry already has, first: a submission the wire delivered twice
   * is answered with the entry the first delivery made, and writes no second
   * set of stamps for it. The entry before the stamps, so that a refusal —
   * the month closed since the read, `SYS` declining to number it — leaves
   * no stamp behind in a transaction that commits the refusal as a value.
   */
  const written = async (
    uow: UnitOfWork<Session>,
    prepared: PreparedEntry,
    stamps: readonly PreparedStamp[],
  ): Promise<Outcome<Posted>> => {
    const already = postedFor(uow.session, uow.context.tenant, prepared.source);
    if (already !== null) return ok(already);
    const posted = await postEntry(uow, context.require(DocumentNumbering), prepared);
    if (!posted.ok) return posted;
    const rateStamps = context.require(RateStamps);
    for (const stamp of stamps) rateStamps.stamp(uow.context, uow.session, stamp);
    return posted;
  };

  return {
    record: async (by, draft) => {
      const allowed = await permitted(by, journalEntry.create);
      if (!allowed.ok) return allowed;

      const judged = manualArriving(draft);
      if (!judged.ok) return judged;
      const files = attachmentsArriving(judged.value.attachments);
      if (!files.ok) return files;

      const branch = await tradingBranch(context, by, judged.value.branch);
      if (!branch.ok) return branch;
      const books = await booksOf(context, by);
      if (!books.ok) return books;
      const shapes = manualLinesArriving(books.value, judged.value.lines);
      if (!shapes.ok) return shapes;

      const placed = await read(by, (session) =>
        placeLines(session, by.tenant, books.value, judged.value.day, shapes.value),
      );
      if (!placed.ok) return placed;

      const valuation = await valuing(context, by, books.value, branch.value.id, placed.value);
      if (!valuation.ok) return valuation;
      const lines = placed.value.map((line, index) => {
        const valued = valuation.value.values[index];
        if (valued === undefined) throw new Error(`Line ${String(index + 1)} was never valued.`);
        return judgedManualLine(line, valued);
      });

      const uploads: readonly JudgedUpload[] = await digested(files.value);
      const register = await registerOf(context, by, branch.value.id);
      const prepared = assembled(
        books.value,
        making(context, by, register),
        judged.value,
        lines,
        uploads.map((one) => one.attachment),
      );
      if (!prepared.ok) return prepared;

      await keepAttachments(store, by.tenant, uploads);
      return context.transactor.run(by, (uow) =>
        written(uow, prepared.value, valuation.value.stamps),
      );
    },

    open: async (by, draft) => {
      const allowed = await permitted(by, openingBalance.create);
      if (!allowed.ok) return allowed;

      const judged = openingArriving(draft);
      if (!judged.ok) return judged;

      const branch = await tradingBranch(context, by, judged.value.branch);
      if (!branch.ok) return branch;
      const books = await booksOf(context, by);
      if (!books.ok) return books;
      const figures = openingFiguresArriving(books.value, judged.value.given);
      if (!figures.ok) return figures;

      const placed = await read(by, (session) =>
        placeFigures(
          session,
          by.tenant,
          context.declaredAccounts,
          books.value,
          judged.value.day,
          figures.value,
        ),
      );
      if (!placed.ok) return placed;

      const valuation = await valuing(
        context,
        by,
        books.value,
        branch.value.id,
        placed.value.figures,
      );
      if (!valuation.ok) return valuation;
      const lines = openingLines(placed.value, valuation.value.values, books.value);

      const register = await registerOf(context, by, branch.value.id);
      const prepared = assembled(
        books.value,
        making(context, by, register),
        judged.value,
        lines,
        [],
      );
      if (!prepared.ok) return prepared;

      return context.transactor.run(by, (uow) =>
        written(uow, prepared.value, valuation.value.stamps),
      );
    },

    attachment: async (by, id, ordinal) => {
      // The record in a transaction of this module's own, and the bytes after
      // it has committed: the host's store is not the record store, and a
      // read of it inside the transaction would hold the one open across the
      // other.
      const attachment = await read(by, (session) => {
        const entry = entryIn(session, by.tenant, id);
        return entry === null ? null : attachmentIn(session, by.tenant, entry, ordinal);
      });
      if (attachment === null) return null;
      // The wrapper sealed as everything handed out is; a typed array cannot
      // be, and these bytes were verified against the record a moment ago.
      return Object.freeze({ attachment, bytes: await fetchAttachment(store, attachment) });
    },
  };
}
