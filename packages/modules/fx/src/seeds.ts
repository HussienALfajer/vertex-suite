import { defineCurrency, type Currency, type CurrencyCode } from '@vertex/kernel';

/**
 * The four currencies of `FX-01`, as a tenant finds them on its first morning.
 *
 * A **seed and not a rule**. From the moment they exist they are ordinary rows
 * the owner revises, and nothing in this system branches on which of them came
 * from here. Defined through the kernel, so that a seed which could not be a
 * currency fails when the module loads on the engineer's machine, not when a
 * shop is installed.
 *
 * **Every step settles to the smallest unit the currency issues at all** — the
 * cent, the kuruş, the whole pound — and never to a larger note. That is the one
 * step a seed can choose without choosing for the shop: rounding to a note
 * bigger than the one circulating in its market takes money from every customer
 * or gives it away at every sale, and which note that is is a fact about the
 * shop's market on the day, which the owner states by revising the step.
 *
 * **Every precision is finer than its step**, on purpose. An amount received in one currency
 * is worth a whole number of cents of another only by coincidence; the books
 * (`FX-02`) keep its equivalent to four places, and what four places cannot hold
 * is the rounding residual of `FX-07`. A ledger stored to the cent would drop the
 * rest with nothing to say where it went. Any of these may be made functional,
 * so each is carried the same way.
 *
 * Half-up throughout, which is what a customer expects to read on a receipt.
 */
export const SEEDED_CURRENCIES: readonly Currency[] = Object.freeze([
  // Two places although nothing smaller than a pound is issued: a figure
  // converted into pounds, or restated by a redenomination (`FX-11`), still has
  // somewhere to put its fraction.
  defineCurrency({
    code: 'SYP',
    // policy-exempt: §12 — a currency symbol is data the owner revises (FX-01), not a label
    symbol: 'ل.س',
    decimals: 2,
    roundingIncrement: '1',
    roundingMode: 'half-up',
  }),
  defineCurrency({
    code: 'USD',
    symbol: '$',
    decimals: 4,
    roundingIncrement: '0.01',
    roundingMode: 'half-up',
  }),
  defineCurrency({
    code: 'TRY',
    symbol: '₺',
    decimals: 4,
    roundingIncrement: '0.01',
    roundingMode: 'half-up',
  }),
  defineCurrency({
    code: 'EUR',
    symbol: '€',
    decimals: 4,
    roundingIncrement: '0.01',
    roundingMode: 'half-up',
  }),
]);

/**
 * The functional currency of a tenant that has not chosen one (`FX-02`).
 *
 * The dollar, because it is what the market this product is sold into prices
 * its costs in — and a default only. The tenant's own choice lives in its
 * records, and this is read only when there is none.
 */
export const SEEDED_FUNCTIONAL: CurrencyCode = 'USD';
