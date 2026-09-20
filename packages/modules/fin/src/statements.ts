import type { BranchId, TenantId } from '@vertex/contracts';
import {
  compareIds,
  Dec,
  money,
  ok,
  refuse,
  toDecimalString,
  type CurrencyCode,
  type Decimal,
  type Money,
  type Result,
} from '@vertex/kernel';
import type { CommandContext, ModuleContext } from '@vertex/platform';
import { Currencies, Presentation, type PresentedAll } from '@vertex/fx/contract';
import { Organisation } from '@vertex/sys/contract';

import { dayArriving, idArriving } from './arriving.js';
import { accountsIn, treeOf } from './chart.js';
import type {
  Account,
  AccountId,
  AccountKind,
  AccountNode,
  Balance,
  BalanceSheet,
  GeneralLedger,
  IncomeStatement,
  JournalEntry,
  JournalLine,
  LedgerAccount,
  LedgerAmount,
  LedgerPosting,
  LedgerRequest,
  RecordSession,
  SideTotals,
  Statement,
  StatementLine,
  StatementRefusal,
  StatementRequest,
  StatementScope,
  StatementSection,
  Statements,
  TrialBalance,
  TrialBalanceRow,
} from './contract.js';
import { reading } from './engine.js';
import { entriesIn, linesIn } from './journal.js';

/**
 * The four statements of `FIN-07`, which are four arrangements of one reading.
 *
 * **Nothing here is stored and nothing here is a cache.** A statement is
 * computed from the journal every time it is asked for. A figure kept beside
 * the ledger is a figure free to disagree with it, and the ledger is the one
 * thing in this product that may not have a second opinion — which is why
 * `FIN-08` recomputes rather than trusts, and why nothing above it is allowed
 * to save the recomputing.
 *
 * **Nothing here rounds.** Every amount in the journal is already at the
 * precision the functional currency is kept at — `fin.line-amount-too-precise`
 * refuses anything finer — and a sum of such amounts is one too, exactly. The
 * only rounding a statement meets is `FX`'s, when it is read in another
 * currency, and that happens inside `FX` where the rules for it live.
 *
 * **Every figure is debit-positive while it is being worked out**, and takes a
 * side only as it is written down. A balance is one quantity — how far the
 * account is from nothing, and which way — and carrying it as two columns
 * through the arithmetic would mean subtracting one from the other at every
 * step and deciding the side again each time.
 */

type Outcome<T> = Result<T, StatementRefusal>;

const NOTHING = new Dec(0);

/** What one account did, in the books' own currency, kept exactly. */
interface Movement {
  /** Debit-positive, and everything posted strictly before the span. */
  opening: Decimal;
  debits: Decimal;
  credits: Decimal;
}

/** One line of one entry, as a general ledger prints it. */
interface Posting {
  readonly entry: JournalEntry;
  readonly line: JournalLine;
}

/**
 * The journal as a statement needs it: what every account did over the span,
 * and — for the accounts a general ledger details — every posting to them
 * within it.
 *
 * One walk serves both, because both are the same walk. The postings are kept
 * only for the accounts asked about, so a trial balance of a shop with a
 * decade of trading behind it holds a figure per account and never a line per
 * posting.
 */
interface Reading {
  readonly movements: ReadonlyMap<AccountId, Movement>;
  readonly postings: ReadonlyMap<AccountId, readonly Posting[]>;
}

/** The chart as it stands and the journal as it was read: what a statement is built from. */
interface Books {
  readonly accounts: readonly Account[];
  readonly forest: readonly AccountNode[];
  /** The accounts whose postings the reading kept; empty where none were wanted. */
  readonly detailed: ReadonlySet<AccountId>;
  readonly reading: Reading;
}

/**
 * How a figure worked out in the books becomes a figure on the page.
 *
 * The one seam the presentation currency of `FIN-07` goes through: in the
 * books' own currency it writes the figure down, and in any other it is what
 * `FX` translated that figure to. It is handed the amount rather than asked
 * for a currency because a statement converts nothing itself — the rates and
 * the rounding are `FX`'s, and a second opinion about either would be a second
 * set of books.
 *
 * The amount it is given is never negative: a side has been taken off it by
 * then, so nothing here has to decide what a negative figure means in another
 * currency.
 */
