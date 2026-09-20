import type { TenantId } from '@vertex/contracts';
import {
  Dec,
  money,
  ok,
  refuse,
  round,
  toDecimalString,
  type CurrencyCode,
  type Decimal,
  type Money,
  type Result,
} from '@vertex/kernel';

import {
  RATE_DECIMALS,
  ROUNDING_ACCOUNT,
  type BranchDay,
  type CurrencyRefusal,
  type DocumentValue,
  type Presented,
  type PresentedAll,
  type PresentationRate,
  type RateInForce,
  type RateRefusal,
  type RateStamp,
  type RecordSession,
  type RoundingPoint,
  type RoundingResidual,
  type Settled,
  type StampedDocument,
  type TenantCurrency,
} from './contract.js';
import { currencyIn, functionalIn } from './currencies.js';
import { rateInForce } from './rates.js';
import { ownedBy } from './stamps.js';

/**
 * The two points a figure is rounded at, and the one place a figure is shown in
 * another currency: `FX-07` and `FX-03`.
 *
 * **Every call to the kernel's `round` in this system is in this file or beside
 * it.** `round` takes a currency's rules as its second argument, and those rules
 * are one tenant's data — the step the owner revised, the direction, the
 * precision the books are kept to. Nowhere else has them, so nowhere else can
 * supply that argument without inventing it; `check:boundaries` refuses the
 * import for that reason, and this is what it refuses it in favour of.
 */

type Rounded<T> = Result<T, RateRefusal>;

/** A residual on its way to the one account `FX-07` sends every residual to. */
function residual(amount: Money, point: RoundingPoint): RoundingResidual {
  return Object.freeze({ account: ROUNDING_ACCOUNT, point, amount });
}

/**
 * Settles an amount onto the step its own currency is handed over in.
 *
 * The first of `FX-07`'s two points. What comes back is a figure a till can
 * count out, and the difference it moved by — which is money the shop either
 * did not take or did not give, and which belongs in an account rather than on
 * the floor.
 */
export function settleAmount(
  session: RecordSession,
  tenant: TenantId,
  amount: Money,
): Result<Settled, CurrencyRefusal> {
  const currency = currencyIn(session, tenant, amount.currency);
  // Not filtered by whether the shop still takes it: an amount already recorded
  // in a currency withdrawn from use is still settled in that currency's own
  // terms, for the reason `Currencies.currency` is not filtered either.
  if (currency === null) {
    return refuse('fx.currency-not-found', { currency: amount.currency });
  }
  const settled = round(amount, currency);
  return ok({ value: settled.value, residual: residual(settled.residual, 'settlement') });
}

/**
 * An amount in one currency, stated in the functional currency at a rate.
 *
 * The rate is units of the currency per one unit of the functional currency —
 * the one direction every rate in this module is kept in — so this divides, and
 * the other direction multiplies. Rounded to the precision the functional
 * currency is **stored** at, which `FX-02` keeps finer than the cent precisely
 * so that this division has somewhere to land.
 *
 * By the currency's own declared mode, not by a mode chosen here: `FX-01` makes
 * that mode data the owner revises, and a second opinion about it living inside
 * this module is the drift that having one list exists to prevent.
 */
function intoFunctional(amount: Decimal, rate: string, functional: TenantCurrency): Decimal {
  return toPlaces(amount.dividedBy(new Dec(rate)), functional);
}

function fromFunctional(amount: Decimal, rate: string, currency: TenantCurrency): Decimal {
  return toPlaces(amount.times(new Dec(rate)), currency);
}

/**
 * Moves a figure onto the last place its currency is **stored** at, rather than
 * onto the note it is handed over in.
 *
 * Through `round` with the precision standing in as the step, which looks
 * indirect and is the only way to do it once: the mapping from a declared
 * rounding mode onto the decimal library's own constant lives inside the kernel
 * and is not exported, so rounding by any other call would mean a second copy of
 * that mapping here — and a currency declared `half-even` leaning `half-up` in
 * one of the two places is exactly the kind of disagreement nobody finds.
 *
 * The currency's own direction is kept, because how a currency leans is the
 * owner's statement about that currency (`FX-01`) and not this file's to choose.
 */
