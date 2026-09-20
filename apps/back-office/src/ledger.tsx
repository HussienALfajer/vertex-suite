import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { isOk, type Refusal, type Result } from '@vertex/kernel';

import type { Delivery } from './organisation.js';
import type {
  JournalOfRecord,
  PostingExceptionsOfRecord,
  StatementsOfRecord,
  SystemOfRecord,
} from './system.js';

/**
 * The books, reached the way every screen here reaches its own port: through a
 * context, since `Shell.tsx`'s `Screen` switch hands a screen nothing but its
 * name.
 *
 * **One provider for three ports, and it holds nothing.** `chart.tsx` and
 * `calendar.tsx` are separate because each holds a list and `run` re-reads what
 * its own provider holds — a month end of twelve closings must not re-read a
 * chart of three hundred accounts twelve times. Nothing here is held at all:
 * the journal is read for a span and a branch, the queue for what is still
 * waiting, and a statement is computed from the entries every time it is asked
 * for (`FIN-07`: a figure kept beside the ledger is a figure free to disagree
 * with it). So there is no list to go stale, no re-read to make cheaper, and
 * nothing for a second provider to keep apart. Each screen owns the read it is
 * a screen of, through `useLoaded`, exactly as `Locations.tsx` and `Rates.tsx`
 * own theirs.
 *
 * `run` takes the whole command rather than a function of one port, because the
 * three ports refuse in two vocabularies and a screen calls whichever it is a
 * screen of — the bookkeeping around a command is the same either way, and it
 * is the only thing this provider does.
 */
export interface LedgerState {
  readonly journal: JournalOfRecord;
  readonly exceptions: PostingExceptionsOfRecord;
  readonly statements: StatementsOfRecord;
  /**
   * Runs one command and says what came back — refused, unreachable, or done.
   *
   * It re-reads nothing, unlike `chart.tsx`'s and `calendar.tsx`'s: what a
   * posting changes is what the screen is looking at and what every screen
   * beside it would compute from the same entries, so a screen reloads its own
   * read where it knows what it was reading.
   */
  readonly run: <T>(command: () => Promise<Result<T, Refusal>>) => Promise<Delivery<T>>;
}

const LedgerContext = createContext<LedgerState | null>(null);

export interface LedgerProviderProps {
  readonly system: SystemOfRecord;
  readonly children: ReactNode;
}

export function LedgerProvider({ system, children }: LedgerProviderProps): ReactNode {
  const journal = system.journal;
  const exceptions = system.postingExceptions;
  const statements = system.statements;

  const run = useCallback(
    async <T,>(command: () => Promise<Result<T, Refusal>>): Promise<Delivery<T>> => {
      try {
        const outcome = await command();
        return isOk(outcome)
          ? { kind: 'done', value: outcome.value }
          : { kind: 'refused', refusal: outcome.error };
      } catch {
        return { kind: 'unreachable' };
      }
    },
    [],
  );

  const value = useMemo<LedgerState>(
    () => ({ journal, exceptions, statements, run }),
    [journal, exceptions, statements, run],
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerState {
  const value = useContext(LedgerContext);
  if (value === null) {
    throw new Error('useLedger was called outside a LedgerProvider.');
  }
  return value;
}