type Figure = (amount: Decimal) => LedgerAmount;

/**
 * Which accounts a general ledger details, decided against the chart that was
 * read — so that naming an account the tenant does not have is refused by the
 * same reading that would otherwise have answered.
 */
type Detailing = (accounts: readonly Account[]) => Outcome<ReadonlySet<AccountId>>;

/** A figure written down as the books keep it, and which side it fell on. */
function balanceOf(signed: Decimal, figure: Figure): Balance {
  if (signed.isZero()) return Object.freeze({ side: null, amount: figure(signed) });
  const debit = signed.isPositive();
  return Object.freeze({
    side: debit ? ('debit' as const) : ('credit' as const),
    amount: figure(debit ? signed : signed.negated()),
  });
}

/**
 * What a statement measures of an account.
 *
 * `standing` is where it stands at the end of the span, which is what a
 * balance sheet and a trial balance show; `moved` is what happened within the
 * span, which is what an income statement shows; `brought` is everything
 * before it, which is where a trial balance opens and where a balance sheet
 * splits the accumulated result.
 */
type Measure = 'standing' | 'moved' | 'brought';

function measured(movement: Movement | undefined, measure: Measure): Decimal {
  if (movement === undefined) return NOTHING;
  if (measure === 'brought') return movement.opening;
  const within = movement.debits.minus(movement.credits);
  return measure === 'moved' ? within : movement.opening.plus(within);
}

/** Whether anything was posted to the account within the span, either way. */
function stirred(movement: Movement | undefined): boolean {
  return movement !== undefined && !(movement.debits.isZero() && movement.credits.isZero());
}

/**
 * Reads the journal up to the last day of the span, in the order it keeps its
 * entries.
 *
 * Everything before the span's first day goes into the opening balance and
 * everything within it into the two movement columns, which is the whole of
 * what the three statements above the general ledger are made of. Entries
 * after the span are never read at all.
 *
 * This is the one read in this module that walks the journal rather than
 * naming a key, and it is the one that has to: a statement is an answer about
 * every entry there is. It is a read and never part of a posting, so the cost
 * that `JournalEntry.lineCount` exists to keep off the posting path is not
 * paid here — and `U07`'s driver answers this from an index rather than a scan
 * of the key space.
 */
function readJournal(
  session: RecordSession,
  tenant: TenantId,
  scope: StatementScope,
  detailed: ReadonlySet<AccountId>,
): Reading {
  const movements = new Map<AccountId, Movement>();
  const postings = new Map<AccountId, Posting[]>();
  const listing = scope.branch === null ? { to: scope.to } : { to: scope.to, branch: scope.branch };

  for (const entry of entriesIn(session, tenant, listing)) {
    const within = entry.day >= scope.from;
    for (const line of linesIn(session, tenant, entry)) {
      const movement = movements.get(line.account) ?? {
        opening: NOTHING,
        debits: NOTHING,
        credits: NOTHING,
      };
      const amount = new Dec(line.amount.amount);
      if (!within) {
        movement.opening =
          line.side === 'debit' ? movement.opening.plus(amount) : movement.opening.minus(amount);
      } else if (line.side === 'debit') {
        movement.debits = movement.debits.plus(amount);
      } else {
        movement.credits = movement.credits.plus(amount);
      }
      movements.set(line.account, movement);

      if (within && detailed.has(line.account)) {
        const kept = postings.get(line.account) ?? [];
        kept.push({ entry, line });
        postings.set(line.account, kept);
      }
    }
  }
  return { movements, postings };
}

function totalsOf(debits: Decimal, credits: Decimal, figure: Figure): SideTotals {
  return Object.freeze({ debits: figure(debits), credits: figure(credits) });
}

/** A balance added onto the column its side puts it in. */
interface Columns {
  readonly debits: Decimal;
  readonly credits: Decimal;
}

function onto(columns: Columns, signed: Decimal): Columns {
  return signed.isPositive()
    ? { debits: columns.debits.plus(signed), credits: columns.credits }
    : { debits: columns.debits, credits: columns.credits.minus(signed) };
}

