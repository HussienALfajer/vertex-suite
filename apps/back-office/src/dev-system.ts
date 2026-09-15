import { newId, ok, orThrow, refuse, systemClock, type Clock, type Id } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  defineModule,
  provideContract,
  type Authoriser,
  type CommandContext,
  type MemorySession,
} from '@vertex/platform';
import { Authorisation } from '@vertex/sec/contract';
import { Organisation, OrganisationAdministration, sysModule } from '@vertex/sys';

import type { OrganisationOfRecord, SignInAttempt, SystemOfRecord } from './system.js';

/**
 * A development stand-in for the store node.
 *
 * It answers the port two different ways, and the difference between them is
 * the difference between the two modules behind it.
 *
 * **`SEC` is stood in for, because `SEC` cannot run here at all** — see
 * `system.ts`. It hashes passwords with scrypt from Node's standard library,
 * which is exactly the property that makes a stolen database useless and
 * exactly the property no browser has. So what is reproduced below is not the
 * authority but the one thing the sign-in screen is written against: the
 * refusals `SEC` actually returns. `composition.test.ts` pins those codes on the
 * real module, in Node, where it can run; if `SEC` ever answered differently,
 * that test fails rather than this stand-in quietly teaching the screen a lie.
 *
 * **`SYS` is not stood in for. It is the real one, hosted here.** Nothing in it
 * needs a machine: it is an ordinary module over the memory store the platform
 * ships, and it runs in a browser exactly as it runs on a store node. Writing a
 * fake organisation would have meant writing a second implementation of every
 * rule the screens are built on — that two branches in one company may not
 * share a name, that a location cannot be opened in a branch that is shut, that
 * nothing is ever deleted — and a screen developed against a second
 * implementation is a screen developed against a guess. The composition here is
 * the real edition composition, the real registry and the real transactor, for
 * the same reason `edition.fixture.ts` is.
 *
 * All of it goes when `U07` brings the store node and a transport. The screens
 * do not change: they never named anything in this file.
 */

export interface StandInPerson {
  readonly handle: string;
  readonly password: string;
  /** Withdrawn from this shop, and still able to prove who they are (`SEC-09`). */
  readonly active?: boolean;
}

export interface StandInOptions {
  readonly people: readonly StandInPerson[];
  readonly clock?: Clock;
}

/**
 * Everything, to everybody, because there is nobody here to ask.
 *
 * The real answer is `SEC`'s and `SEC` is not in this browser, so this is the
 * one thing in the file that is a fiction rather than a stand-in — and it is a
 * fiction that can only ever be too permissive, which is the safe direction for
 * a development harness and the unusable direction for a shop. The rights
 * themselves are enforced where they are enforced: `SYS` asks on every command,
 * and `composition.test.ts` runs the real `SEC` against the real `SYS` to prove
 * that a cashier is refused what a cashier does not hold.
 */
const ALWAYS: Authoriser = { may: () => Promise.resolve(true) };

function authorityStandIn() {
  return defineModule<MemorySession>({
    code: 'SEC',
    labelKey: 'module.sec',
    // The key the real `SEC` publishes, so the registry is wired here exactly as
    // a store node wires it — and so swapping the real module in is a change of
    // catalogue and nothing else.
    provides: [provideContract(Authorisation, () => ALWAYS)],
  });
}

export function developmentSystem(options: StandInOptions): SystemOfRecord {
  const clock = options.clock ?? systemClock;
  const tenant = newId<'tenant'>();
  const identifiers = new Map(options.people.map((one) => [one.handle, newId<'user'>()] as const));

  const catalogue = [sysModule<MemorySession>(), authorityStandIn()];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC'] }),
    (refusal) => new Error(`The edition would not compose: ${refusal.code}`),
  );

  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw new Error(`A subscriber failed: ${String(failure.cause)}`);
    },
  });
  const store = createMemoryStore();
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock,
    onEffectFailure: (failure) => {
      throw new Error(`An effect failed: ${String(failure.cause)}`);
    },
  });
  const registry = createRegistry({
    catalogue,
    plan,
    bus,
    transactor,
    clock,
    authorisedBy: Authorisation,
  });

  const read = registry.require(Organisation);
  const admin = registry.require(OrganisationAdministration);

  /**
   * Who is asking, which is the transport's business and not a screen's.
   *
   * Set when somebody signs in, exactly as a session on the other side of a
   * real transport would set it. Reading it before then is not a refusal and
   * not something to render — it is a screen that was mounted without a
   * session, which is a defect, so it throws.
   */
  let actor: Id<'user'> | null = null;
  const asWhoeverSignedIn = (): CommandContext => {
    if (actor === null) {
      throw new Error('The organisation was read before anybody signed in.');
    }
    return commandContext({ tenant, actor });
  };

  const by = asWhoeverSignedIn;

  const organisation: OrganisationOfRecord = {
    companies: {
      list: (listing) => read.companies(by(), listing),
      register: (input) => admin.companies.register(by(), input),
      rename: (id, name) => admin.companies.rename(by(), id, name),
      deactivate: (id) => admin.companies.deactivate(by(), id),
      reactivate: (id) => admin.companies.reactivate(by(), id),
    },
    branches: {
      list: (listing) => read.branches(by(), listing),
      open: (input) => admin.branches.open(by(), input),
      rename: (id, name) => admin.branches.rename(by(), id, name),
      deactivate: (id) => admin.branches.deactivate(by(), id),
      reactivate: (id) => admin.branches.reactivate(by(), id),
    },
    locations: {
      list: (branch, listing) => read.locations(by(), branch, listing),
      open: (input) => admin.locations.open(by(), input),
      rename: (id, name) => admin.locations.rename(by(), id, name),
      deactivate: (id) => admin.locations.deactivate(by(), id),
      reactivate: (id) => admin.locations.reactivate(by(), id),
    },
    profile: {
      read: (company) => read.profile(by(), company),
      revise: (company, changes) => admin.profile.revise(by(), company, changes),
    },
  };

  const fold = (raw: string): string => raw.normalize('NFC').trim().toLowerCase();

  return {
    signIn({ handle, password }: SignInAttempt) {
      const wanted = fold(handle);
      const person = options.people.find((one) => fold(one.handle) === wanted);

      // One refusal for an unknown name and for a wrong password, which is
      // `SEC`'s own rule: answering differently for a name that does not exist
      // is a list of everybody who does, readable by anybody who can reach a
      // till. The stand-in has to keep the rule or the screen is never tested
      // against it.
      if (person?.password !== password) {
        return Promise.resolve(refuse('sec.password-wrong'));
      }

      const id = identifiers.get(person.handle);
      if (id === undefined) return Promise.resolve(refuse('sec.password-wrong'));

      // Only somebody who has the password learns that the account is
      // withdrawn — refusing earlier would tell whoever is guessing which names
      // are real.
      if (person.active === false) {
        return Promise.resolve(refuse('sec.user-inactive', { user: id }));
      }

      actor = id;
      return Promise.resolve(ok({ user: id, tenant, at: clock.now() }));
    },

    organisation,
  };
}
