/**
 * Exact formatting for the display contracts of §12.
 *
 * The rule that shapes this file: a figure is never converted to a JavaScript
 * float on its way to the screen. `Intl.NumberFormat` accepts a decimal string
 * and formats it exactly, and that is the only path used here — passing
 * `Number(…)` would reintroduce, at the last possible moment, exactly the error
 * the kernel exists to prevent.
 */

export interface FormattedFigure {
  /** The figure as the locale writes it. */
  readonly text: string;
  /** True when the stored value carried more precision than was displayed. */
  readonly isRounded: boolean;
}

/** `Intl.NumberFormat` has accepted string input since ES2023; the lib types lag. */
interface StringFormatter {
  format: (value: string) => string;
}

export function formatExact(
  decimalString: string,
  decimals: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): FormattedFigure {
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...options,
  }) as unknown as StringFormatter;

  return {
    text: formatter.format(decimalString),
    isRounded: decimalPlacesOf(decimalString) > decimals,
  };
}

/** The decimal places actually present in an exact decimal string. */
export function decimalPlacesOf(decimalString: string): number {
  const dot = decimalString.indexOf('.');
  if (dot === -1) return 0;
  return decimalString.length - dot - 1;
}
