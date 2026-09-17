import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { isOk, type Refusal, type Result } from '@vertex/kernel';
import type { TenantCurrency } from '@vertex/fx/contract';

import type { Delivery } from './organisation.js';
import type { CurrenciesOfRecord, SystemOfRecord } from './system.js';

/**
 * The tenant's own currencies, loaded once and shared by every screen that
 * draws them — one screen today, and `FX-04`'s daily rate board next, which
 * reads the same list to know which currencies it is quoting.
 *
 * `Delivery` and the loading/unreachable shape are `organisation.tsx`'s own,
 * reused rather than restated: a second copy of "done, refused or
 * unreachable" is exactly the drift `CLAUDE.md` asks every screen to avoid.
 */
export interface CurrenciesState {
  readonly currencies: readonly TenantCurrency[];
  /** `FX-02`. Null until `FX-01`'s seeding has run, which `dev-system.ts` does before this ever reads empty. */
  readonly functional: TenantCurrency | null;
  readonly isLoading: boolean;
  readonly unreachable: boolean;
  readonly reload: () => void;
  /**
   * Runs one command and re-reads the list if it changed anything.
   *
   * Re-reading rather than patching the list in place, for the same reason
   * `OrganisationProvider.run` does: a command can refuse for a reason this
   * screen's own copy would not have known to check.
   */
  readonly run: <T>(
    command: (of: CurrenciesOfRecord) => Promise<Result<T, Refusal>>,
  ) => Promise<Delivery<T>>;
}

const CurrenciesContext = createContext<CurrenciesState | null>(null);

export interface CurrenciesProviderProps {
  readonly system: SystemOfRecord;
  readonly children: ReactNode;
}

export function CurrenciesProvider({ system, children }: CurrenciesProviderProps): ReactNode {
  const of = system.currencies;
  const [currencies, setCurrencies] = useState<readonly TenantCurrency[]>([]);
  const [functional, setFunctional] = useState<TenantCurrency | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Which read is the current one — `organisation.tsx`'s own guard against a
  // slow first answer overwriting a fast second.
  const latest = useRef(0);

  useEffect(() => {
    latest.current += 1;
    const mine = latest.current;

    setIsLoading(true);
    void (async () => {
      try {
        const [all, kept] = await Promise.all([of.list({ including: 'all' }), of.functional()]);
        if (mine !== latest.current) return;
        setCurrencies(all);
        setFunctional(kept);
        setUnreachable(false);
      } catch {
        if (mine !== latest.current) return;
        // Left exactly as they were, for the reason `organisation.tsx` gives:
        // a transport that hiccuped must never look like a shop with no
        // currencies at all.
        setUnreachable(true);
      } finally {
        if (mine === latest.current) setIsLoading(false);
      }
    })();

    return () => {
      latest.current += 1;
    };
  }, [of, generation]);

  const reload = useCallback((): void => {
    setGeneration((was) => was + 1);
  }, []);

  const run = useCallback(
    async <T,>(
      command: (port: CurrenciesOfRecord) => Promise<Result<T, Refusal>>,
    ): Promise<Delivery<T>> => {
      try {
        const outcome = await command(of);
        if (!isOk(outcome)) return { kind: 'refused', refusal: outcome.error };
        reload();
        return { kind: 'done', value: outcome.value };
      } catch {
        return { kind: 'unreachable' };
      }
    },
    [of, reload],
  );

  const value = useMemo<CurrenciesState>(
    () => ({ currencies, functional, isLoading, unreachable, reload, run }),
    [currencies, functional, isLoading, unreachable, reload, run],
  );

  return <CurrenciesContext.Provider value={value}>{children}</CurrenciesContext.Provider>;
}

export function useCurrencies(): CurrenciesState {
  const value = useContext(CurrenciesContext);
  if (value === null) {
    throw new Error('useCurrencies was called outside a CurrenciesProvider.');
  }
  return value;
}
