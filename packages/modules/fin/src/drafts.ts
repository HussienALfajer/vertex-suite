import type { BranchId, DeviceId, RegisterId, TenantId, UserId } from '@vertex/contracts';
import {
  Dec,
  newId,
  ok,
  refuse,
  toDecimalString,
  type CurrencyCode,
  type Decimal,
  type Instant,
  type LocalDate,
  type Money,
  type Refusal,
  type RefusalValue,
  type Result,
} from '@vertex/kernel';
import type { AccountRoleDeclaration } from '@vertex/platform';
import type { RateStampId, TenantCurrency } from '@vertex/fx/contract';

import {
  dayArriving,
  idArriving,
  moneyArriving,
  referenceArriving,
  shown,
  written,
} from './arriving.js';
import { postingPeriodOn } from './calendar.js';
import { resolveRole } from './chart.js';
import {
  ENTRY_SIDES,
  type Account,
  type DraftLine,
  type EntryDraft,
  type EntrySide,
  type EntrySource,
  type JournalEntryId,
  type JournalLine,
  type LedgerAmount,
  type Posted,
  type PostingRefusal,
  type PreparedEntry,
  type RecordSession,
  type ReversalTerms,
} from './contract.js';
import { postedIn, reversalIn, sealedPrepared } from './journal.js';

/**
 * A draft becoming an entry: the first half of `FIN-02`'s engine, which is the
 * half that can refuse.
 *
 * Everything here reads and judges; nothing writes. What comes out is a
 * `PreparedEntry` with every account resolved, every figure judged and the two
 * sides proved equal, so that the write in `journal.ts` has nothing left to
 * decide but what only a transaction can — and so that a caller building a
 * document learns of a refusal before it has written a word of the document.
 */

type Outcome<T> = Result<T, PostingRefusal>;

/** A value's fields as they may actually arrive: typed by a person, or read off a wire. */
type Arriving<T> = { readonly [Field in keyof T]: unknown };

/**
 * A value as it may actually arrive, **including not at all**, so that a
 * command which reached this module without its body is refused field by
 * field like any other rather than thrown at.
 */
function fieldsOf<T>(arriving: unknown): Arriving<T> {
  return (arriving ?? {}) as Arriving<T>;
}

/**
 * `pos.sale`, `pur.goods-receipt`: a module's name and then the document's, in
 * the grammar `SYS` numbers documents by — and strict for the reason `SYS`
 * gives, which is that the kind is half of what tells one event from another.
 * `pos.sale` and `pos.sale ` would be two kinds, and a sale posted under each
 * would be two entries for one sale.
 */
const KIND = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const SIDES: ReadonlySet<string> = new Set(ENTRY_SIDES);

function isSide(value: unknown): value is EntrySide {
  return typeof value === 'string' && SIDES.has(value);
}

/** A draft with its own shape judged, and its lines still to be. */
export interface JudgedDraft {
  readonly id: JournalEntryId;
  readonly source: EntrySource;
  readonly branch: BranchId;
  readonly day: LocalDate;
  readonly description: string | null;
  readonly lines: readonly unknown[];
}

/**
 * A draft's own fields, judged before anybody is asked anything.
 *
 * The identifier, the event, the branch, the day, the description and whether
 * there are lines at all: each is what it claims to be or the draft is refused
 * here, before `SYS` is asked about the branch or `FX` about the books. A
 * command that is not one costs no question and no read.
 */
export function draftArriving(draft: unknown): Outcome<JudgedDraft> {
  const { id, source, branch, day, description, lines } = fieldsOf<EntryDraft>(draft);

  const entry = idArriving<'journal-entry'>(id);
  if (entry === null) return refuse('fin.entry-id-invalid', { id: shown(id) });

  const { kind, document } = fieldsOf<EntrySource>(source);
  if (typeof kind !== 'string' || !KIND.test(kind)) {
    return refuse('fin.source-kind-invalid', { kind: shown(kind) });
  }
  const reference = referenceArriving(document);
  if (reference === '') return refuse('fin.source-document-required');

  const at = idArriving<'branch'>(branch);
  if (at === null) return refuse('fin.branch-not-found', { branch: shown(branch) });

  const dated = dayArriving(day);
  if (!dated.ok) return dated;

  let described: string | null = null;
  if (description !== undefined && description !== null) {
    described = written(description);
    if (described === null) return refuse('fin.description-invalid');
  }

  if (!Array.isArray(lines) || lines.length === 0) return refuse('fin.entry-empty');

  return ok({
    id: entry,
    source: Object.freeze({ kind, document: reference }),
    branch: at,
    day: dated.value,
    description: described,
    lines: lines as readonly unknown[],
  });
}