/**
 * The trial balance: every account with something to say over the span, in
 * code order, and the three columns totalled on both sides.
 *
 * An account is left off when it neither stands at anything on the last day
 * nor moved within the span — which is an account that would print as a row of
 * noughts, and a page of those hides the figures on it. Nothing is lost by
 * leaving it off: an account that fails both tests contributes nothing to any
 * total either.
 */
function trialBalanceFrom(books: Books, figure: Figure): Omit<TrialBalance, keyof Statement> {
  const rows: TrialBalanceRow[] = [];
  let opening: Columns = { debits: NOTHING, credits: NOTHING };
  let movements: Columns = { debits: NOTHING, credits: NOTHING };
  let closing: Columns = { debits: NOTHING, credits: NOTHING };

  for (const account of books.accounts) {
    const movement = books.reading.movements.get(account.id);
    if (movement === undefined) continue;
    const stands = measured(movement, 'standing');
    if (stands.isZero() && !stirred(movement)) continue;

    rows.push(
      Object.freeze({
        account,
        opening: balanceOf(movement.opening, figure),
        debits: figure(movement.debits),
        credits: figure(movement.credits),
        closing: balanceOf(stands, figure),
      }),
    );
    opening = onto(opening, movement.opening);
    movements = {
      debits: movements.debits.plus(movement.debits),
      credits: movements.credits.plus(movement.credits),
    };
    closing = onto(closing, stands);
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    totals: Object.freeze({
      opening: totalsOf(opening.debits, opening.credits, figure),
      movements: totalsOf(movements.debits, movements.credits, figure),
      closing: totalsOf(closing.debits, closing.credits, figure),
    }),
  });
}

/** An account and everything beneath it — or nothing, where the statement shows it not at all. */
interface Branch {
  /** The subtree's own figure, debit-positive. */
  readonly total: Decimal;
  readonly moved: boolean;
  readonly line: StatementLine | null;
}

/**
 * One account of a statement read as a tree, with its subtree under it.
 *
 * A line is shown when it has a figure to show or when something moved beneath
 * it within the span — the second because an account that took money in and
 * paid the same out again did something, and a page that left it out would be
 * answering a question nobody asked. A line shown by neither test contributes
 * nothing to the total above it, so hiding it never leaves a section whose
 * lines do not come to its total.
 */
function branchOf(node: AccountNode, reading: Reading, measure: Measure, figure: Figure): Branch {
  const beneath = node.children.map((child) => branchOf(child, reading, measure, figure));
  const own = reading.movements.get(node.account.id);
  const total = beneath.reduce(
    (running, child) => running.plus(child.total),
    measured(own, measure),
  );
  const moved = stirred(own) || beneath.some((child) => child.moved);
  if (!moved && total.isZero()) return { total, moved, line: null };

  return {
    total,
    moved,
    line: Object.freeze({
      account: node.account,
      total: balanceOf(total, figure),
      children: Object.freeze(
        beneath.flatMap((child) => (child.line === null ? [] : [child.line])),
      ),
    }),
  };
}

/** A section, and what it comes to before a side was taken off it. */
interface Sectioned {
  readonly section: StatementSection;
  readonly total: Decimal;
}

function sectionOf(kind: AccountKind, books: Books, measure: Measure, figure: Figure): Sectioned {
  const roots = books.forest
    .filter((node) => node.account.kind === kind)
    .map((node) => branchOf(node, books.reading, measure, figure));
  const total = roots.reduce((running, root) => running.plus(root.total), NOTHING);
  return {
    total,
    section: Object.freeze({
      kind,
      lines: Object.freeze(roots.flatMap((root) => (root.line === null ? [] : [root.line]))),
      total: balanceOf(total, figure),
    }),
  };
}

/**
 * What the shop made over whatever the measure is: what is left of income
 * after expenses.
 *
 * Summed over the accounts themselves rather than over the sections built from
 * them, so that the figure a balance sheet carries into equity and the figure
 * an income statement ends on are the same arithmetic over the same accounts
 * and cannot come apart.
 */
function resultOf(books: Books, measure: Measure): Decimal {
  return books.accounts.reduce(
    (running, account) =>
      account.kind === 'income' || account.kind === 'expense'
        ? running.plus(measured(books.reading.movements.get(account.id), measure))
        : running,
    NOTHING,
  );
}

