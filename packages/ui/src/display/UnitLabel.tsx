import type { ReactNode } from 'react';

import { useTranslator } from '../providers/context.js';

export interface UnitLabelProps {
  /** The unit's code, e.g. `KG`. Never its label — labels are not written in code. */
  readonly code: string;
  readonly className?: string;
}

/**
 * The name of a unit, as this tenant calls it.
 *
 * Resolves through the terminology layer, so a tenant that renames a concept
 * (`SYS-08`) sees the renaming everywhere at once rather than in the screens
 * someone remembered to change.
 */
export function UnitLabel({ code, className }: UnitLabelProps): ReactNode {
  const translator = useTranslator();
  const key = `unit.${code}`;
  const label = translator.has(key) ? translator.format(key) : translator.term(code);
  return (
    <span className={className} {...(label === code ? { dir: 'ltr' as const } : {})}>
      {label}
    </span>
  );
}
