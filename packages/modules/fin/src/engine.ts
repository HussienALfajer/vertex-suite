import type { BranchId, DeviceId, RegisterId } from '@vertex/contracts';
import {
  isId,
  ok,
  parseId,
  refuse,
  toDecimalString,
  type Money,
  type Result,
} from '@vertex/kernel';
import type { CommandContext, ModuleContext, UnitOfWork } from '@vertex/platform';
import {
  Currencies,
  RateStamps,
  RoundingRules,
  type CashDirection,
  type PreparedStamp,
  type RateOverrideQuote,
} from '@vertex/fx/contract';
import { DocumentNumbering, Organisation, type Branch } from '@vertex/sys/contract';

import type {
  EntryDraft,
  EntrySide,
  JournalEntryId,
  Posted,
  PostingEngine,
  PostingRefusal,
  PreparedEntry,
  RecordSession,
  ReversalTerms,
} from './contract.js';
import {
  draftArriving,
  prepareEntry,
  refuseAt,
  reversalArriving,
  reversalOf,
  type Books,
  type Making,
  type Place,
  type Valued,
} from './drafts.js';
import { acceptEntry } from './exceptions.js';
import { postEntry } from './journal.js';

/**
 * The engine of `FIN-02` as `PostingEngine` publishes it, and what it asks of
 * the modules beneath: the one file in this module that calls `SYS` and `FX`
 * on behalf of a posting.
 *
 * Every one of those contract calls opens a transaction of the other module's,
 * which is why none of them can happen inside `post` — the caller's
 * transaction is already open there, and one command never holds two. So
 * everything here that asks a neighbour asks before the write, and the write
 * itself is `journal.ts`'s.
 */

type Outcome<T> = Result<T, PostingRefusal>;

/** What this file reads of the edition: the time, the contracts, and how to open a read of its own. */
type Context<Session extends RecordSession> = ModuleContext<Session>;

/**
 * The machine a command is being run at, in the one spelling this module files
 * it under — or null, for a command run at no register.
 *
 * `SYS` stores which machine holds a till through `parseId`, so a UUID is
 * case-insensitive there as the specification says it is. A device id arriving
 * on the context in another case — off a wire, out of `SYN-02`'s replay — would
 * otherwise be a machine that holds no till, and an entry numbered in the
 * branch's series that the till had already numbered in its own. Read once
 * here, as `FX` reads it, so that the till an entry is made at and the machine
 * its number is issued to cannot disagree about which machine that is.
 */
function machineOf(by: CommandContext): DeviceId | null {
  const device = by.device as unknown;
  return typeof device === 'string' && isId(device) ? parseId<'device'>(device) : null;
}

/** A read of this module's own, in a transaction of its own. */
export function reading<Session extends RecordSession>(
  context: Context<Session>,
): <T>(by: CommandContext, work: (session: Session) => T) => Promise<T> {
  return (by, work) => context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));
}

/**
 * The branch an entry is booked at, from `SYS`, and trading: a withdrawn
 * branch issues no documents, so there is nothing for it to post — the answer
 * `FX` gives a stamp.
 */
export async function tradingBranch<Session extends RecordSession>(
  context: Context<Session>,
  by: CommandContext,
  id: BranchId,
): Promise<Outcome<Branch>> {
  const branch = await context.require(Organisation).branch(by, id);
  if (branch === null) return refuse('fin.branch-not-found', { branch: id });
  if (!branch.active) return refuse('fin.branch-inactive', { branch: branch.id });
  return ok(branch);
}

/** What the books are kept in, and every currency an amount may be stated in (`FX-02`). */
export async function booksOf<Session extends RecordSession>(
  context: Context<Session>,
  by: CommandContext,
): Promise<Outcome<Books>> {
  const currencies = context.require(Currencies);
  const functional = await currencies.functional(by);
  if (functional === null) return refuse('fin.functional-currency-unset');
  // Every currency the tenant has, in use or not: an amount is still stated
  // in a currency the shop has since stopped taking.
  return ok({ functional, currencies: await currencies.currencies(by, { including: 'all' }) });
}

/**
 * The till the caller is standing at in this branch, or null: the machine on
 * the context, if a register of the branch is held by it. It decides which
 * series numbers the entry (`SYS-02`), and nothing else.
 */
export async function registerOf<Session extends RecordSession>(
  context: Context<Session>,
  by: CommandContext,
  branch: BranchId,
): Promise<RegisterId | null> {
  const device = machineOf(by);
  if (device === null) return null;
  const registers = await context.require(Organisation).registers(by, branch);
  return registers.find((one) => one.heldBy === device)?.id ?? null;
}

/** Where, by whom and when an entry is being made — the clock read once, so every entry of one command carries one moment. */
export function making<Session extends RecordSession>(
  context: Context<Session>,
  by: CommandContext,
  register: RegisterId | null,
): Making {
  return {
    tenant: by.tenant,
    register,
    by: by.actor,
    device: machineOf(by),
    at: context.clock.now(),
  };
}

/** An amount on a line that this module has to value, and what it needs to. */
export interface Valuable {
  readonly place: Place;
  readonly side: EntrySide;
  readonly amount: Money;
  readonly override: RateOverrideQuote | undefined;
}

/** Every amount valued, and every stamp prepared for one — to be written with the entry. */
export interface Valuation {
  readonly values: readonly Valued[];
  readonly stamps: readonly PreparedStamp[];
}