/** The tenant's money, as `FX` reports it: what the books are kept in, and every currency the tenant has. */
export interface Books {
  readonly functional: TenantCurrency;
  readonly currencies: readonly TenantCurrency[];
}

/** Where, by whom and when an entry is being made: what the engine established before judging the draft. */
export interface Making {
  readonly tenant: TenantId;
  readonly register: RegisterId | null;
  readonly by: UserId | null;
  readonly device: DeviceId | null;
  readonly at: Instant;
}

/** A figure written down as the ledger keeps it. */
function booked(amount: Money): LedgerAmount {
  return Object.freeze({ amount: toDecimalString(amount), currency: amount.currency });
}

/**
 * A refusal about one line, carrying the line's place so that a screen can
 * point at the line rather than at the entry. The chart's refusals come
 * through here too, with the line added to what they already say.
 */
function refuseLine<Code extends string>(
  ordinal: number,
  code: Code,
  values: Readonly<Record<string, RefusalValue>> = {},
): Result<never, Refusal<Code>> {
  return refuse(code, { ...values, line: ordinal });
}

/**
 * Money on a line, judged: money at all, in a currency the tenant has, more
 * than nothing, and no finer than the currency is stored at.
 *
 * The precision is the one rule here that is about `FX-07` rather than about
 * arithmetic. A figure with more places than its currency keeps is a figure
 * that passed no rounding point — and this module has no rule to round it by,
 * because the rules are `FX`'s, so it refuses where `FX` would have rounded.
 */
function figureOf(
  ordinal: number,
  value: unknown,
  books: Books,
  invalid: 'fin.line-amount-invalid' | 'fin.line-original-invalid',
): Outcome<Money> {
  const amount = moneyArriving(value);
  if (amount === null) return refuseLine(ordinal, invalid, { amount: shown(value) });
  const currency = books.currencies.find((one) => one.code === amount.currency);
  if (currency === undefined) {
    return refuseLine(ordinal, 'fin.line-currency-unknown', { currency: amount.currency });
  }
  if (!amount.amount.greaterThan(0)) {
    return refuseLine(ordinal, invalid, { amount: toDecimalString(amount) });
  }
  if (amount.amount.decimalPlaces() > currency.decimals) {
    return refuseLine(ordinal, 'fin.line-amount-too-precise', {
      amount: toDecimalString(amount),
      currency: amount.currency,
      decimals: currency.decimals,
    });
  }
  return ok(amount);
}

/** A line judged: its account found, and every figure and mark on it settled. */
interface JudgedLine {
  readonly account: Account;
  readonly role: string;
  readonly side: EntrySide;
  readonly amount: Money;
  readonly original: Money | null;
  readonly stamp: RateStampId | null;
  readonly memo: string | null;
}

/**
 * One line as it may actually arrive, judged in the order a person would fix
 * it: the role, the side, the amount, then what the account it resolved to
 * requires of the amount in the document's own currency.
 *
 * The rule about the original is the account's, not the caller's. An account
 * kept in a currency — a cash account, `FIN-01` — holds what is in the till,
 * and that is counted in the till's own notes: a line on it states the amount
 * in that currency or it is refused, and the dollar till, kept in the
 * functional currency, takes no original at all. Any other account may carry
 * one — a receivable in pounds — and then the stamp that valued it (`FX-05`).
 */
