import type { ReactNode } from 'react';

import { DENSITIES, type Density as DensityValue } from '../tokens/scale.js';
import { DensityContext, useDensity } from './context.js';

export interface DensityScopeProps {
  readonly value: DensityValue;
  readonly children: ReactNode;
  readonly className?: string;
}

const rank = (density: DensityValue): number => DENSITIES.indexOf(density);

/**
 * Whether this is a development build.
 *
 * `process` does not exist in a browser, and a bundler only replaces the dotted
 * `process.env.NODE_ENV` — a bracketed lookup survives to run time and throws a
 * `ReferenceError`. This library runs in a browser, in Electron's main process
 * and under a test runner, so the global is probed rather than assumed.
 *
 * This was a real crash: on a touch surface — the register — a nested compact
 * table took this branch and brought the whole tree down.
 */
function isDevelopment(): boolean {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env?.['NODE_ENV'] !== 'production';
}

/**
 * Raises the density of a subtree — a dense table inside a comfortable form.
 *
 * Named `DensityScope` rather than `Density` because `Density` is the value it
 * carries, and a component and its own value type sharing a name is how an
 * import becomes ambiguous at the first re-export.
 *
 * §6.1 allows a subtree to raise density but **never to lower it below `touch`
 * on a touch surface**, because that produces a target a finger cannot hit.
 * That rule is enforced here rather than trusted: a `compact` table asked for
 * inside the register stays `touch`, and says so in development.
 */
export function DensityScope({ value, children, className }: DensityScopeProps): ReactNode {
  const ambient = useDensity();
  const lowersBelowTouch = ambient === 'touch' && value !== 'touch';
  const effective = lowersBelowTouch ? ambient : value;

  if (lowersBelowTouch && isDevelopment()) {
    globalThis.console.warn(
      `[@vertex/ui] Density "${value}" was requested inside a touch surface and ignored. ` +
        'On a touch surface nothing interactive may fall below 48px (§6.1, §6.3).',
    );
  }

  return (
    <DensityContext.Provider value={effective}>
      <div data-density={effective} className={className}>
        {children}
      </div>
    </DensityContext.Provider>
  );
}

/** True when `candidate` is at least as large as `floor`. */
export function densityAtLeast(candidate: DensityValue, floor: DensityValue): boolean {
  return rank(candidate) >= rank(floor);
}