function toPlaces(value: Decimal, currency: TenantCurrency): Decimal {
  const place = new Dec(1).dividedBy(new Dec(10).toPower(currency.decimals)).toFixed();
  return round(money(value, currency.code), { ...currency, roundingIncrement: place }).value.amount;
}

/**
 * States a document in the books at the rate it was stamped with.
 *
 * The second of `FX-07`'s two points, and the one that produces a **balancing
 * figure**. Each line is converted on its own, because each line is its own
 * entry; the total is converted from the document's own total, because that is
 * the figure the document is for. The two need not agree to the last place the
 * books keep, and the difference is the residual — computed as a difference and
 * never rounded into existence on its own.
 *
 * Refused rather than balanced when the lines do not come to the total in the
 * document's own currency. A difference that is not rounding, posted into a
 * rounding account, is a caller's arithmetic buried in the one place nobody
 * would think to look for it.
 *
 * Nothing here settles the document first. That is the other point, it happens
 * at the till, and an invoice total of 13,127 pounds is a perfectly good total
 * in a shop whose smallest note is ten.
 */
export function valueDocument(
  session: RecordSession,
  tenant: TenantId,
  document: StampedDocument,
): Rounded<DocumentValue> {
  const { stamp, total, lines } = document;
  ownedBy(stamp, tenant);

  const mismatched = [total, ...lines].find((amount) => amount.currency !== stamp.currency);
  if (mismatched !== undefined) {
    return refuse('fx.stamp-currency-mismatch', {
      stamp: stamp.currency,
      amount: mismatched.currency,
    });
  }

  const summed = lines.reduce((running, line) => running.plus(line.amount), new Dec(0));
  if (!summed.equals(total.amount)) {
    return refuse('fx.lines-do-not-total', {
      total: toDecimalString(total),
      lines: summed.toFixed(),
      currency: stamp.currency,
    });
  }

  // The stamp's own functional currency, not the tenant's current one. The two
  // are the same today — `makeFunctional` locks once a rate exists — and taking
  // it from the stamp is what keeps this correct if they ever stop being: the
  // rate is expressed per one unit of what the stamp names, so every figure here
  // is in those terms and says so.
  const functional = currencyIn(session, tenant, stamp.functional);
  if (functional === null) {
    return refuse('fx.currency-not-found', { currency: stamp.functional });
  }

  const valuedTotal = intoFunctional(total.amount, stamp.rate, functional);
  const valuedLines = lines.map((line) => intoFunctional(line.amount, stamp.rate, functional));
  const sumOfLines = valuedLines.reduce((running, line) => running.plus(line), new Dec(0));

  return ok({
    total: money(valuedTotal, functional.code),
    lines: Object.freeze(valuedLines.map((line) => money(line, functional.code))),
    residual: residual(money(valuedTotal.minus(sumOfLines), functional.code), 'ledger'),
  });
}

/**
 * The exact middle of a day's two rates (`FX-03`).
 *
 * A figure on a screen is neither being received nor paid out, so neither side
 * of the board is what it is worth: presenting a report at the buy rate would
 * show a margin the shop has not made, and at the sell rate one it has not lost.
 * The middle is the only figure that claims neither.
 *
 * Carried to the same twelve places every rate is, and halved half to even —
 * a mid is not an amount anybody hands over, so there is no direction a shop
 * would expect it to lean.
 */
function midOf(inForce: RateInForce): string {
  const { revision } = inForce;
  return new Dec(revision.buy)
    .plus(new Dec(revision.sell))
    .dividedBy(2)
    .toDecimalPlaces(RATE_DECIMALS, Dec.ROUND_HALF_EVEN)
    .toFixed();
}

/** What a presentation converts between, once both ends are known to be the tenant's. */
interface Pair {
  readonly from: TenantCurrency;
  readonly into: TenantCurrency;
  readonly functional: TenantCurrency;
}

