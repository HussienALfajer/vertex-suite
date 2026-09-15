import { newId, ok, refuse, systemClock, type Clock } from '@vertex/kernel';

import type { SignInAttempt, SystemOfRecord } from './system.js';

/**
 * A development stand-in for the store node.
 *
 * **It is not `SEC` and does not pretend to be.** `SEC` cannot run here at all —
 * see `system.ts` — so what this reproduces is not the authority but the one
 * thing the screen is written against: the refusals `SEC` actually returns, so
 * that the screen is exercised against real codes rather than invented ones.
 * `composition.test.ts` pins those codes on the real module, in Node, where it
 * can run; if `SEC` ever answered differently, that test fails rather than this
 * stand-in quietly teaching the screen a lie.
 *
 * It holds no hashes, because a hash it could check in a browser would be a
 * hash worth nothing, and pretending otherwise is how a stand-in ends up in a
 * shop. It goes when `U07` brings the store node and a transport.
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

export function developmentSystem(options: StandInOptions): SystemOfRecord {
  const clock = options.clock ?? systemClock;
  const tenant = newId<'tenant'>();
  const identifiers = new Map(options.people.map((one) => [one.handle, newId<'user'>()] as const));

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

      return Promise.resolve(ok({ user: id, tenant, at: clock.now() }));
    },
  };
}
