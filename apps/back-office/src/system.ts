import type { Result } from '@vertex/kernel';
import type { Authenticated, SecRefusal } from '@vertex/sec/contract';
import type {
  Branch,
  BusinessProfile,
  Company,
  Listing,
  Location,
  NewBranch,
  NewCompany,
  NewLocation,
  OrganisationRefusal,
  ProfileRevision,
} from '@vertex/sys/contract';

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
 * The types are the modules' own, imported from their contracts and nothing
 * else. That is what keeps this from becoming a second vocabulary: the screen
 * renders the records and the refusal codes the domain actually returns, so a
 * refusal that changes meaning changes here at compile time rather than at a
 * till.
 *
 * `U07` brings the store node and something to talk to it over, and the adapter
 * behind this interface becomes the real one. The screens do not change.
 */

export interface SignInAttempt {
  readonly handle: string;
  readonly password: string;
}

/**
 * Taken from the records rather than from `@vertex/contracts`.
 *
 * The shared vocabulary is there to be imported and importing it would be no
 * breach — but this app holds no identifier of its own. Every one it handles it
 * was given, on a record it already names, and reading the type off that record
 * says so: there is no way for these three to drift from what `SYS` actually
 * returns, and no fourth spelling of `BranchId` anywhere in the application.
 */
type CompanyId = Company['id'];
type BranchId = Branch['id'];
type LocationId = Location['id'];

type Outcome<T> = Promise<Result<T, OrganisationRefusal>>;

/**
 * `SYS-09` and `SYS-05` as a screen uses them.
 *
 * It is `Organisation` and `OrganisationAdministration` with one thing taken
 * out: the `CommandContext`. Who is asking is settled by the transport — a
 * session on one side, an actor and a tenant on the other — and a screen that
 * assembled its own context would be a screen that could claim to be somebody
 * else. Everything that remains is the domain's own vocabulary, unchanged.
 *
 * There are no registers and no numbering series here, and no settings. Both
 * are `SYS`'s and both have screens coming; this port grows the day one is
 * built, rather than declaring methods nothing calls.
 *
 * `deactivate` and `reactivate` stay two commands rather than collapsing into a
 * flag, because that is what the contract offers and they are not symmetrical:
 * coming back can be refused — a name freed while a branch was shut is a name
 * somebody else may have taken — and a boolean would hide which direction was
 * refused.
 */
export interface OrganisationOfRecord {
  readonly companies: {
    list(listing?: Listing): Promise<readonly Company[]>;
    register(input: NewCompany): Outcome<Company>;
    rename(id: CompanyId, name: string): Outcome<Company>;
    deactivate(id: CompanyId): Outcome<Company>;
    reactivate(id: CompanyId): Outcome<Company>;
  };
  readonly branches: {
    list(listing?: Listing): Promise<readonly Branch[]>;
    open(input: NewBranch): Outcome<Branch>;
    rename(id: BranchId, name: string): Outcome<Branch>;
    deactivate(id: BranchId): Outcome<Branch>;
    reactivate(id: BranchId): Outcome<Branch>;
  };
  readonly locations: {
    list(branch: BranchId, listing?: Listing): Promise<readonly Location[]>;
    open(input: NewLocation): Outcome<Location>;
    rename(id: LocationId, name: string): Outcome<Location>;
    deactivate(id: LocationId): Outcome<Location>;
    reactivate(id: LocationId): Outcome<Location>;
  };
  readonly profile: {
    /** Null only for a company this tenant did not register: every one it did has one. */
    read(company: CompanyId): Promise<BusinessProfile | null>;
    revise(company: CompanyId, changes: ProfileRevision): Outcome<BusinessProfile>;
  };
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

  readonly organisation: OrganisationOfRecord;
}
