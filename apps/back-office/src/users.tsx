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
import type { Role, User } from '@vertex/sec/contract';

import type { Delivery } from './organisation.js';
import type { DeclaredRight, SystemOfRecord, UsersOfRecord } from './system.js';

/**
 * The people of this tenant, loaded once and shared by the users screen.
 *
 * `organisation.tsx`'s counterpart for `SEC` rather than `SYS` — same shape,
 * because it is the same problem: a command can change more than it names, so
 * a screen that patched its own copy would be showing a shop that only it
 * believes in. `Delivery` is shared rather than repeated, because a refusal —
 * `SYS`'s or `SEC`'s — is rendered on screen exactly the same way, by its code.
 */

export interface UsersState {
  /** Every user, withdrawn ones included: `SEC-09` deactivates and never deletes. */
  readonly users: readonly User[];
  /** `SEC-01`'s roles, seven seeded ones among them. */
  readonly roles: readonly Role[];
  /** Every right this edition's modules declare, for the grid (`SEC-02`). */
  readonly rights: readonly DeclaredRight[];
  readonly isLoading: boolean;
  readonly unreachable: boolean;
  readonly reload: () => void;
  readonly run: <T>(
    command: (of: UsersOfRecord) => Promise<Result<T, Refusal>>,
  ) => Promise<Delivery<T>>;
  /** The port itself, for reads that are one user's own — `assignments.of`. */
  readonly ofRecord: UsersOfRecord;
}

const UsersContext = createContext<UsersState | null>(null);

export interface UsersProviderProps {
  readonly system: SystemOfRecord;
  readonly children: ReactNode;
}

const EVERYTHING = { including: 'all' } as const;

export function UsersProvider({ system, children }: UsersProviderProps): ReactNode {
  const of = system.users;
  const [users, setUsers] = useState<readonly User[]>([]);
  const [roles, setRoles] = useState<readonly Role[]>([]);
  const [rights, setRights] = useState<readonly DeclaredRight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [generation, setGeneration] = useState(0);

  /** Which read is the current one — see `organisation.tsx` for why this matters twice over. */
  const latest = useRef(0);

  useEffect(() => {
    latest.current += 1;
    const mine = latest.current;

    setIsLoading(true);
    void (async () => {
      try {
        const [allUsers, allRoles, declaredRights] = await Promise.all([
          of.list(EVERYTHING),
          of.roles.list(EVERYTHING),
          of.roles.rights(),
        ]);

        if (mine !== latest.current) return;
        setUsers(allUsers);
        setRoles(allRoles);
        setRights(declaredRights);
        setUnreachable(false);
      } catch {
        if (mine !== latest.current) return;
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
      command: (port: UsersOfRecord) => Promise<Result<T, Refusal>>,
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

  const value = useMemo<UsersState>(
    () => ({ users, roles, rights, isLoading, unreachable, reload, run, ofRecord: of }),
    [users, roles, rights, isLoading, unreachable, reload, run, of],
  );

  return <UsersContext.Provider value={value}>{children}</UsersContext.Provider>;
}

export function useUsers(): UsersState {
  const value = useContext(UsersContext);
  if (value === null) {
    throw new Error('useUsers was called outside a UsersProvider.');
  }
  return value;
}
