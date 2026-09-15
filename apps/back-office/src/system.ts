import type { Result } from '@vertex/kernel';
import type { Authenticated, SecRefusal } from '@vertex/sec/contract';

/**
 * What the back office needs from the system of record.
 *
 * The modules are not in here. `modules.md` §2 puts the store node and the back
 * office in different applications, and `SEC` in particular could not be in
 * here even if the map allowed it: it hashes with scrypt from Node's standard
 * library, which is exactly the property that makes a stolen database useless
 * and exactly the property no browser has. So this is a **port** — the app
 * states what it needs, and something on the other side of a process boundary
 * answers.
 *
 * The types are `SEC`'s own, imported from its contract and nothing else. That
 * is what keeps this from becoming a second vocabulary: the screen renders the
 * refusal codes the domain actually returns, so a refusal that changes meaning
 * changes here at compile time rather than at a till.
 *
 * `U07` brings the store node and something to talk to it over, and the adapter
 * behind this interface becomes the real one. The screen does not change.
 */

export interface SignInAttempt {
  readonly handle: string;
  readonly password: string;
}

export interface SystemOfRecord {
  /**
   * A password verified against a sign-in, and nothing more.
   *
   * Not a session: `U23` owns those, and a token issued by something that does
   * not yet know how to revoke one is a token nobody can take back. What this
   * answers is the question underneath a session — is this the password, and
   * may this person still work in this shop.
   */
  signIn(attempt: SignInAttempt): Promise<Result<Authenticated, SecRefusal>>;
}