function lineArriving(
  session: RecordSession,
  tenant: TenantId,
  declared: readonly AccountRoleDeclaration[],
  books: Books,
  ordinal: number,
  arriving: unknown,
): Outcome<JudgedLine> {
  const { role, currency, side, amount, original, stamp, memo } = fieldsOf<DraftLine>(arriving);
  const { functional } = books;

  if (typeof role !== 'string') {
    return refuseLine(ordinal, 'fin.account-role-undeclared', { role: shown(role) });
  }
  let resolvedFor: CurrencyCode | undefined;
  if (currency !== undefined) {
    if (typeof currency !== 'string' || !books.currencies.some((one) => one.code === currency)) {
      return refuseLine(ordinal, 'fin.line-currency-unknown', { currency: shown(currency) });
    }
    resolvedFor = currency;
  }
  if (!isSide(side)) {
    return refuseLine(ordinal, 'fin.line-side-unknown', { side: shown(side) });
  }

  const figure = figureOf(ordinal, amount, books, 'fin.line-amount-invalid');
  if (!figure.ok) return figure;
  if (figure.value.currency !== functional.code) {
    return refuseLine(ordinal, 'fin.line-currency-not-functional', {
      currency: figure.value.currency,
      functional: functional.code,
    });
  }

  const account = resolveRole(session, tenant, declared, role, resolvedFor);
  if (!account.ok) return refuseLine(ordinal, account.error.code, account.error.values);

  let inOwnCurrency: Money | null = null;
  if (original !== undefined && original !== null) {
    const stated = figureOf(ordinal, original, books, 'fin.line-original-invalid');
    if (!stated.ok) return stated;
    if (stated.value.currency === functional.code) {
      return refuseLine(ordinal, 'fin.line-original-is-functional', { currency: functional.code });
    }
    inOwnCurrency = stated.value;
  }

  const kept = account.value.currency;
  if (kept !== null) {
    if (kept === functional.code) {
      if (inOwnCurrency !== null) {
        return refuseLine(ordinal, 'fin.line-currency-mismatch', {
          account: kept,
          original: inOwnCurrency.currency,
        });
      }
    } else if (inOwnCurrency === null) {
      return refuseLine(ordinal, 'fin.line-original-required');
    } else if (inOwnCurrency.currency !== kept) {
      return refuseLine(ordinal, 'fin.line-currency-mismatch', {
        account: kept,
        original: inOwnCurrency.currency,
      });
    }
  }

  let valuedAt: RateStampId | null = null;
  if (stamp !== undefined && stamp !== null) {
    valuedAt = idArriving<'rate-stamp'>(stamp);
    if (valuedAt === null)
      return refuseLine(ordinal, 'fin.line-stamp-invalid', { stamp: shown(stamp) });
  }
  // Together or not at all: a converted amount says what rate converted it,
  // and a stamp with nothing it valued is a claim about nothing.
  if (inOwnCurrency !== null && valuedAt === null) {
    return refuseLine(ordinal, 'fin.line-stamp-required');
  }
  if (inOwnCurrency === null && valuedAt !== null) {
    return refuseLine(ordinal, 'fin.line-original-required');
  }

  let noted: string | null = null;
  if (memo !== undefined && memo !== null) {
    if (typeof memo !== 'string') return refuseLine(ordinal, 'fin.line-memo-invalid');
    noted = memo.trim() === '' ? null : memo.trim();
  }

  return ok({
    account: account.value,
    role,
    side,
    amount: figure.value,
    original: inOwnCurrency,
    stamp: valuedAt,
    memo: noted,
  });
}

/** What each side comes to. */
interface Sides {
  readonly debits: Decimal;
  readonly credits: Decimal;
}

function sidesOf(lines: readonly { readonly side: EntrySide; readonly amount: Money }[]): Sides {
  let debits = new Dec(0);
  let credits = new Dec(0);
  for (const { side, amount } of lines) {
    if (side === 'debit') debits = debits.plus(amount.amount);
    else credits = credits.plus(amount.amount);
  }
  return { debits, credits };
}

/**
 * The entry a draft becomes (`PostingEngine.prepare`): every line judged and
 * resolved, the two sides equal **exactly**, and the day in an open period as
 * of this reading.
 *
 * Exactly, with no tolerance, because there is nothing a tolerance could be
 * for. `FX-07` rounds at two defined points and hands back what rounding moved
 * as a residual naming its account; a caller puts that residual on a line, and
 * the entry balances by construction. An entry that does not balance is not
 * one rounding failed to close — it is one whose caller did its own
 * arithmetic, and the one place that must never be papered over is here.
 */
