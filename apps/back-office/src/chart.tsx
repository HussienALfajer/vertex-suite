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
import type { AccountNode } from '@vertex/fin/contract';

import type { Delivery } from './organisation.js';
import type { ChartOfRecord, SystemOfRecord } from './system.js';

/**
 * The tenant's chart of accounts (`FIN-01`), loaded once and shared.
 *
 * Read **including the withdrawn ones**, as `currencies.tsx` reads its own
 * list: a withdrawn account is exactly the one somebody comes back to restore,
 * and which of them a screen shows is a question about what is on screen rather
 * than a second read of the store.
 *
 * The **tree** rather than the flat list, because the shape and the order are
 * `FIN`'s own — roots in code order, each subtree in code order — and a screen
 * that rebuilt them from a flat list would be a second copy of the arrangement
 * `FIN-01` already states.
 *
 * Its own provider beside `calendar.tsx` rather than one holding both, and the
 * reason is `run`: every command re-reads what the provider holds, so a shop
 * closing twelve periods at a month end would re-read a chart of three hundred
 * accounts twelve times for a list that cannot have changed.
 */
export interface ChartState {
  /** Every account as a tree, withdrawn ones included. */
  readonly tree: readonly AccountNode[];
  readonly isLoading: boolean;
  readonly unreachable: boolean;
  readonly reload: () => void;
  /**
   * Runs one command and re-reads the chart if it changed anything.
   *
   * Re-reading rather than patching the tree in place, for the reason
   * `OrganisationProvider.run` gives: a command changes more than it names —
   * moving a group moves everything under it — and a screen that edited its
   * own copy would be showing a chart only it believes in.
   */
  readonly run: <T>(
    command: (of: ChartOfRecord) => Promise<Result<T, Refusal>>,
  ) => Promise<Delivery<T>>;
}

const ChartContext = createContext<ChartState | null>(null);

export interface ChartProviderProps {
  readonly system: SystemOfRecord;
  readonly children: ReactNode;
}

const EVERYTHING = { including: 'all' } as const;

export function ChartProvider({ system, children }: ChartProviderProps): ReactNode {
  const of = system.chart;
  const [tree, setTree] = useState<readonly AccountNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Which read is the current one — `organisation.tsx`'s own guard against a
  // slow first answer overwriting a fast second, and against a read still in
  // flight when this unmounts.
  const latest = useRef(0);

  useEffect(() => {
    latest.current += 1;
    const mine = latest.current;

    setIsLoading(true);
    void (async () => {
      try {
        const accounts = await of.tree(EVERYTHING);
        if (mine !== latest.current) return;
        setTree(accounts);
        setUnreachable(false);
      } catch {
        if (mine !== latest.current) return;
        // Left exactly as it was: a transport that hiccuped must never look
        // like a shop whose books have no accounts in them.
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
      command: (port: ChartOfRecord) => Promise<Result<T, Refusal>>,
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

  const value = useMemo<ChartState>(
    () => ({ tree, isLoading, unreachable, reload, run }),
    [tree, isLoading, unreachable, reload, run],
  );

  return <ChartContext.Provider value={value}>{children}</ChartContext.Provider>;
}

export function useChart(): ChartState {
  const value = useContext(ChartContext);
  if (value === null) {
    throw new Error('useChart was called outside a ChartProvider.');
  }
  return value;
}