/**
 * Both ends of a presentation, and the functional currency they must involve.
 *
 * `into` is refused when the shop does not take it: a screen offers the
 * currencies in use, and one that is not is one nobody asked to read a figure
 * in. `from` is **not** filtered that way, because a figure already recorded in
 * a currency the shop has stopped taking still has to be readable.
 */
function pairFor(
  session: RecordSession,
  tenant: TenantId,
  from: CurrencyCode,
  into: CurrencyCode,
): Rounded<Pair> {
  const functional = functionalIn(session, tenant);
  if (functional === null) return refuse('fx.functional-currency-unset');

  const target = currencyIn(session, tenant, into);
  if (target === null) return refuse('fx.currency-not-found', { currency: into });
  if (!target.enabled) return refuse('fx.currency-disabled', { currency: into });

  const source = currencyIn(session, tenant, from);
  if (source === null) return refuse('fx.currency-not-found', { currency: from });

  if (from !== functional.code && into !== functional.code) {
    return refuse('fx.cross-rate-unsupported', { from, into, functional: functional.code });
  }
  return ok({ from: source, into: target, functional });
}

/** A figure already in the currency it is being read in: converted by nothing. */
function asItStands(amount: Money, into: TenantCurrency): Money {
  return money(toPlaces(amount.amount, into), into.code);
}

/** Which of the pair is not the functional currency: the one a rate exists for. */
function tradedOf(pair: Pair): TenantCurrency {
  return pair.from.code === pair.functional.code ? pair.into : pair.from;
}

/**
 * Applies a rate to a figure, in whichever direction the pair runs.
 *
 * One function for both directions because it is one decision: a rate is units
 * of the traded currency per one unit of the functional currency, so going into
 * the functional currency divides and coming out of it multiplies. Written
 * twice, the two would eventually disagree about which way round a rate reads.
 */
function convert(amount: Money, pair: Pair, rate: string): Money {
  const intoFunctionalCurrency = pair.into.code === pair.functional.code;
  const converted = intoFunctionalCurrency
    ? intoFunctional(amount.amount, rate, pair.functional)
    : fromFunctional(amount.amount, rate, pair.into);
  return money(converted, pair.into.code);
}

/**
 * A rate read once, and the pair of currencies it runs between: everything a
 * figure needs to be shown in another currency, worked out before the first
 * figure is.
 *
 * Separated from the showing because a page of figures is shown at **one**
 * rate (`Presentation.presentAll`): the board is read once here, and every
 * figure on the page then goes through the same `translated`. `at` is null for
 * a figure already in the currency asked for, which is the one case where
 * there is no rate to read and none to show.
 */
interface Translation {
  readonly pair: Pair;
  readonly at: string | null;
  readonly rate: PresentationRate | null;
}

/**
 * The translation from one currency into another at today's mid in this
 * branch (`FX-03`).
 *
 * The rate is read here rather than handed in, because which currency the rate
 * is *for* is not known until the pair is resolved: one end of it is the
 * functional currency, which has no rate, and the other is whichever end is
 * left. A caller working that out for itself would be a second copy of a rule
 * this file already has to state.
 *
 * `rateInForce` is what trading reads, unchanged — so a branch with no rate for
 * today refuses a figure on a screen exactly as it refuses a sale, and a
 * register under `FX-04`'s exception shows the rate's own day here as it must
 * on every currency-sensitive screen.
 */
function midFrom(
  session: RecordSession,
  tenant: TenantId,
  here: BranchDay,
  from: CurrencyCode,
  into: CurrencyCode,
): Rounded<Translation> {
  const pair = pairFor(session, tenant, from, into);
  if (!pair.ok) return pair;
  if (from === into) return ok({ pair: pair.value, at: null, rate: null });

  const traded = tradedOf(pair.value);
  const inForce = rateInForce(session, tenant, here.branch, here.day, traded.code, here.device);
  if (!inForce.ok) return inForce;

  const rate = midOf(inForce.value);
  return ok({
    pair: pair.value,
    at: rate,
    rate: Object.freeze({
      currency: traded.code,
      functional: pair.value.functional.code,
      rate,
      basis: 'mid' as const,
      // A mid came from both sides, so it came from neither.
      side: null,
      day: inForce.value.revision.day,
      revision: inForce.value.revision.id,
      lastKnown: inForce.value.lastKnown?.id ?? null,
    }),
  });
}

