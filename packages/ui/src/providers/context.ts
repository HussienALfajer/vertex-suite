import { createContext, useContext } from 'react';

import type { Translator } from '@vertex/i18n';

import { DEFAULT_DENSITY, type Density } from '../tokens/scale.js';

/** How the tenant chose to resolve the theme. `system` leaves it to the device. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/**
 * Which digits are *displayed*.
 *
 * §5.5: Western digits by default, Arabic-Indic as a per-tenant display setting
 * that never affects a stored value or a parse. This lives in the interface
 * layer for exactly that reason — nothing below it ever sees the choice.
 */
export type Numerals = 'latn' | 'arab';

export interface VertexContextValue {
  readonly locale: string;
  readonly numerals: Numerals;
  /** The locale to hand to `Intl`, carrying the numeral choice. */
  readonly formattingLocale: string;
  readonly theme: ThemeChoice;
  readonly translator: Translator;
}

const VertexContext = createContext<VertexContextValue | null>(null);
const DensityContext = createContext<Density>(DEFAULT_DENSITY);

export { VertexContext, DensityContext };

export function useVertex(): VertexContextValue {
  const value = useContext(VertexContext);
  if (value === null) {
    throw new Error('A Vertex component was rendered outside <VertexProvider>.');
  }
  return value;
}

/** The translator, for a component that must not contain a string literal (§12). */
export function useTranslator(): Translator {
  return useVertex().translator;
}

/** The density in force here, which a subtree may have raised. */
export function useDensity(): Density {
  return useContext(DensityContext);
}

/** Builds the `Intl` locale for a numeral choice, e.g. `ar` + `latn` → `ar-u-nu-latn`. */
export function formattingLocaleFor(locale: string, numerals: Numerals): string {
  return `${locale}-u-nu-${numerals}`;
}
