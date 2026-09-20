import type { TenantId } from '@vertex/contracts';
import { ok, refuse, type LocalDate, type Money, type Result } from '@vertex/kernel';
import type { RateOverrideQuote } from '@vertex/fx/contract';

import { idArriving, shown, written } from './arriving.js';
import { postingPeriodOn } from './calendar.js';
import { postable } from './chart.js';
import {
  CONTROL_ACCOUNTS,
  FIN_ENTRY_KINDS,
  type Account,
  type AccountId,
  type EntrySide,
  type ManualEntry,
  type ManualLine,
  type PostingRefusal,
  type RecordSession,
} from './contract.js';
import {
  fieldsOf,
  figureOf,
  foreignOf,
  headingArriving,
  isSide,
  keptOrRefuse,
  memoArriving,
  placeOfLine,
  refuseAt,
  type Books,
  type Drafted,
  type JudgedLine,
  type Place,
  type Valued,
} from './drafts.js';

/**
 * The manual entry of `FIN-04`: the accountant's draft, brought to the shape
 * `drafts.ts` judges.
 *
 * In steps, because what a line needs decided is decided in different places.
 * Its shape — an account named, a side, money the tenant has, a memo — needs
 * nothing but the draft and what `FX` says the tenant's money is. Its account
 * — there, in use, a leaf, and not one the system keeps from its own documents
 * — needs the store. And an amount stated in another currency is valued by
 * `FX`, which may not be asked with a transaction open. So the steps are
 * functions, and `bookkeeping.ts` threads what each hands back.
 */

type Outcome<T> = Result<T, PostingRefusal>;

const CONTROLLED: ReadonlySet<string> = new Set(CONTROL_ACCOUNTS);

/** A manual entry's own fields judged, with its lines and attachments still to be. */
export interface JudgedManual extends Drafted {
  readonly description: string;
  readonly lines: readonly unknown[];
  readonly attachments: unknown;
}

/**
 * A manual entry as it arrives, judged in the order a person would fix it:
 * the heading every draft has, then the description — required, because the
 * feature says so and because an adjustment with no words beside it is a
 * figure an auditor has to assume is wrong — then whether there are lines.
 *
 * The source is this module's own kind and the entry's own identifier, so
 * that the same submission twice is one entry (`EntrySource`).
 */
export function manualArriving(draft: unknown): Outcome<JudgedManual> {
  const heading = headingArriving(draft);
  if (!heading.ok) return heading;
  const { description, lines, attachments } = fieldsOf<ManualEntry>(draft);

  const described = written(description);
  if (described === null) return refuse('fin.description-required');

  if (!Array.isArray(lines) || lines.length === 0) return refuse('fin.entry-empty');

  return ok({
    ...heading.value,
    source: Object.freeze({ kind: FIN_ENTRY_KINDS.manualEntry, document: heading.value.id }),
    description: described,
    lines: lines as readonly unknown[],
    attachments,
  });
}

/**
 * A line as the accountant wrote it, its shape judged: which account, which
 * side, how much and in what, whether a rate was typed over the day's, and
 * the memo. Nothing here has been looked up.
 *
 * `override` is carried as it arrived, for `FX` to judge — its form, its
 * figure, its reason, the right to make it — because a judgement made here
 * as well would be a second opinion about `FX`'s data. What is decided here
 * is only that it has something to override: a line already in the
 * functional currency is valued by no rate.
 */
export interface ManualLineShape {
  readonly place: Place;
  readonly account: AccountId;
  readonly side: EntrySide;
  /** As stated: in the functional currency, or in another the tenant has. */
  readonly amount: Money;
  readonly override: RateOverrideQuote | undefined;
  readonly memo: string | null;
}

export function manualLinesArriving(
  books: Books,
  lines: readonly unknown[],
): Outcome<ManualLineShape[]> {
  const shapes: ManualLineShape[] = [];
  for (const [index, arriving] of lines.entries()) {
    const place = placeOfLine(index + 1);
    const { account, side, amount, override, memo } = fieldsOf<ManualLine>(arriving);

    const named = idArriving<'account'>(account);
    if (named === null) {
      return refuseAt(place, 'fin.account-not-found', { account: shown(account) });
    }
    if (!isSide(side)) return refuseAt(place, 'fin.line-side-unknown', { side: shown(side) });

    const figure = figureOf(place, amount, books, 'fin.line-amount-invalid');
    if (!figure.ok) return figure;
    const overriding = override !== undefined && override !== null;
    if (overriding && figure.value.currency === books.functional.code) {
      return refuseAt(place, 'fin.line-override-on-functional');
    }

    const noted = memoArriving(place, memo);
    if (!noted.ok) return noted;

    shapes.push({
      place,
      account: named,
      side,
      amount: figure.value,
      // Widened back to the type `FX` takes, unjudged on purpose: see above.
      override: overriding ? (override as RateOverrideQuote) : undefined,
      memo: noted.value,
    });
  }
  return ok(shapes);
}

/** A line with its account found and judged, and its amount still to be valued if it is not in the books' currency. */
export interface PlacedLine extends ManualLineShape {
  readonly found: Account;
}

/**
 * Every line's account, found and judged, and the day in an open period as
 * of this reading — the whole of what a manual entry needs the store for
 * before it is written.
 *
 * An account is one a posting may land in — there, in use, a leaf — by the
 * same judgement a role's account is (`ChartOfAccounts.resolve`), and then one
 * more: not a control account (`CONTROL_ACCOUNTS`). The system keeps those
 * from its own documents, and a figure written onto one by hand is a figure
 * the subledger will never agree with. The account's own rule about a
 * currency is applied here too, before any rate is asked for: the till kept
 * in pounds takes pounds, and that is known without a rate.
 *
 * The period is asked here, before the lines are valued, so that an entry
 * dated into a closed month is refused before `FX` has been asked for a rate
 * and before any attachment has been kept. The answer that counts is the
 * transaction's (`admitPosting`).
 */
export function placeLines(
  session: RecordSession,
  tenant: TenantId,
  books: Books,
  day: LocalDate,
  shapes: readonly ManualLineShape[],
): Outcome<PlacedLine[]> {
  const placed: PlacedLine[] = [];
  for (const shape of shapes) {
    const { place } = shape;
    const found = postable(session, tenant, shape.account);
    if (!found.ok) return refuseAt(place, found.error.code, found.error.values);
    const { reserved } = found.value;
    if (reserved !== null && CONTROLLED.has(reserved)) {
      return refuseAt(place, 'fin.account-controlled', { account: found.value.id, reserved });
    }
    const kept = keptOrRefuse(place, found.value, books.functional, foreignOf(books, shape.amount));
    if (!kept.ok) return kept;
    placed.push({ ...shape, found: found.value });
  }

  const period = postingPeriodOn(session, tenant, day);
  if (!period.ok) return period;

  return ok(placed);
}

/** A placed line whose amount has been valued: what `assembled` takes. By account, with no role. */
export function judgedManualLine(line: PlacedLine, valued: Valued): JudgedLine {
  return {
    account: line.found,
    role: null,
    side: line.side,
    amount: valued.amount,
    original: valued.stamp === null ? null : line.amount,
    stamp: valued.stamp,
    memo: line.memo,
  };
}
