import type { TenantId } from '@vertex/contracts';
import {
  money,
  ok,
  refuse,
  type CurrencyCode,
  type LocalDate,
  type Money,
  type Result,
} from '@vertex/kernel';
import type { AccountRoleDeclaration } from '@vertex/platform';
import type { RateOverrideQuote } from '@vertex/fx/contract';

import { shown } from './arriving.js';
import { postingPeriodOn } from './calendar.js';
import { resolveRole } from './chart.js';
import {
  FIN_ACCOUNT_ROLES,
  FIN_ENTRY_KINDS,
  type Account,
  type EntrySide,
  type OpeningBalances,
  type OpeningFigure,
  type OpeningFigureName,
  type PostingRefusal,
  type RecordSession,
} from './contract.js';
import {
  descriptionArriving,
  fieldsOf,
  figureOf,
  foreignOf,
  headingArriving,
  keptOrRefuse,
  refuseAt,
  sidesOf,
  type Books,
  type Drafted,
  type JudgedLine,
  type Place,
  type Valued,
} from './drafts.js';

/**
 * The opening balances of `FIN-06`: four figures brought to the lines of one
 * entry.
 *
 * The shape of the entry is fixed here and nowhere else — which figure goes
 * to which reserved purpose, on which side, and that the whole balances
 * against opening-balance equity — so that the accountant enters what the
 * shop *has* and never decides what a debit is. Every line is then judged by
 * exactly what judges a module's line, and posted by exactly what posts one.
 */

type Outcome<T> = Result<T, PostingRefusal>;

/** Which purpose a figure opens, and on which side. */
interface Structure {
  readonly figure: OpeningFigureName;
  readonly role: string;
  readonly side: EntrySide;
}

/**
 * Stock, tills and what customers owe are what the shop has; what it owes
 * suppliers is the one figure on the other side.
 */
const INVENTORY: Structure = {
  figure: 'inventory',
  role: FIN_ACCOUNT_ROLES.openingInventory,
  side: 'debit',
};
const TILL: Structure = { figure: 'till', role: FIN_ACCOUNT_ROLES.openingCash, side: 'debit' };
const CUSTOMER_DEBTS: Structure = {
  figure: 'customer-debts',
  role: FIN_ACCOUNT_ROLES.openingCustomerDebts,
  side: 'debit',
};
const SUPPLIER_DEBTS: Structure = {
  figure: 'supplier-debts',
  role: FIN_ACCOUNT_ROLES.openingSupplierDebts,
  side: 'credit',
};

/**
 * One figure, its shape judged, with the role and the side the structure
 * gives it. Nothing here has been looked up.
 *
 * `place` names the figure as well as the line, and for a till its currency,
 * because that is what the accountant entering opening balances can see.
 */
export interface OpeningFigureShape extends Structure {
  readonly place: Place;
  /** The till's, for a till; a cash role resolves per currency (`FIN-01`). */
  readonly currency: CurrencyCode | undefined;
  /** As stated: in the functional currency, or in another the tenant has. */
  readonly amount: Money;
  readonly override: RateOverrideQuote | undefined;
}

/** The four figures as they arrived, each still to be judged against the tenant's money. */
export interface OpeningGiven {
  readonly inventory: unknown;
  readonly tills: unknown;
  readonly customerDebts: unknown;
  readonly supplierDebts: unknown;
}

/** Opening balances judged as far as they can be before `FX` is asked what the tenant's money is. */
export interface JudgedOpening extends Drafted {
  readonly given: OpeningGiven;
}

/**
 * Opening balances as they arrive: the heading every draft has, and the
 * description if any, judged before `SYS` is asked about the branch or `FX`
 * about the books. The source is this module's own kind and the entry's own
 * identifier, so that the same submission twice is one entry.
 */
export function openingArriving(draft: unknown): Outcome<JudgedOpening> {
  const heading = headingArriving(draft);
  if (!heading.ok) return heading;
  const { description, inventory, tills, customerDebts, supplierDebts } =
    fieldsOf<OpeningBalances>(draft);

  const described = descriptionArriving(description);
  if (!described.ok) return described;

  return ok({
    ...heading.value,
    source: Object.freeze({ kind: FIN_ENTRY_KINDS.openingBalance, document: heading.value.id }),
    description: described.value,
    given: { inventory, tills, customerDebts, supplierDebts },
  });
}

function figureShape(
  books: Books,
  place: Place,
  structure: Structure,
  arriving: unknown,
): Outcome<OpeningFigureShape> {
  const { amount, override } = fieldsOf<OpeningFigure>(arriving);

  const stated = figureOf(place, amount, books, 'fin.line-amount-invalid');
  if (!stated.ok) return stated;
  const overriding = override !== undefined && override !== null;
  if (overriding && stated.value.currency === books.functional.code) {
    return refuseAt(place, 'fin.line-override-on-functional');
  }

  return ok({
    ...structure,
    place,
    currency: structure.figure === 'till' ? stated.value.currency : undefined,
    amount: stated.value,
    // Widened back to the type `FX` takes, unjudged on purpose: `manual.ts` says why.
    override: overriding ? (override as RateOverrideQuote) : undefined,
  });
}

/** The currency a till's figure claims, before the figure is judged — for the place a refusal names. */
function claimedCurrency(till: unknown): CurrencyCode | undefined {
  const { amount } = fieldsOf<OpeningFigure>(till);
  const { currency } = fieldsOf<Money>(amount);
  return typeof currency === 'string' ? currency : undefined;
}