/** One figure through a translation already resolved. */
function translated(amount: Money, translation: Translation): Money {
  const { pair, at } = translation;
  return at === null ? asItStands(amount, pair.into) : convert(amount, pair, at);
}

/** A figure shown at today's mid rate in this branch (`FX-03`). */
export function presentAtMid(
  session: RecordSession,
  tenant: TenantId,
  here: BranchDay,
  amount: Money,
  into: CurrencyCode,
): Rounded<Presented> {
  const translation = midFrom(session, tenant, here, amount.currency, into);
  if (!translation.ok) return translation;
  return ok({
    amount: translated(amount, translation.value),
    rate: translation.value.rate,
  });
}

/**
 * A page of figures shown at today's mid rate in this branch, read once
 * (`Presentation.presentAll`).
 *
 * The currency of the page is the first figure's, and every other figure is
 * held to it: a page translated at one rate is a page in one unit, and a
 * figure in another would be converted at a rate that is not its own and then
 * printed beside the rest as though it were. It raises for the reason a stamp
 * of another tenant does — whoever assembled the page holds every figure on
 * it, so this is a defect there and not a fact about the shop.
 *
 * An empty page reads no board at all. There is nothing to convert, so there
 * is no rate to state, and refusing a branch that has not entered today's
 * rates for a page with no figures on it would be a refusal about nothing.
 */
export function presentAllAtMid(
  session: RecordSession,
  tenant: TenantId,
  here: BranchDay,
  amounts: readonly Money[],
  into: CurrencyCode,
): Rounded<PresentedAll> {
  const first = amounts[0];
  if (first === undefined) return ok({ amounts: Object.freeze([]), rate: null });

  for (const amount of amounts) {
    if (amount.currency !== first.currency) {
      throw new Error(
        `A page of figures to show at one rate holds both ${first.currency} and ` +
          `${amount.currency}. One rate converts one currency.`,
      );
    }
  }

  const translation = midFrom(session, tenant, here, first.currency, into);
  if (!translation.ok) return translation;
  return ok({
    amounts: Object.freeze(amounts.map((amount) => translated(amount, translation.value))),
    rate: translation.value.rate,
  });
}

/** A document's figure shown at the document's own rate, whatever today's is. */
export function presentAtStamp(
  session: RecordSession,
  tenant: TenantId,
  amount: Money,
  into: CurrencyCode,
  stamp: RateStamp,
): Rounded<Presented> {
  ownedBy(stamp, tenant);

  const pair = pairFor(session, tenant, amount.currency, into);
  if (!pair.ok) return pair;
  if (amount.currency === into)
    return ok({ amount: asItStands(amount, pair.value.into), rate: null });

  if (tradedOf(pair.value).code !== stamp.currency) {
    return refuse('fx.stamp-currency-mismatch', {
      stamp: stamp.currency,
      amount: tradedOf(pair.value).code,
    });
  }
  // Both ends of the conversion are now the stamp's own: the currency its rate
  // is *of*, checked above, and the currency its rate is *per*, checked here.
  // Without this the arithmetic would run through the tenant's functional
  // currency while the rate shown beside it named the stamp's, and a figure
  // whose units disagree with its own label is worse than one that refuses.
  if (pair.value.functional.code !== stamp.functional) {
    return refuse('fx.stamp-functional-mismatch', {
      stamp: stamp.functional,
      functional: pair.value.functional.code,
    });
  }

  return ok({
    amount: convert(amount, pair.value, stamp.rate),
    rate: Object.freeze({
      currency: stamp.currency,
      functional: stamp.functional,
      rate: stamp.rate,
      basis: 'stamped' as const,
      side: stamp.side,
      day: stamp.rateDay,
      revision: stamp.revision,
      lastKnown: stamp.lastKnown,
    }),
  });
}
