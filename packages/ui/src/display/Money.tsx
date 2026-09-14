import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { toDecimalString, type Currency, type Money as MoneyValue } from '@vertex/kernel';

import { useVertex } from '../providers/context.js';
import { formatExact } from './format.js';

export interface MoneyProps {
  readonly value: MoneyValue;
  /** Required: the amount's precision and symbol are properties of its currency. */
  readonly currency: Currency;
  /** Also show the currency's symbol. The ISO code is never omitted. */
  readonly showSymbol?: boolean;
  readonly className?: string;
}

/**
 * An amount, with its currency, always.
 *
 * §12 makes four demands of this component, and each is a thing that goes wrong
 * in retail software:
 *
 * - **The currency is always shown, as its ISO code.** A bare symbol is how a
 *   figure in one currency gets read as another, and this product trades in
 *   four at one till.
 * - **The stored precision is never exceeded.** Where a value carries more
 *   precision than its currency settles to, the figure is marked and its full
 *   value is available — a rounded display must never be mistaken for the
 *   stored one.
 * - **Tabular numerals**, so a column of figures aligns on the decimal.
 * - **A negative carries a sign *and* the danger colour**, never colour alone:
 *   a colour-blind cashier reads the sign, and everyone reads both.
 */
export function Money({ value, currency, showSymbol = false, className }: MoneyProps): ReactNode {
  const { formattingLocale } = useVertex();

  const stored = toDecimalString(value);
  const { text, isRounded } = formatExact(stored, currency.decimals, formattingLocale);
  const negative = value.amount.isNegative() && !value.amount.isZero();

  return (
    <span
      className={clsx(
        'inline-flex items-baseline gap-[0.25em] tabular-nums whitespace-nowrap',
        negative && 'text-fg-danger',
        className,
      )}
      dir="ltr"
      {...(isRounded ? { title: `${stored} ${currency.code}` } : {})}
    >
      <span>{text}</span>
      {isRounded ? (
        <span aria-hidden="true" className="text-fg-muted">
          ≈
        </span>
      ) : null}
      {showSymbol ? <span className="text-fg-secondary">{currency.symbol}</span> : null}
      <span className="text-fg-secondary">{currency.code}</span>
    </span>
  );
}