function incomeStatementFrom(books: Books, figure: Figure): Omit<IncomeStatement, keyof Statement> {
  return Object.freeze({
    income: sectionOf('income', books, 'moved', figure).section,
    expenses: sectionOf('expense', books, 'moved', figure).section,
    result: balanceOf(resultOf(books, 'moved'), figure),
  });
}

/**
 * The balance sheet: the position on the span's last day, and the accumulated
 * result split at its first.
 *
 * The two sides are equal because the ledger makes them equal. Every entry ever
 * written balanced, so the five kinds of account come to nothing between them;
 * what the assets stand at is therefore exactly what the liabilities, the
 * equity accounts and everything the shop has made stand at, and neither total
 * is computed from the other.
 */
function balanceSheetFrom(books: Books, figure: Figure): Omit<BalanceSheet, keyof Statement> {
  const assets = sectionOf('asset', books, 'standing', figure);
  const liabilities = sectionOf('liability', books, 'standing', figure);
  const equity = sectionOf('equity', books, 'standing', figure);
  const brought = resultOf(books, 'brought');
  const made = resultOf(books, 'moved');

  return Object.freeze({
    assets: assets.section,
    liabilities: liabilities.section,
    equity: equity.section,
    broughtForward: balanceOf(brought, figure),
    result: balanceOf(made, figure),
    totals: Object.freeze({
      assets: balanceOf(assets.total, figure),
      liabilitiesAndEquity: balanceOf(
        liabilities.total.plus(equity.total).plus(brought).plus(made),
        figure,
      ),
    }),
  });
}

/** One account's ledger: where it opened, then every posting with what it made of the account. */
function ledgerOf(account: Account, books: Books, figure: Figure): LedgerAccount {
  const movement = books.reading.movements.get(account.id);
  const opening = measured(movement, 'brought');
  let running = opening;
  const postings = (books.reading.postings.get(account.id) ?? []).map(({ entry, line }) => {
    const amount = new Dec(line.amount.amount);
    running = line.side === 'debit' ? running.plus(amount) : running.minus(amount);
    return Object.freeze({
      entry: entry.id,
      number: entry.number,
      day: entry.day,
      branch: entry.branch,
      source: Object.freeze({ ...entry.source }),
      description: entry.description,
      ordinal: line.ordinal,
      memo: line.memo,
      side: line.side,
      amount: figure(amount),
      // Never translated: it is the figure that document was written for, in
      // the currency it was written in.
      original: line.original === null ? null : Object.freeze({ ...line.original }),
      running: balanceOf(running, figure),
    }) satisfies LedgerPosting;
  });

  return Object.freeze({
    account,
    opening: balanceOf(opening, figure),
    postings: Object.freeze(postings),
    debits: figure(movement?.debits ?? NOTHING),
    credits: figure(movement?.credits ?? NOTHING),
    closing: balanceOf(measured(movement, 'standing'), figure),
  });
}

/**
 * The general ledger, account by account in code order.
 *
 * A reader who named accounts gets those accounts, empty or not: they asked.
 * A reader who named none gets every account with a balance or a movement,
 * which is what "general ledger" means — and which is not known until the
 * journal has been read, so the walk keeps the postings of every account and
 * the ones with nothing to say are dropped here.
 */
function generalLedgerFrom(
  books: Books,
  named: boolean,
  figure: Figure,
): Omit<GeneralLedger, keyof Statement> {
  const shown = (account: Account): boolean => {
    if (named) return books.detailed.has(account.id);
    const movement = books.reading.movements.get(account.id);
    return stirred(movement) || !measured(movement, 'standing').isZero();
  };
  return Object.freeze({
    accounts: Object.freeze(
      books.accounts.filter(shown).map((account) => ledgerOf(account, books, figure)),
    ),
  });
}

/**
 * A statement built in the books' own currency, keeping every distinct figure
 * it asked to write down.
 *
 * What it keeps is what is handed to `FX` when the statement is read in
 * another currency. Distinct, because a page repeats a figure often — a total
 * and the one line under it, a nought in twenty places — and one rate applied
 * twice to one amount cannot come out two ways.
 */
