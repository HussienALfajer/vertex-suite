import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { isOk, type Result } from '@vertex/kernel';
import type { Authenticated, SecRefusal } from '@vertex/sec/contract';

import type { SignInAttempt, SystemOfRecord } from './system.js';

/**
 * Who is signed in, and how they got there.
 *
 * Held in memory and nowhere else, deliberately. `SEC-09` can force a sign-out
 * and `U23` owns sessions and devices; anything this app wrote to storage would
 * be a session nobody upstream can revoke, and it would outlive the tab that
 * created it. Until there is something that can take a session back, closing
 * the window is the only session lifetime this app is entitled to offer.
 */

export interface Session {
  /** What they typed. The person's name is `UserDirectory`'s, and arrives with the screen that reads it. */
  readonly handle: string;
  readonly authenticated: Authenticated;
}

/**
 * Declared as properties holding functions rather than as methods, because a
 * screen destructures this — `const { signIn } = useSession()` — and a method
 * pulled off its object is a method whose `this` is whatever the caller
 * happened to leave behind.
 */
export interface SessionState {
  readonly session: Session | null;
  readonly signIn: (attempt: SignInAttempt) => Promise<Result<Authenticated, SecRefusal>>;
  readonly signOut: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export interface SessionProviderProps {
  readonly system: SystemOfRecord;
  readonly children: ReactNode;
}

export function SessionProvider({ system, children }: SessionProviderProps): ReactNode {
  const [session, setSession] = useState<Session | null>(null);

  const signIn = useCallback(
    async (attempt: SignInAttempt): Promise<Result<Authenticated, SecRefusal>> => {
      const outcome = await system.signIn(attempt);
      if (isOk(outcome)) {
        setSession({ handle: attempt.handle, authenticated: outcome.value });
      }
      return outcome;
    },
    [system],
  );

  const signOut = useCallback((): void => {
    setSession(null);
  }, []);

  const value = useMemo<SessionState>(
    () => ({ session, signIn, signOut }),
    [session, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession was called outside a SessionProvider.');
  }
  return value;
}
