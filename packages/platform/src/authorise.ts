import type { BranchId, LocationId } from '@vertex/contracts';

import type { CommandContext } from './context.js';

/**
 * The seam every module asks a permission question through.
 *
 * `SEC` answers it, and the platform has never heard of `SEC`. That is not
 * ceremony — it is the only arrangement `modules.md` §3 and §4 permit. `SEC`
 * depends on `SYS`, so `SYS` cannot import `SEC` to ask whether the person
 * opening a branch may open one; and a module below the modules may not name
 * one at all. So the question is asked through a shape the platform declares,
 * and the **host** — which composes the edition and is the one thing allowed to
 * name modules — says which contract answers it.
 *
 * Before this existed, `SYS` declared a full matrix of rights and enforced none
 * of them: every organisation command ran for whoever called it, while `SEC`
 * guarded its own. The asymmetry was recorded in `SYS`'s contract as something
 * to be fixed "on the way in, once there is something to ask" — and once `SEC`
 * shipped there was. An invariant that every future app has to remember is one
 * that some app eventually forgets, so it is wired once, here, and fails closed.
 */

/**
 * Where an action is being taken, for `SEC-04`'s branch- and location-scoped
 * rights.
 *
 * Absent means the tenant-wide place: an action with no branch at all, like
 * revising the company's own profile. It is deliberately *not* read as
 * "anywhere" — that reading is how somebody who runs one shop comes to edit the
 * tax number printed on every receipt in the group.
 */
export type AuthorisationScope = Place | Anywhere;

interface Place {
  readonly branch?: BranchId;
  readonly location?: LocationId;
  readonly anywhere?: never;
}

interface Anywhere {
  readonly anywhere: true;
  readonly branch?: never;
  readonly location?: never;
}

/**
 * Wherever the caller holds the right — for **reading records that are the
 * same in every branch**, and for nothing else.
 *
 * A catalogue item is one record across the whole shop group: the manager of
 * Damascus and the owner read the same name, the same units, the same codes.
 * Asking such a read at the tenant-wide place refused everybody confined to a
 * branch, so a Damascus manager could not see the item whose Damascus price
 * they were approving. Asking it at "a branch" would protect nothing — any
 * branch the caller names answers with the identical record — and would make
 * every caller invent one.
 *
 * Said out loud, as a value, rather than read into an absent branch: the absent
 * branch keeps its meaning (the tenant-wide place, only unconfined grants), so
 * a command that forgets its scope still fails closed. **A write never asks
 * this.** Changing a record every branch shares is an act at the tenant-wide
 * place, whoever is only reading it.
 */
export const ANYWHERE: AuthorisationScope = Object.freeze({ anywhere: true });

/**
 * Whatever this edition uses to answer "may they".
 *
 * Structural on purpose: `SEC`'s own `Authorisation` contract satisfies it
 * without `SEC` importing the platform's name for it or the platform importing
 * `SEC`'s.
 */
export interface Authoriser {
  may(by: CommandContext, right: string, where?: AuthorisationScope): Promise<boolean>;
}
