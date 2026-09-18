import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { isOk, type Refusal, type Result } from '@vertex/kernel';

import type { Delivery } from './organisation.js';
import type { RatesOfRecord, SystemOfRecord } from './system.js';

/**
 * `FX-04`'s port, reached the way every screen here reaches its own: through a
 * context rather than a prop, since `Shell.tsx`'s `Screen` switch hands a
 * screen nothing but its name.
 *
 * Thinner than `currencies.tsx` on purpose. There is no tenant-wide list to
 * load once and share — a branch's board is read for one branch at a time,
 * and no second screen reads it yet — so this holds nothing of its own and
 * only turns a command into a `Delivery`, exactly as `organisation.tsx`'s own
 * `run` does. The board itself is `Rates.tsx`'s own `useLoaded`, the same way
 * `Locations.tsx` owns the read of its own branch-scoped list rather than a
 * shared provider owning it.
 */
export interface RatesState {
  readonly ofRecord: RatesOfRecord;
  readonly run: <T>(
    command: (of: RatesOfRecord) => Promise<Result<T, Refusal>>,
  ) => Promise<Delivery<T>>;
}

const RatesContext = createContext<RatesState | null>(null);

export interface RatesProviderProps {
  readonly system: SystemOfRecord;
  readonly children: ReactNode;
}

export function RatesProvider({ system, children }: RatesProviderProps): ReactNode {
  const of = system.rates;

  const run = useCallback(
    async <T,>(
      command: (port: RatesOfRecord) => Promise<Result<T, Refusal>>,
    ): Promise<Delivery<T>> => {
      try {
        const outcome = await command(of);
        if (!isOk(outcome)) return { kind: 'refused', refusal: outcome.error };
        return { kind: 'done', value: outcome.value };
      } catch {
        return { kind: 'unreachable' };
      }
    },
    [of],
  );

  const value = useMemo<RatesState>(() => ({ ofRecord: of, run }), [of, run]);

  return <RatesContext.Provider value={value}>{children}</RatesContext.Provider>;
}

export function useRates(): RatesState {
  const value = useContext(RatesContext);
  if (value === null) {
    throw new Error('useRates was called outside a RatesProvider.');
  }
  return value;
}
