import { Dec, isDecimalString, ok, refuse, type Decimal, type Result } from '@vertex/kernel';

import {
  QUOTE_FORMS,
  RATE_DECIMALS,
  type QuoteForm,
  type RateQuote,
  type RateRefusal,
  type RateSide,
} from './contract.js';

/**
 * A rate as somebody typed it, turned into the one form every rate is read in
 * (`FX-04`): units of the currency per one unit of the functional currency.
 *
 * This is the only place that turn is made, and it is made **once**, when the
 * rate is recorded. The canonical figures are stored and never recomputed, so
 * the store node and a register reading the same revision can never disagree
 * about a rate by the last place of a division one of them redid.
 */

/** A rate, ready to be recorded: its canonical figures and what was typed. */
export interface SettledQuote {
  readonly buy: string;
  readonly sell: string;
  readonly quoted: RateQuote;
}

type Side = RateSide;

/** A quote's fields as they may actually arrive: typed by a person, or read off a wire. */
type Arriving = { readonly [Field in keyof RateQuote]: unknown };

const FORMS: ReadonlySet<string> = new Set(QUOTE_FORMS);

/**
 * Exported for the one caller outside this module that also has to judge a
 * form before it is known to be one: a screen reading a `Select`'s own
 * returned key. Kept to this one function rather than reimplemented there,
 * so a third form added to `QUOTE_FORMS` is recognised everywhere at once.
 */
export function isQuoteForm(value: unknown): value is QuoteForm {
  return typeof value === 'string' && FORMS.has(value);
}

/**
 * One side of a quote, in canonical form.
 *
 * Refused rather than rounded when typed finer than `RATE_DECIMALS`: somebody
 * who typed thirteen places meant every one, and a rate quietly different from
 * the one on the board is the mistake this module exists to stop.
 *
 * Inverting rounds to the nearest twelfth place, half to even. A rate is not an
 * amount anybody hands over, so there is no direction a shop would expect it to
 * lean, and half-even is the one rule that leans no way.
 */
function settledSide(form: QuoteForm, side: Side, typed: unknown): Result<Decimal, RateRefusal> {
  if (typeof typed !== 'string' || !isDecimalString(typed)) {
    return refuse('fx.rate-invalid', { side, rate: String(typed) });
  }
  const figure = new Dec(typed);
  if (!figure.greaterThan(0)) return refuse('fx.rate-invalid', { side, rate: typed });
  if (figure.decimalPlaces() > RATE_DECIMALS) {
    return refuse('fx.rate-too-precise', { side, rate: typed, decimals: RATE_DECIMALS });
  }

  const perFunctional = form === 'units-per-functional' ? figure : new Dec(1).dividedBy(figure);
  const canonical = perFunctional.toDecimalPlaces(RATE_DECIMALS, Dec.ROUND_HALF_EVEN);
  // A functional unit worth so many of this currency that its inverse is less
  // than the last place a rate is carried to: the rate would be stored as zero,
  // and every amount converted at it would be nothing.
  if (canonical.isZero()) return refuse('fx.rate-invalid', { side, rate: typed });
  return ok(canonical);
}

/** One rate as it will be recorded: the canonical figure, and the form it was typed in. */
export interface SettledRate {
  readonly canonical: Decimal;
  readonly form: QuoteForm;
}

/**
 * One rate, in canonical form: the single figure an override of `FX-06`
 * replaces a side of the board with.
 *
 * The same function the pair goes through, exported rather than reimplemented —
 * an override judged by a second copy of these rules is an override that comes
 * to accept a figure a board would be refused for, and the two would drift
 * apart in the one place nobody reads twice.
 *
 * It hands the form back, narrowed. The caller has to store what was typed
 * beside what was computed, as a recorded rate does, and reading the form off
 * the input a second time would be reading a field nothing had judged.
 */
export function settleRate(
  form: unknown,
  side: Side,
  typed: unknown,
): Result<SettledRate, RateRefusal> {
  if (!isQuoteForm(form)) return refuse('fx.rate-form-unknown', { form: String(form) });
  const settled = settledSide(form, side, typed);
  if (!settled.ok) return settled;
  return ok({ canonical: settled.value, form });
}

/**
 * A quote as it will be recorded, or the refusal that stops it.
 *
 * The spread is judged on the canonical figures, after any inversion, because
 * that is the only form in which "receiving at no less than paying out" has one
 * meaning for a currency typed either way.
 */
export function settleQuote(quote: RateQuote): Result<SettledQuote, RateRefusal> {
  const { form, buy, sell } = quote as Arriving;
  if (!isQuoteForm(form)) return refuse('fx.rate-form-unknown', { form: String(form) });

  const receiving = settledSide(form, 'buy', buy);
  if (!receiving.ok) return receiving;
  const payingOut = settledSide(form, 'sell', sell);
  if (!payingOut.ok) return payingOut;

  const canonical = { buy: receiving.value.toFixed(), sell: payingOut.value.toFixed() };
  if (receiving.value.lessThan(payingOut.value)) {
    return refuse('fx.rate-spread-inverted', canonical);
  }

  // Rebuilt field by field rather than kept as it arrived, so that nothing the
  // caller attached to the quote is stored beside it.
  return ok({ ...canonical, quoted: { form, buy: String(buy), sell: String(sell) } });
}