function inFunctional(currency: CurrencyCode): {
  readonly figure: Figure;
  readonly asked: () => readonly Money[];
} {
  const asked = new Map<string, Money>();
  return {
    figure: (amount) => {
      const written = amount.toFixed();
      if (!asked.has(written)) asked.set(written, money(amount, currency));
      return Object.freeze({ amount: written, currency });
    },
    asked: () => [...asked.values()],
  };
}

/**
 * The same statement written down again, in what `FX` translated each of its
 * figures to.
 *
 * A figure the second building asks for that the first never produced would
 * mean the two buildings differ, which is a defect in this file — and not
 * something to paper over with an untranslated amount standing among
 * translated ones.
 */
function translating(asked: readonly Money[], page: PresentedAll): Figure {
  const into = new Map<string, LedgerAmount>();
  asked.forEach((amount, index) => {
    const presented = page.amounts[index];
    if (presented === undefined) {
      throw new Error(
        `FX returned ${String(page.amounts.length)} figures for ${String(asked.length)}.`,
      );
    }
    into.set(
      toDecimalString(amount),
      Object.freeze({ amount: toDecimalString(presented), currency: presented.currency }),
    );
  });
  return (amount) => {
    const found = into.get(amount.toFixed());
    if (found === undefined) {
      throw new Error(
        `A statement asked to write down ${amount.toFixed()}, which its first reading never ` +
          'produced. A statement is built twice, and must be built the same way both times.',
      );
    }
    return found;
  };
}

/**
 * The span a statement covers and whose figures, judged as they may actually
 * arrive.
 *
 * The branch is read from `SYS` rather than taken on trust, because the
 * alternative is a statement of no figures for a branch that does not exist,
 * which reads exactly like a shop that sold nothing. A withdrawn branch
 * answers: a closed shop's figures are its history, and history stays
 * reportable (`SYS-09`).
 */
async function scopeOf<Session extends RecordSession>(
  context: ModuleContext<Session>,
  by: CommandContext,
  request: StatementRequest,
): Promise<Outcome<StatementScope>> {
  const from = dayArriving(request.from);
  if (!from.ok) return from;
  const to = dayArriving(request.to);
  if (!to.ok) return to;
  if (to.value < from.value) {
    return refuse('fin.span-inverted', { from: from.value, to: to.value });
  }

  const named = request.branch ?? null;
  if (named === null) return ok({ from: from.value, to: to.value, branch: null });
  const branch = await context.require(Organisation).branch(by, named);
  if (branch === null) return refuse('fin.branch-not-found', { branch: String(named) });
  return ok({ from: from.value, to: to.value, branch: branch.id });
}

/**
 * Whose board translates the figures (`FX-03`, `FX-04`).
 *
 * The branch the reader named, or the one the statement is of, or else the
 * first branch the tenant opened that is still trading — identifiers are
 * UUIDv7 and carry the moment they were made, so the smallest is the first. A
 * tenant with no trading branch has no board to read a figure at, and is
 * refused rather than shown one at a rate from nowhere.
 */
async function boardOf<Session extends RecordSession>(
  context: ModuleContext<Session>,
  by: CommandContext,
  scope: StatementScope,
  named: BranchId | undefined,
): Promise<Outcome<BranchId>> {
  if (named !== undefined) return ok(named);
  if (scope.branch !== null) return ok(scope.branch);
  const branches = await context.require(Organisation).branches(by);
  const first = [...branches].sort((one, other) => compareIds(one.id, other.id))[0];
  return first === undefined ? refuse('fin.branch-not-found') : ok(first.id);
}

/** A statement's body, and what every statement says about itself. */
interface Stated<T> {
  readonly heading: Statement;
  readonly body: T;
}

/**
 * Reads the books once and writes a statement out of them — twice, when it is
 * read in a currency other than the one the books are kept in.
 *
 * The order is the one every command in this module asks in: what can be
 * judged from the request alone, then `SYS`, then `FX` for what the tenant's
 * money is, then one read of this module's own — and only then, if a
 * translation was asked for, `FX` again. No two transactions are ever open at
 * once.
 *
 * Built twice rather than walked and rewritten, because the building is
 * arithmetic over a reading already taken and costs nothing beside that
 * reading — and because a walk that had to find every figure in four
 * differently shaped statements is a thing that silently misses one the day a
 * statement grows a total.
 */
