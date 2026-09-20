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
  FIN_ENTRY_KINDS,
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
import type { JudgedAttachment } from './attachments.js';
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
 *
 * The judgements a line is put through are one set, whoever drafted it. A
 * module's draft names roles (`EntryDraft`); the accountant's names accounts
 * (`ManualEntry`) and the opening balances name figures (`OpeningBalances`),
 * and `manual.ts` and `opening.ts` bring each of those to the shape judged
 * here — so a rule about an amount, an account's currency or the balance of
 * the two sides is stated once and holds for every door into the journal.
 */

type Outcome<T> = Result<T, PostingRefusal>;

/** A value's fields as they may actually arrive: typed by a person, or read off a wire. */
type Arriving<T> = { readonly [Field in keyof T]: unknown };

/**
 * A value as it may actually arrive, **including not at all**, so that a
 * command which reached this module without its body is refused field by
 * field like any other rather than thrown at.
 */
export function fieldsOf<T>(arriving: unknown): Arriving<T> {
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

export function isSide(value: unknown): value is EntrySide {
  return typeof value === 'string' && SIDES.has(value);
}

/**
 * What a refusal about one line points at: the line, counted from one, so
 * that a screen can point at the line rather than at the entry — and, for an
 * opening figure, the figure and the till's currency, because the accountant
 * entering opening balances never saw a line.
 */
export type Place = Readonly<Record<string, RefusalValue>>;

export function placeOfLine(ordinal: number): Place {
  return { line: ordinal };
}

/**
 * A refusal about one line, carrying its place. The chart's and `FX`'s
 * refusals come through here too, with the place added to what they already
 * say.
 */
export function refuseAt<Code extends string>(
  place: Place,
  code: Code,
  values: Readonly<Record<string, RefusalValue>> = {},
): Result<never, Refusal<Code>> {
  return refuse(code, { ...place, ...values });
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
 * The fields every draft carries, judged: the identifier, the branch and the
 * day — each what it claims to be, or refused here before `SYS` is asked about
 * the branch or `FX` about the books.
 */
export interface JudgedHeading {
  readonly id: JournalEntryId;
  readonly branch: BranchId;
  readonly day: LocalDate;
}

export function headingArriving(draft: unknown): Outcome<JudgedHeading> {
  const { id, branch, day } = fieldsOf<EntryDraft>(draft);

  const entry = idArriving<'journal-entry'>(id);
  if (entry === null) return refuse('fin.entry-id-invalid', { id: shown(id) });

  const at = idArriving<'branch'>(branch);
  if (at === null) return refuse('fin.branch-not-found', { branch: shown(branch) });

  const dated = dayArriving(day);
  if (!dated.ok) return dated;

  return ok({ id: entry, branch: at, day: dated.value });
}

/** Words, when there are any: null for nothing given, refused for something given that is not words. */
export function descriptionArriving(
  description: unknown,
): Result<string | null, Refusal<'fin.description-invalid'>> {
  if (description === undefined || description === null) return ok(null);
  const described = written(description);
  return described === null ? refuse('fin.description-invalid') : ok(described);
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
  const heading = headingArriving(draft);
  if (!heading.ok) return heading;
  const { source, description, lines } = fieldsOf<EntryDraft>(draft);

  const { kind, document } = fieldsOf<EntrySource>(source);
  if (typeof kind !== 'string' || !KIND.test(kind)) {
    return refuse('fin.source-kind-invalid', { kind: shown(kind) });
  }
  const reference = referenceArriving(document);
  if (reference === '') return refuse('fin.source-document-required');

  const described = descriptionArriving(description);
  if (!described.ok) return described;

  if (!Array.isArray(lines) || lines.length === 0) return refuse('fin.entry-empty');

  return ok({
    ...heading.value,
    source: Object.freeze({ kind, document: reference }),
    description: described.value,
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
 * Money on a line, judged: money at all, in a currency the tenant has, more
 * than nothing, and no finer than the currency is stored at.
 *
 * The precision is the one rule here that is about `FX-07` rather than about
 * arithmetic. A figure with more places than its currency keeps is a figure
 * that passed no rounding point — and this module has no rule to round it by,
 * because the rules are `FX`'s, so it refuses where `FX` would have rounded.
 */
export function figureOf(
  place: Place,
  value: unknown,
  books: Books,
  invalid: 'fin.line-amount-invalid' | 'fin.line-original-invalid',
): Outcome<Money> {
  const amount = moneyArriving(value);
  if (amount === null) return refuseAt(place, invalid, { amount: shown(value) });
  const currency = books.currencies.find((one) => one.code === amount.currency);
  if (currency === undefined) {
    return refuseAt(place, 'fin.line-currency-unknown', { currency: amount.currency });
  }
  if (!amount.amount.greaterThan(0)) {
    return refuseAt(place, invalid, { amount: toDecimalString(amount) });
  }
  if (amount.amount.decimalPlaces() > currency.decimals) {
    return refuseAt(place, 'fin.line-amount-too-precise', {
      amount: toDecimalString(amount),
      currency: amount.currency,
      decimals: currency.decimals,
    });
  }
  return ok(amount);
}

/** A memo on a line: words or nothing, trimmed; refused for anything that is not a string. */
export function memoArriving(
  place: Place,
  memo: unknown,
): Result<string | null, Refusal<'fin.line-memo-invalid'>> {
  if (memo === undefined || memo === null) return ok(null);
  if (typeof memo !== 'string') return refuseAt(place, 'fin.line-memo-invalid');
  return ok(memo.trim() === '' ? null : memo.trim());
}

/**
 * The rule about a line's original amount, which is the account's and not the
 * caller's.
 *
 * An account kept in a currency — a cash account, `FIN-01` — holds what is in
 * the till, and that is counted in the till's own notes: a line on it states
 * the amount in that currency or it is refused, and the dollar till, kept in
 * the functional currency, takes no original at all. Any other account may
 * carry one — a receivable in pounds.
 */
export function keptOrRefuse(
  place: Place,
  account: Account,
  functional: TenantCurrency,
  inOwnCurrency: Money | null,
): Outcome<void> {
  const kept = account.currency;
  if (kept === null) return ok(undefined);
  if (kept === functional.code) {
    if (inOwnCurrency !== null) {
      return refuseAt(place, 'fin.line-currency-mismatch', {
        account: kept,
        original: inOwnCurrency.currency,
      });
    }
  } else if (inOwnCurrency === null) {
    return refuseAt(place, 'fin.line-original-required');
  } else if (inOwnCurrency.currency !== kept) {
    return refuseAt(place, 'fin.line-currency-mismatch', {
      account: kept,
      original: inOwnCurrency.currency,
    });
  }
  return ok(undefined);
}

/**
 * An original and the stamp that valued it come together or not at all
 * (`FX-05`): a converted amount says what rate converted it, and a stamp with
 * nothing it valued is a claim about nothing.
 */
function pairedOrRefuse(
  place: Place,
  inOwnCurrency: Money | null,
  valuedAt: RateStampId | null,
): Outcome<void> {
  if (inOwnCurrency !== null && valuedAt === null) {
    return refuseAt(place, 'fin.line-stamp-required');
  }
  if (inOwnCurrency === null && valuedAt !== null) {
    return refuseAt(place, 'fin.line-original-required');
  }
  return ok(undefined);
}

/** An amount as stated when it is in another currency than the books', or null when it is the books' own. */
export function foreignOf(books: Books, amount: Money): Money | null {
  return amount.currency === books.functional.code ? null : amount;
}

/**
 * What valuing an amount settled: the figure in the books' currency, and the
 * stamp that valued it — null for an amount that was in the books' currency
 * already and needed no rate.
 */
export interface Valued {
  readonly amount: Money;
  readonly stamp: RateStampId | null;
}

/** A line judged: its account found, and every figure and mark on it settled. */
export interface JudgedLine {
  readonly account: Account;
  /** The role it was drafted by, or null for a line placed by account (`FIN-04`). */
  readonly role: string | null;
  readonly side: EntrySide;
  /** In the functional currency. */
  readonly amount: Money;
  readonly original: Money | null;
  readonly stamp: RateStampId | null;
  readonly memo: string | null;
}

/**
 * One line as a module drafts it, judged in the order a person would fix it:
 * the role, the side, the amount, then what the account it resolved to
 * requires of the amount in the document's own currency.
 */
function lineArriving(
  session: RecordSession,
  tenant: TenantId,
  declared: readonly AccountRoleDeclaration[],
  books: Books,
  ordinal: number,
  arriving: unknown,
): Outcome<JudgedLine> {
  const place = placeOfLine(ordinal);
  const { role, currency, side, amount, original, stamp, memo } = fieldsOf<DraftLine>(arriving);
  const { functional } = books;

  if (typeof role !== 'string') {
    return refuseAt(place, 'fin.account-role-undeclared', { role: shown(role) });
  }
  let resolvedFor: CurrencyCode | undefined;
  if (currency !== undefined) {
    if (typeof currency !== 'string' || !books.currencies.some((one) => one.code === currency)) {
      return refuseAt(place, 'fin.line-currency-unknown', { currency: shown(currency) });
    }
    resolvedFor = currency;
  }
  if (!isSide(side)) {
    return refuseAt(place, 'fin.line-side-unknown', { side: shown(side) });
  }

  const figure = figureOf(place, amount, books, 'fin.line-amount-invalid');
  if (!figure.ok) return figure;
  if (figure.value.currency !== functional.code) {
    return refuseAt(place, 'fin.line-currency-not-functional', {
      currency: figure.value.currency,
      functional: functional.code,
    });
  }

  const account = resolveRole(session, tenant, declared, role, resolvedFor);
  if (!account.ok) return refuseAt(place, account.error.code, account.error.values);

  let inOwnCurrency: Money | null = null;
  if (original !== undefined && original !== null) {
    const stated = figureOf(place, original, books, 'fin.line-original-invalid');
    if (!stated.ok) return stated;
    if (stated.value.currency === functional.code) {
      return refuseAt(place, 'fin.line-original-is-functional', { currency: functional.code });
    }
    inOwnCurrency = stated.value;
  }

  const kept = keptOrRefuse(place, account.value, functional, inOwnCurrency);
  if (!kept.ok) return kept;

  let valuedAt: RateStampId | null = null;
  if (stamp !== undefined && stamp !== null) {
    valuedAt = idArriving<'rate-stamp'>(stamp);
    if (valuedAt === null)
      return refuseAt(place, 'fin.line-stamp-invalid', { stamp: shown(stamp) });
  }
  const paired = pairedOrRefuse(place, inOwnCurrency, valuedAt);
  if (!paired.ok) return paired;

  const noted = memoArriving(place, memo);
  if (!noted.ok) return noted;

  return ok({
    account: account.value,
    role,
    side,
    amount: figure.value,
    original: inOwnCurrency,
    stamp: valuedAt,
    memo: noted.value,
  });
}

/** What each side comes to. */
export interface Sides {
  readonly debits: Decimal;
  readonly credits: Decimal;
}

export function sidesOf(
  lines: readonly { readonly side: EntrySide; readonly amount: Money }[],
): Sides {
  let debits = new Dec(0);
  let credits = new Dec(0);
  for (const { side, amount } of lines) {
    if (side === 'debit') debits = debits.plus(amount.amount);
    else credits = credits.plus(amount.amount);
  }
  return { debits, credits };
}

/** What is settled about an entry before its lines are: who it is for, and what it records. */
export interface Drafted {
  readonly id: JournalEntryId;
  readonly source: EntrySource;
  readonly branch: BranchId;
  readonly day: LocalDate;
  readonly description: string | null;
}

/**
 * The entry a set of judged lines becomes, once the two sides are proved equal
 * **exactly**.
 *
 * Exactly, with no tolerance, because there is nothing a tolerance could be
 * for. `FX-07` rounds at two defined points and hands back what rounding moved
 * as a residual naming its account; a caller puts that residual on a line, and
 * the entry balances by construction. An entry that does not balance is not
 * one rounding failed to close — it is one whose caller did its own
 * arithmetic, and the one place that must never be papered over is here.
 */
export function assembled(
  books: Books,
  making: Making,
  drafted: Drafted,
  judged: readonly JudgedLine[],
  attachments: readonly JudgedAttachment[],
): Outcome<PreparedEntry> {
  const { tenant } = making;
  const { debits, credits } = sidesOf(judged);
  if (!debits.equals(credits)) {
    return refuse('fin.entry-unbalanced', {
      debits: debits.toFixed(),
      credits: credits.toFixed(),
      currency: books.functional.code,
    });
  }

  const lines = judged.map((line, index): JournalLine => ({
    id: newId<'journal-line'>(),
    tenant,
    entry: drafted.id,
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
      id: drafted.id,
      tenant,
      source: drafted.source,
      branch: drafted.branch,
      register: making.register,
      day: drafted.day,
      description: drafted.description,
      total: Object.freeze({ amount: debits.toFixed(), currency: books.functional.code }),
      reverses: null,
      by: making.by,
      device: making.device,
      at: making.at,
      lines,
      attachments: attachments.map((one, index) => ({
        ...one,
        tenant,
        entry: drafted.id,
        ordinal: index + 1,
      })),
    }),
  );
}

/**
 * The entry a module's draft becomes (`PostingEngine.prepare`): every line
 * judged and resolved, the two sides equal, and the day in an open period as
 * of this reading.
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

  const built = assembled(books, making, draft, judged, []);
  if (!built.ok) return built;

  // Advisory, and asked all the same: a caller building a document learns
  // here that the month is closed, before it has written the document. The
  // answer that counts is the transaction's (`admitPosting`).
  const period = postingPeriodOn(session, tenant, draft.day);
  if (!period.ok) return period;

  return built;
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
 * No attachments: the evidence stays with the entry it was evidence for, and
 * the reversal names that entry.
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
    source: Object.freeze({ kind: FIN_ENTRY_KINDS.reversal, document: original.entry.id }),
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
    attachments: [],
  });
}