/**
 * The four figures, judged in the order the screen lists them: stock, tills,
 * customers, suppliers — each figure given judged at its place, each left out
 * left out. Nothing at all is refused: an opening with nothing in it opens
 * nothing.
 *
 * A till is named by the currency of its figure, so a currency given twice
 * is one till counted twice, and refused as such rather than summed: a sum
 * would hide a count entered twice, and that is the one mistake an opening
 * balance exists to not make.
 */
export function openingFiguresArriving(
  books: Books,
  given: OpeningGiven,
): Outcome<readonly OpeningFigureShape[]> {
  const { inventory, tills, customerDebts, supplierDebts } = given;
  const figures: OpeningFigureShape[] = [];
  const present = (value: unknown): boolean => value !== undefined && value !== null;
  const take = (
    structure: Structure,
    arriving: unknown,
    currency?: CurrencyCode,
  ): Outcome<void> => {
    const place: Place = {
      line: figures.length + 1,
      figure: structure.figure,
      ...(currency === undefined ? {} : { currency }),
    };
    const shape = figureShape(books, place, structure, arriving);
    if (!shape.ok) return shape;
    figures.push(shape.value);
    return ok(undefined);
  };

  if (present(inventory)) {
    const taken = take(INVENTORY, inventory);
    if (!taken.ok) return taken;
  }
  if (present(tills)) {
    // Not a list of tills at all: refused at the first till's place, as the
    // figure it is not.
    if (!Array.isArray(tills)) {
      return refuseAt({ line: figures.length + 1, figure: 'till' }, 'fin.line-amount-invalid', {
        amount: shown(tills),
      });
    }
    const counted = new Set<CurrencyCode>();
    for (const till of tills as readonly unknown[]) {
      const taken = take(TILL, till, claimedCurrency(till));
      if (!taken.ok) return taken;
      const last = figures.at(-1);
      if (last === undefined) throw new Error('A till was taken and not kept.');
      if (counted.has(last.amount.currency)) {
        return refuseAt(last.place, 'fin.opening-till-repeated');
      }
      counted.add(last.amount.currency);
    }
  }
  if (present(customerDebts)) {
    const taken = take(CUSTOMER_DEBTS, customerDebts);
    if (!taken.ok) return taken;
  }
  if (present(supplierDebts)) {
    const taken = take(SUPPLIER_DEBTS, supplierDebts);
    if (!taken.ok) return taken;
  }
  if (figures.length === 0) return refuse('fin.opening-balances-empty');

  return ok(figures);
}

/** A figure with its account resolved, and its amount still to be valued if it is not in the books' currency. */
export interface PlacedFigure extends OpeningFigureShape {
  readonly found: Account;
}

/** Every figure's account, and the equity account the entry balances against. */
export interface PlacedOpening {
  readonly figures: readonly PlacedFigure[];
  readonly equity: Account;
}

/**
 * Every figure's account, resolved through this module's own role for its
 * purpose — the cash role with the till's currency — exactly as a module's
 * role is resolved, plus the equity account; and the day in an open period as
 * of this reading, for the reason `placeLines` gives.
 *
 * The account's rule about a currency holds by construction: a till's figure
 * is stated in the till's currency, since that is how the till was named. It
 * is applied all the same, because a rule that holds by construction today
 * is one line away from not.
 */
export function placeFigures(
  session: RecordSession,
  tenant: TenantId,
  declared: readonly AccountRoleDeclaration[],
  books: Books,
  day: LocalDate,
  figures: readonly OpeningFigureShape[],
): Outcome<PlacedOpening> {
  const placed: PlacedFigure[] = [];
  for (const figure of figures) {
    const { place } = figure;
    const found = resolveRole(session, tenant, declared, figure.role, figure.currency);
    if (!found.ok) return refuseAt(place, found.error.code, found.error.values);
    const kept = keptOrRefuse(
      place,
      found.value,
      books.functional,
      foreignOf(books, figure.amount),
    );
    if (!kept.ok) return kept;
    placed.push({ ...figure, found: found.value });
  }

  const equity = resolveRole(session, tenant, declared, FIN_ACCOUNT_ROLES.openingBalanceEquity);
  if (!equity.ok) return equity;

  const period = postingPeriodOn(session, tenant, day);
  if (!period.ok) return period;

  return ok({ figures: placed, equity: equity.value });
}

/**
 * The lines of the opening entry: every figure valued, and then the equity
 * line on whichever side balances them — or no equity line at all, for a
 * shop whose stock is exactly what it owes for it.
 *
 * Equity carries the difference and never a figure of its own, so the entry
 * balances by construction: what the shop has, less what it owes, is what it
 * started with.
 */
export function openingLines(
  placed: PlacedOpening,
  valued: readonly Valued[],
  books: Books,
): readonly JudgedLine[] {
  const lines: JudgedLine[] = placed.figures.map((figure, index) => {
    const value = valued[index];
    if (value === undefined) throw new Error(`Figure ${String(index + 1)} was never valued.`);
    return {
      account: figure.found,
      role: figure.role,
      side: figure.side,
      amount: value.amount,
      original: value.stamp === null ? null : figure.amount,
      stamp: value.stamp,
      memo: null,
    };
  });

  const { debits, credits } = sidesOf(lines);
  const excess = debits.minus(credits);
  if (!excess.isZero()) {
    lines.push({
      account: placed.equity,
      role: FIN_ACCOUNT_ROLES.openingBalanceEquity,
      side: excess.greaterThan(0) ? 'credit' : 'debit',
      amount: money(excess.abs(), books.functional.code),
      original: null,
      stamp: null,
      memo: null,
    });
  }
  return lines;
}