export function prepareEntry(
  session: RecordSession,
  declared: readonly AccountRoleDeclaration[],
  books: Books,
  making: Making,
  draft: JudgedDraft,
): Outcome<PreparedEntry> {
  const { tenant } = making;
  const judged: JudgedLine[] = [];
  for (const [index, arriving] of draft.lines.entries()) {
    const line = lineArriving(session, tenant, declared, books, index + 1, arriving);
    if (!line.ok) return line;
    judged.push(line.value);
  }

  const { debits, credits } = sidesOf(judged);
  if (!debits.equals(credits)) {
    return refuse('fin.entry-unbalanced', {
      debits: debits.toFixed(),
      credits: credits.toFixed(),
      currency: books.functional.code,
    });
  }

  // Advisory, and asked all the same: a caller building a document learns
  // here that the month is closed, before it has written the document. The
  // answer that counts is the transaction's (`admitPosting`).
  const period = postingPeriodOn(session, tenant, draft.day);
  if (!period.ok) return period;

  const lines = judged.map((line, index): JournalLine => ({
    id: newId<'journal-line'>(),
    tenant,
    entry: draft.id,
    ordinal: index + 1,
    account: line.account.id,
    role: line.role,
    side: line.side,
    amount: booked(line.amount),
    original: line.original === null ? null : booked(line.original),
    stamp: line.stamp,
    memo: line.memo,
  }));

  return ok(
    sealedPrepared({
      id: draft.id,
      tenant,
      source: draft.source,
      branch: draft.branch,
      register: making.register,
      day: draft.day,
      description: draft.description,
      total: Object.freeze({ amount: debits.toFixed(), currency: books.functional.code }),
      reverses: null,
      by: making.by,
      device: making.device,
      at: making.at,
      lines,
    }),
  );
}

/** What a reversal is built from: the entry it undoes, and how it is dated and explained. */
export interface ReversalBasis {
  readonly original: Posted;
  readonly day: LocalDate;
  readonly reason: string;
}

/**
 * The terms of a reversal, judged against the entry they name
 * (`PostingEngine.prepareReversal`).
 *
 * The reason before the day, and both before the entry is read: somebody who
 * typed neither is told about the reason, which is the part they have to
 * decide rather than look up. An entry of another tenant is as absent as one
 * that never existed, for the reason every read in this module reads its own
 * tenant's records and nobody else's.
 */
export function reversalArriving(
  session: RecordSession,
  tenant: TenantId,
  original: unknown,
  terms: unknown,
): Outcome<ReversalBasis> {
  const id = idArriving<'journal-entry'>(original);
  if (id === null) return refuse('fin.entry-not-found', { entry: shown(original) });

  const { day, reason } = fieldsOf<ReversalTerms>(terms);
  const why = written(reason);
  if (why === null) return refuse('fin.reversal-reason-required', { entry: id });
  const dated = dayArriving(day);
  if (!dated.ok) return dated;

  const posted = postedIn(session, tenant, id);
  if (posted === null) return refuse('fin.entry-not-found', { entry: id });
  if (dated.value < posted.entry.day) {
    return refuse('fin.reversal-before-original', {
      entry: id,
      day: dated.value,
      original: posted.entry.day,
    });
  }
  const reversed = reversalIn(session, tenant, id);
  if (reversed !== null) {
    return refuse('fin.entry-already-reversed', { entry: id, reversal: reversed.reversal });
  }
  // Advisory here as in `prepareEntry`; decided again where the entry is written.
  const period = postingPeriodOn(session, tenant, dated.value);
  if (!period.ok) return period;

  return ok({ original: posted, day: dated.value, reason: why });
}

/**
 * The entry that reverses another (`FIN-03`): the same lines, each on the
 * other side, at the same amount, the same original and the same stamp.
 *
 * The same stamp, deliberately. A reversal undoes the original at the rate the
 * original used, so that the two cancel to the last place in every currency
 * they touch; revaluing at today's rate would leave a difference behind, and a
 * difference is `FX-08`'s to post, knowingly, and not this function's to
 * produce by accident.
 *
 * Its source is this module's own kind and the original's identifier, which
 * is what makes reversing idempotent per original: the second reversal of one
 * entry, replayed or raced, lands on the first.
 */
export function reversalOf(basis: ReversalBasis, making: Making): PreparedEntry {
  const { original, day, reason } = basis;
  const id = newId<'journal-entry'>();
  const lines = original.lines.map((line): JournalLine => ({
    id: newId<'journal-line'>(),
    tenant: making.tenant,
    entry: id,
    ordinal: line.ordinal,
    account: line.account,
    role: line.role,
    side: line.side === 'debit' ? 'credit' : 'debit',
    amount: Object.freeze({ ...line.amount }),
    original: line.original === null ? null : Object.freeze({ ...line.original }),
    stamp: line.stamp,
    memo: line.memo,
  }));
  return sealedPrepared({
    id,
    tenant: making.tenant,
    source: Object.freeze({ kind: 'fin.reversal', document: original.entry.id }),
    branch: original.entry.branch,
    register: making.register,
    day,
    description: reason,
    total: Object.freeze({ ...original.entry.total }),
    reverses: original.entry.id,
    by: making.by,
    device: making.device,
    at: making.at,
    lines,
  });
}
