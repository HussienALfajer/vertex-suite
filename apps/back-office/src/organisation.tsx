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
import { useTranslator } from '@vertex/ui';
import type { Branch, Company } from '@vertex/sys/contract';

import { messageForRefusal } from './catalogue.js';
import type { OrganisationOfRecord, SystemOfRecord } from './system.js';

/**
 * The shop's own structure, loaded once and shared by every screen that draws it.
 *
 * Companies and branches are here rather than in the screens because three of
 * the four screens need both: the branches screen names the company each branch
 * belongs to, the locations screen picks a branch, and the business profile
 * picks a company. Four screens each loading the same two lists is four moments
 * where they can disagree about what the shop looks like.
 *
 * Locations are **not** here, and the asymmetry is the contract's rather than a
 * preference: `Organisation.locations` is asked per branch, because a tenant
 * with forty branches has hundreds of locations and no screen shows them all at
 * once. The screen that picks a branch is the screen that reads its locations.
 */

/**
 * What came back from the store node.
 *
 * Three outcomes, named, because they call for three different things on screen
 * and collapsing any two loses one of them. A **refusal** is the domain's
 * ordinary answer and has a sentence of its own. **Unreachable** is a defect —
 * no route to the store node, a transport that failed — and what it must not do
 * is look like a refusal, because a refusal means the shop said no and this
 * means nobody was asked.
 *
 * `switch-exhaustiveness-check` is on, so a fourth outcome would stop every
 * screen from compiling rather than falling quietly through to a default.
 *
 * The refusal is the kernel's own rather than `SYS`'s organisation refusal,
 * because two of `SYS`'s vocabularies now travel this path — `SYS-02` refuses
 * a numbering format in terms of its own — and what happens to a refusal here
 * is the same for both: it becomes a sentence through its code. Each command
 * keeps its own narrow type where it is declared, which is where a screen can
 * still be held to handling only the codes that command can actually return.
 */
export type Delivery<T> =
  | { readonly kind: 'done'; readonly value: T }
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | { readonly kind: 'unreachable' };

export interface OrganisationState {
  /** Every company, withdrawn ones included: `SYS-09` deactivates and never deletes. */
  readonly companies: readonly Company[];
  readonly branches: readonly Branch[];
  /** The tenant's own name for itself, from `SYS-05`. Null until it has arrived. */
  readonly businessName: string | null;
  readonly isLoading: boolean;
  /** The structure on screen may be stale, because the last read did not answer. */
  readonly unreachable: boolean;
  readonly reload: () => void;
  /**
   * Runs one command and re-reads the structure if it changed anything.
   *
   * Re-reading rather than patching the lists in place: a command can change
   * more than it names — reactivating a branch can be refused over a name that
   * was taken while it was shut — and a screen that edited its own copy would
   * be showing a shop that only it believes in.
   */
  readonly run: <T>(
    command: (of: OrganisationOfRecord) => Promise<Result<T, Refusal>>,
  ) => Promise<Delivery<T>>;
  /**
   * The port itself, for the two screens that read something of their own.
   *
   * Reads only, by convention that the type cannot express: writes go through
   * `run`, which is what keeps the shared structure from going stale behind a
   * screen that changed something.
   */
  readonly ofRecord: OrganisationOfRecord;
}

const OrganisationContext = createContext<OrganisationState | null>(null);

export interface OrganisationProviderProps {
  readonly system: SystemOfRecord;
  readonly children: ReactNode;
}

const EVERYTHING = { including: 'all' } as const;

