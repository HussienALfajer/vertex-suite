import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { useTranslator, useVertex } from '../providers/context.js';
import { DateTime } from './DateTime.js';
import { formatExact } from './format.js';

export interface CurrencyRateProps {
  /** Units of `currency` per **one** unit of the functional currency (`FX-04`). */
  readonly rate: string;
  readonly currency: string;
  readonly functionalCurrency: string;
  /** The rate's own date. A rate is meaningless without the day it belonged to. */
  readonly asOf: Date;
  readonly timeZone: string;
  /**
   * False when this is not today's rate — a register trading on its last synced
   * rate must show that on every currency-sensitive screen (`FX-04`).
   */
  readonly isCurrent?: boolean;
  /** Decimal places to display. Rates are carried far finer than money. */
  readonly decimals?: number;
  readonly className?: string;
}

/**
 * An exchange rate, in the direction the market quotes it and the ledger stores
 * it: **units of the currency per one unit of the functional currency**.
 *
 * Both halves are named. A bare number beside a currency code is the single
 * most reliable way to get a rate inverted, and an inverted rate is a priced
 * basket that is wrong by the square of the error.
 */
export function CurrencyRate({
  rate,
  currency,
  functionalCurrency,
  asOf,
  timeZone,
  isCurrent = true,
  decimals = 2,
  className,
}: CurrencyRateProps): ReactNode {
  const { formattingLocale } = useVertex();
  const translator = useTranslator();
  const { text, isRounded } = formatExact(rate, decimals, formattingLocale);
  // The one of "per one" is a figure like any other, and was once a literal
  // that stayed Western while the rate beside it was written in Arabic-Indic.
  const one = formatExact('1', 0, formattingLocale).text;

  return (
    <span
      className={clsx('inline-flex items-baseline gap-[0.4em] tabular-nums', className)}
      // §12, as `Money` has it: a rate displayed at less precision than it is
      // carried — which rates always are — is marked, and its full value is kept.
      {...(isRounded ? { title: `${rate} ${currency} / 1 ${functionalCurrency}` } : {})}
    >
      <span dir="ltr">
        {text}
        {isRounded ? (
          <span aria-hidden="true" className="text-fg-muted">
            {' ≈'}
          </span>
        ) : null}{' '}
        {currency} / {one} {functionalCurrency}
      </span>
      <DateTime value={asOf} timeZone={timeZone} precision="date" className="text-fg-muted" />
      {isCurrent ? null : (
        <span className="rounded bg-tint-warning text-on-tint-warning px-[0.5em] text-caption">
          {translator.format('rate.notToday')}
        </span>
      )}
    </span>
  );
}
