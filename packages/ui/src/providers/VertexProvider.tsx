import { useEffect, useMemo, type ReactNode } from 'react';
import { I18nProvider } from 'react-aria-components';

import { directionOf, type Translator } from '@vertex/i18n';

import { DEFAULT_DENSITY, type Density } from '../tokens/scale.js';
import {
  DensityContext,
  VertexContext,
  formattingLocaleFor,
  type Numerals,
  type ThemeChoice,
  type VertexContextValue,
} from './context.js';

export interface VertexProviderProps {
  /**
   * The interface locale. Direction follows from it rather than being a
   * separate flag — `ar` is right-to-left because it is Arabic, not because
   * something was switched on (§9).
   */
  readonly locale?: string;
  readonly theme?: ThemeChoice;
  readonly density?: Density;
  readonly numerals?: Numerals;
  /** Set from `prefers-reduced-motion` and from the tenant setting (§3.2). */
  readonly reduceMotion?: boolean;
  readonly translator: Translator;
  /** The document element to stamp. Overridable so tests need no real document. */
  readonly root?: HTMLElement | null;
  readonly children: ReactNode;
}

/**
 * The application root.
 *
 * It does three things and no more: derives direction from the locale, stamps
 * the three switching axes of §3.2 onto the document element, and supplies the
 * translator every display component resolves its labels through.
 */
export function VertexProvider({
  locale = 'ar',
  theme = 'system',
  density = DEFAULT_DENSITY,
  numerals = 'latn',
  reduceMotion = false,
  translator,
  root,
  children,
}: VertexProviderProps): ReactNode {
  const value = useMemo<VertexContextValue>(
    () => ({
      locale,
      numerals,
      formattingLocale: formattingLocaleFor(locale, numerals),
      theme,
      translator,
    }),
    [locale, numerals, theme, translator],
  );

  useEffect(() => {
    const element = root ?? globalThis.document.documentElement;

    // `system` sets nothing: §3.2 makes the absence of the attribute the signal
    // to follow the device, so an explicit value is the only override.
    if (theme === 'system') {
      element.removeAttribute('data-theme');
    } else {
      element.setAttribute('data-theme', theme);
    }

    element.setAttribute('data-density', density);

    if (reduceMotion) {
      element.setAttribute('data-reduce-motion', 'true');
    } else {
      element.removeAttribute('data-reduce-motion');
    }

    // `SYS-01`: direction is a consequence of the locale, not a setting beside
    // it. The document served to the browser already carries `dir` so that the
    // first paint is not backwards, but from here on this owns it — otherwise
    // an interface switched to English would keep the direction of the HTML it
    // happened to be served with, which is exactly the retrofit the feature
    // says this is not.
    element.setAttribute('lang', locale);
    element.setAttribute('dir', directionOf(locale));
  }, [root, theme, density, reduceMotion, locale]);

  return (
    <I18nProvider locale={locale}>
      <VertexContext.Provider value={value}>
        <DensityContext.Provider value={density}>{children}</DensityContext.Provider>
      </VertexContext.Provider>
    </I18nProvider>
  );
}
