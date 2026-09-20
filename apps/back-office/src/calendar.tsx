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
import type { FiscalYear, PeriodReopening } from '@vertex/fin/contract';

import type { Delivery } from './organisation.js';
import type { CalendarOfRecord, SystemOfRecord } from './system.js';

/**
 * The tenant's fiscal calendar (`FIN-05`), loaded once and shared.
 *
 * The years and the reopenings are read **together**, the way
 * `OrganisationProvider` reads companies and branches: the calendar screen
 * shows both at once — a period says it is open, and the log beside it says it
 * was opened again and why — and two reads settling separately is a screen
 * that shows one of them describing a state the other has already left.
 *
 * It stays small by construction. `TenantCalendar` is one record per tenant
 * (`FIN-05`), and a shop trading for a decade has ten years and a hundred and
 * twenty periods in it.
 */
export interface CalendarState {
  readonly years: readonly FiscalYear[];
  /** Every reopening the books have had, oldest first. */
  readonly reopenings: readonly PeriodReopening[];
  readonly isLoading: boolean;
  readonly unreachable: boolean;
  readonly reload: () => void;
  readonly run: <T>(
    command: (of: CalendarOfRecord) => Promise<Result<T, Refusal>>,
  ) => Promise<Delivery<T>>;
}

const CalendarContext = createContext<CalendarState | null>(null);

export interface CalendarProviderProps {
  readonly system: SystemOfRecord;
  readonly children: ReactNode;
}

export function CalendarProvider({ system, children }: CalendarProviderProps): ReactNode {
  const of = system.calendar;
  const [years, setYears] = useState<readonly FiscalYear[]>([]);
  const [reopenings, setReopenings] = useState<readonly PeriodReopening[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [generation, setGeneration] = useState(0);

  const latest = useRef(0);

  useEffect(() => {
    latest.current += 1;
    const mine = latest.current;

    setIsLoading(true);
    void (async () => {
      try {
        const [kept, opened] = await Promise.all([of.years(), of.reopenings()]);
        if (mine !== latest.current) return;
        setYears(kept);
        setReopenings(opened);
        setUnreachable(false);
      } catch {
        if (mine !== latest.current) return;
        // Left exactly as they were: a transport that hiccuped must never look
        // like a shop keeping no books at all.
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
      command: (port: CalendarOfRecord) => Promise<Result<T, Refusal>>,
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

  const value = useMemo<CalendarState>(
    () => ({ years, reopenings, isLoading, unreachable, reload, run }),
    [years, reopenings, isLoading, unreachable, reload, run],
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarState {
  const value = useContext(CalendarContext);
  if (value === null) {
    throw new Error('useCalendar was called outside a CalendarProvider.');
  }
  return value;
}