async function stated<Session extends RecordSession, T>(
  context: ModuleContext<Session>,
  by: CommandContext,
  request: StatementRequest,
  detailing: Detailing | null,
  build: (books: Books, figure: Figure) => T,
): Promise<Outcome<Stated<T>>> {
  const scope = await scopeOf(context, by, request);
  if (!scope.ok) return scope;

  const functional = await context.require(Currencies).functional(by);
  if (functional === null) return refuse('fin.functional-currency-unset');

  const books = await reading(context)(by, (session): Outcome<Books> => {
    const accounts = accountsIn(session, by.tenant, { including: 'all' });
    const wanted = detailing === null ? ok<ReadonlySet<AccountId>>(new Set()) : detailing(accounts);
    if (!wanted.ok) return wanted;
    return ok({
      accounts,
      forest: treeOf(session, by.tenant, { including: 'all' }),
      detailed: wanted.value,
      reading: readJournal(session, by.tenant, scope.value, wanted.value),
    });
  });
  if (!books.ok) return books;

  const own = inFunctional(functional.code);
  const body = build(books.value, own.figure);
  const { presentation } = request;
  if (presentation === undefined) {
    return ok({
      heading: Object.freeze({ scope: scope.value, currency: functional.code, rate: null }),
      body,
    });
  }

  const board = await boardOf(context, by, scope.value, presentation.board);
  if (!board.ok) return board;
  // A statement says what currency it is in, so the rate that makes that true
  // is read even when the statement has no figures on it. A general ledger of
  // an account with nothing in it asks for no figure at all, and a page of
  // none reads no board (`Presentation.presentAll`) — which would leave it
  // labelled in a currency nobody checked the shop takes, at a branch nobody
  // checked had entered a rate today.
  own.figure(NOTHING);
  const asked = own.asked();
  const page = await context
    .require(Presentation)
    .presentAll(by, board.value, asked, presentation.into);
  if (!page.ok) return page;

  return ok({
    heading: Object.freeze({
      scope: scope.value,
      currency: presentation.into,
      rate: page.value.rate,
    }),
    body: build(books.value, translating(asked, page.value)),
  });
}

/**
 * Which accounts a general ledger details: the ones the reader named, or every
 * one there is.
 *
 * Naming an account the tenant does not have is refused. The reader asked
 * about that account precisely, and an empty page in answer would say it had
 * no postings — which is a different statement, and untrue.
 */
function detailing(named: readonly AccountId[] | undefined): Detailing {
  return (accounts) => {
    const held = new Set(accounts.map((account) => account.id));
    if (named === undefined) return ok(held);
    const wanted = new Set<AccountId>();
    for (const one of named) {
      const id = idArriving<'account'>(one);
      if (id === null || !held.has(id)) {
        return refuse('fin.account-not-found', { account: String(one) });
      }
      wanted.add(id);
    }
    return ok(wanted);
  };
}

/**
 * The statements of `FIN-07`, as `Statements` publishes them — built once per
 * contract that reads them, because this holds nothing.
 */
export function statements<Session extends RecordSession>(
  context: ModuleContext<Session>,
): Statements {
  /** A statement is its heading and its body, and a reader is handed one thing. */
  const written = <T>(read: Outcome<Stated<T>>): Outcome<Statement & T> =>
    read.ok ? ok(Object.freeze({ ...read.value.heading, ...read.value.body })) : read;

  return {
    trialBalance: async (by, request) =>
      written(await stated(context, by, request, null, trialBalanceFrom)),

    incomeStatement: async (by, request) =>
      written(await stated(context, by, request, null, incomeStatementFrom)),

    balanceSheet: async (by, request) =>
      written(await stated(context, by, request, null, balanceSheetFrom)),

    generalLedger: async (by, request: LedgerRequest) => {
      const named = request.accounts !== undefined;
      return written(
        await stated(context, by, request, detailing(request.accounts), (books, figure) =>
          generalLedgerFrom(books, named, figure),
        ),
      );
    },
  };
}