/**
 * The side of the board a line's own side selects (`FX-06`): a debit is money
 * the shop receives, a credit money it pays out.
 *
 * Not a decision about the account. An accrued expense in pounds is a credit
 * and will be paid out, so it is valued at the rate the shop pays pounds out
 * at; a debit in pounds is what the shop has received or is owed, and is
 * valued at what it receives them at. The account's kind has nothing to add
 * to that, and `FX` is told the direction of the money and nothing else.
 */
function directionOf(side: EntrySide): CashDirection {
  return side === 'debit' ? 'received' : 'paid-out';
}

/**
 * Values every line the accountant stated in another currency, at the
 * branch's rate today on the side its own side selects (`FX-05`, `FX-06`),
 * and says what each comes to in the books at `FX-07`'s ledger point.
 *
 * Each such line is its own document to `FX`: one amount, one stamp, so that
 * a rate typed over the day's on one line overrides that line alone, and so
 * that the stamp on the line is the rate the line used — which is what a
 * reversal undoes it at. A line already in the functional currency is what
 * it says, and asks `FX` nothing.
 *
 * A refusal — no rate for today, an override refused — comes back naming the
 * line, as every other refusal about a line does.
 */
export async function valuing<Session extends RecordSession>(
  context: Context<Session>,
  by: CommandContext,
  books: Books,
  branch: BranchId,
  lines: readonly Valuable[],
): Promise<Outcome<Valuation>> {
  const stamps = context.require(RateStamps);
  const rounding = context.require(RoundingRules);
  const values: Valued[] = [];
  const prepared: PreparedStamp[] = [];

  for (const line of lines) {
    if (line.amount.currency === books.functional.code) {
      values.push({ amount: line.amount, stamp: null });
      continue;
    }
    const stamp = await stamps.prepare(by, {
      branch,
      currency: line.amount.currency,
      direction: directionOf(line.side),
      ...(line.override === undefined ? {} : { override: line.override }),
    });
    if (!stamp.ok) return refuseAt(line.place, stamp.error.code, stamp.error.values);
    const valued = await rounding.value(by, {
      stamp: stamp.value.stamp,
      total: line.amount,
      lines: [line.amount],
    });
    if (!valued.ok) return refuseAt(line.place, valued.error.code, valued.error.values);
    // One amount, so the total is the line and nothing was left over by
    // rounding: the residual of a document of one line is nought by
    // arithmetic, and a residual here would be a defect in `FX`.
    if (!valued.value.residual.amount.amount.isZero()) {
      throw new Error(
        `FX left a residual of ${valued.value.residual.amount.amount.toFixed()} valuing one ` +
          'amount, which cannot be.',
      );
    }
    // Positive in the books, as every line is held to be before it is
    // written (`figureOf`): a penny of pounds rounds to nothing at the ledger
    // point, and a line of nothing balanced against another is an entry that
    // records nothing under a number.
    if (!valued.value.total.amount.greaterThan(0)) {
      return refuseAt(line.place, 'fin.line-amount-valueless', {
        amount: toDecimalString(line.amount),
        currency: line.amount.currency,
        functional: books.functional.code,
      });
    }
    values.push({ amount: valued.value.total, stamp: stamp.value.stamp.id });
    prepared.push(stamp.value);
  }
  return ok({ values, stamps: prepared });
}

/**
 * The engine of `FIN-02`, as `PostingEngine` publishes it — built once per
 * contract that drives it, because it holds nothing.
 *
 * `prepare` asks in the order that costs a refused caller the least: the
 * draft's own shape, which costs nothing; then `SYS`, whether the branch
 * trades; then `FX`, what the books are kept in; then `SYS` again, for the
 * till; and only then this module's own read.
 */
export function postingEngine<Session extends RecordSession>(
  context: Context<Session>,
): PostingEngine {
  const read = reading(context);

  return {
    prepare: async (by: CommandContext, draft: EntryDraft) => {
      const judged = draftArriving(draft);
      if (!judged.ok) return judged;

      const branch = await tradingBranch(context, by, judged.value.branch);
      if (!branch.ok) return branch;

      const books = await booksOf(context, by);
      if (!books.ok) return books;
      const register = await registerOf(context, by, branch.value.id);

      return read(by, (session) =>
        prepareEntry(
          session,
          context.declaredAccounts,
          books.value,
          making(context, by, register),
          judged.value,
        ),
      );
    },

    prepareReversal: async (by: CommandContext, original: JournalEntryId, terms: ReversalTerms) => {
      const basis = await read(by, (session) =>
        reversalArriving(session, by.tenant, original, terms),
      );
      if (!basis.ok) return basis;
      // At the original's branch, which is the only branch a correction of it
      // can be booked at, and at the till the caller stands at, if any.
      const register = await registerOf(context, by, basis.value.original.entry.branch);
      return ok(reversalOf(basis.value, making(context, by, register)));
    },

    post: (uow: UnitOfWork<RecordSession>, prepared: PreparedEntry) =>
      postEntry(uow, context.require(DocumentNumbering), prepared),

    accept: (uow: UnitOfWork<RecordSession>, arrived: Posted) =>
      Promise.resolve(acceptEntry(uow.session, uow.context.tenant, arrived, context.clock.now())),
  };
}