export function OrganisationProvider({ system, children }: OrganisationProviderProps): ReactNode {
  const of = system.organisation;
  const [companies, setCompanies] = useState<readonly Company[]>([]);
  const [branches, setBranches] = useState<readonly Branch[]>([]);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [generation, setGeneration] = useState(0);

  /**
   * Which read is the current one.
   *
   * Two jobs in one counter. A slow first answer must not overwrite a fast
   * second — without this, reloading twice in quick succession settles on
   * whichever request happened to be slower. And the cleanup raises it too, so
   * a read still in flight when this unmounts is abandoned by the same test
   * rather than by a second flag beside it.
   */
  const latest = useRef(0);

  useEffect(() => {
    latest.current += 1;
    const mine = latest.current;

    setIsLoading(true);
    void (async () => {
      try {
        const [allCompanies, allBranches] = await Promise.all([
          of.companies.list(EVERYTHING),
          of.branches.list(EVERYTHING),
        ]);

        // The shop's own name is the **profile's**, not the company record's:
        // `SYS-05` is what a receipt prints, and a tenant that revised it is a
        // tenant that expects to see the revision.
        const first = allCompanies.find((one) => one.active) ?? allCompanies[0] ?? null;
        const profile = first === null ? null : await of.profile.read(first.id);

        if (mine !== latest.current) return;
        setCompanies(allCompanies);
        setBranches(allBranches);
        setBusinessName(profile?.name ?? first?.name ?? null);
        setUnreachable(false);
      } catch {
        if (mine !== latest.current) return;
        // The lists are left exactly as they were. Blanking them would turn a
        // transport that hiccuped into a shop that looks empty, which is the
        // one thing an administrator must never be shown by accident.
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
      command: (port: OrganisationOfRecord) => Promise<Result<T, Refusal>>,
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

  const value = useMemo<OrganisationState>(
    () => ({
      companies,
      branches,
      businessName,
      isLoading,
      unreachable,
      reload,
      run,
      ofRecord: of,
    }),
    [companies, branches, businessName, isLoading, unreachable, reload, run, of],
  );

  return <OrganisationContext.Provider value={value}>{children}</OrganisationContext.Provider>;
}

export function useOrganisation(): OrganisationState {
  const value = useContext(OrganisationContext);
  if (value === null) {
    throw new Error('useOrganisation was called outside an OrganisationProvider.');
  }
  return value;
}

export interface Loaded<T> {
  readonly value: T | null;
  readonly isLoading: boolean;
  readonly unreachable: boolean;
  readonly reload: () => void;
}

/**
 * One read, tied to the thing it is a read of.
 *
 * `subject` is what the read is about — the branch whose locations, the company
 * whose profile — and changing it starts a new one. It is one identifier rather
 * than a dependency array because that is what it actually is, and it keeps its
 * own type on the way through: a caller that passes a `BranchId` is handed a
 * `BranchId` back, so nothing here has to be cast into the shape the contract
 * asks for.
 *
 * A read that is overtaken is discarded rather than applied, and **what is held
 * is held with the subject it answers for**. Both matter and they are different
 * failures: without the first, switching branches twice quickly settles on
 * whichever answer was slower; without the second, the moment between choosing
 * a branch and its answer arriving shows the previous branch's locations under
 * the new branch's name — briefly over a memory store, and for as long as the
 * request takes once `U07` puts a transport underneath.
 */
export function useLoaded<Subject extends string, T>(
  subject: Subject | null,
  read: (subject: Subject) => Promise<T>,
): Loaded<T> {
  const [held, setHeld] = useState<{ subject: Subject; data: T } | null>(null);
  const [isLoading, setIsLoading] = useState(subject !== null);
  const [unreachable, setUnreachable] = useState(false);
  const [generation, setGeneration] = useState(0);
  const latest = useRef(0);

  // Held in a ref so that a caller who writes the read inline — which is every
  // caller — does not restart it on each render just by existing.
  const current = useRef(read);
  current.current = read;

  useEffect(() => {
    if (subject === null) {
      setHeld(null);
      setIsLoading(false);
      setUnreachable(false);
      return undefined;
    }

    latest.current += 1;
    const mine = latest.current;
    setIsLoading(true);

    void (async () => {
      try {
        const answer = await current.current(subject);
        if (mine !== latest.current) return;
        setHeld({ subject, data: answer });
        setUnreachable(false);
      } catch {
        if (mine !== latest.current) return;
        setHeld(null);
        setUnreachable(true);
      } finally {
        if (mine === latest.current) setIsLoading(false);
      }
    })();

    // Raising the counter is what abandons the read in flight, here for the
    // same reason as above: one test for "somebody else owns this now",
    // whether that somebody is a newer read or nobody at all.
    return () => {
      latest.current += 1;
    };
  }, [subject, generation]);

  const reload = useCallback((): void => {
    setGeneration((was) => was + 1);
  }, []);

  // The answer is handed out only for the subject it is an answer to, so a
  // caller never renders one record's contents under another record's name.
  const value = held !== null && held.subject === subject ? held.data : null;
  return { value, isLoading, unreachable, reload };
}

/**
 * What to say about a delivery, or nothing when it succeeded.
 *
 * The unreachable case borrows `refusal.unknown` deliberately: to the person
 * looking at the screen the two are the same event — the thing they asked for
 * did not happen and they may try again — and a sentence about transports would
 * be this application explaining its own plumbing to a shopkeeper.
 */
export function useDeliveryMessage(): (delivery: Delivery<unknown>) => string | null {
  const translator = useTranslator();
  return useCallback(
    (delivery: Delivery<unknown>): string | null => {
      switch (delivery.kind) {
        case 'done':
          return null;
        case 'refused':
          return messageForRefusal(translator, delivery.refusal);
        case 'unreachable':
          return translator.format('refusal.unknown');
      }
    },
    [translator],
  );
}
