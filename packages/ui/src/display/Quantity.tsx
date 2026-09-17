import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { quantityToDecimalString, type Quantity as QuantityValue, type Unit } from '@vertex/kernel';

import { useVertex } from '../providers/context.js';
import { UnitLabel } from './UnitLabel.js';
import { formatExact } from './format.js';

export interface QuantityProps {
  readonly value: QuantityValue;
  /** Required: precision and kind are properties of the unit, not of the number. */
  readonly unit: Unit;
  readonly className?: string;
}

/**
 * A quantity, with its unit, always.
 *
 * The rule that earns this component its existence is §12's: **a weight is
 * never shown as an integer count.** Four hundred grams of tomatoes rendered as
 * "0" is not a rounding error, it is a different claim about what is in the
 * basket — so the unit's stored precision is honoured rather than trimmed to
 * whatever looks tidy.
 */
export function Quantity({ value, unit, className }: QuantityProps): ReactNode {
  const { formattingLocale } = useVertex();

  if (value.unit !== unit.code) {
    throw new Error(
      `A quantity in ${value.unit} was given the unit ${unit.code}. ` +
        'A quantity is never rendered against a unit it is not expressed in.',
    );
  }

  const stored = quantityToDecimalString(value);
  const { text, isRounded } = formatExact(stored, unit.decimals, formattingLocale);

  return (
    <span
      className={clsx(
        'inline-flex items-baseline gap-[0.3em] tabular-nums whitespace-nowrap',
        className,
      )}
      {...(isRounded ? { title: `${stored} ${unit.code}` } : {})}
    >
      <span dir="ltr">{text}</span>
      {/* §12: a figure shown at less precision than stored carries a marker as
          well as its full value in `title` — hover alone is not a marker. */}
      {isRounded ? (
        <span aria-hidden="true" className="text-fg-muted">
          ≈
        </span>
      ) : null}
      <UnitLabel code={unit.code} className="text-fg-secondary" />
    </span>
  );
}
