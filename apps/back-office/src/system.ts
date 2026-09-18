import type { Result } from '@vertex/kernel';
import type {
  CurrencyRefusal,
  CurrencyRevision,
  Listing as CurrencyListing,
  NewCurrency,
  RateBoard,
  RateQuote,
  RateRefusal,
  RateRevision,
  SuggestedRate,
  TenantCurrency,
} from '@vertex/fx/contract';
import type {
  Assignment,
  Authenticated,
  NewAssignment,
  NewRole,
  NewUser,
  Role,
  SecRefusal,
  User,
} from '@vertex/sec/contract';
import type {
  Branch,
  BusinessProfile,
  Company,
  GeoPoint,
  Listing,
  Location,
  NewBranch,
  NewCompany,
  NewLocation,
  NewRegister,
  NumberingRefusal,
  NumberingSeries,
  NumberingSpecimen,
  OrganisationRefusal,
  ProfileRevision,
  Register,
  SeriesScope,
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
type RegisterId = Register['id'];
type UserId = User['id'];
type RoleId = Role['id'];
type PermissionId = Role['rights'][number];
type CurrencyCode = TenantCurrency['code'];

type Outcome<T> = Promise<Result<T, OrganisationRefusal>>;
/**
 * Numbering refuses in its own vocabulary, and the two are kept apart.
 *
 * A format that drops the device generation and a branch name already in use
 * are not the same kind of event and do not become one by sharing a type: the
 * screens render a refusal by its code, and a union of every code in the module
 * would let a screen claim to handle one it has never heard of.
 */
type Numbered<T> = Promise<Result<T, NumberingRefusal>>;
/** `SEC` refuses in its own vocabulary too, and for the same reason. */
type Secured<T> = Promise<Result<T, SecRefusal>>;

/**
 * `SYS-09` and `SYS-05` as a screen uses them.
 *
 * It is `Organisation` and `OrganisationAdministration` with one thing taken
 * out: the `CommandContext`. Who is asking is settled by the transport — a
 * session on one side, an actor and a tenant on the other — and a screen that
 * assembled its own context would be a screen that could claim to be somebody
 * else. Everything that remains is the domain's own vocabulary, unchanged.
 *
 * There are no settings here. They are `SYS`'s and they have a screen coming;
 * this port grows the day one is built, rather than declaring methods nothing
 * calls — which is how registers and numbering arrived, each with the screen
 * that needed it.
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
    /** `SYS-14`: where it is, in words and on the map. */
    readdress(id: BranchId, address: string): Outcome<Branch>;
    locate(id: BranchId, point: GeoPoint | null): Outcome<Branch>;
    deactivate(id: BranchId): Outcome<Branch>;
    reactivate(id: BranchId): Outcome<Branch>;
  };
  readonly locations: {
    list(branch: BranchId, listing?: Listing): Promise<readonly Location[]>;
    open(input: NewLocation): Outcome<Location>;
    rename(id: LocationId, name: string): Outcome<Location>;
    readdress(id: LocationId, address: string): Outcome<Location>;
    locate(id: LocationId, point: GeoPoint | null): Outcome<Location>;
    deactivate(id: LocationId): Outcome<Location>;
    reactivate(id: LocationId): Outcome<Location>;
  };
  /**
   * The till positions of `SYS-09`, and the machines standing at them.
   *
   * Listed per branch for the reason locations are: a chain has one or two per
   * shop and nobody works across the lot, so the branch is chosen first.
   *
   * There is no way to change a prefix, and that is the contract's rather than
   * an omission here: every number a register has ever issued carries it, and a
   * number already printed cannot be renamed.
   */
  readonly registers: {
    list(branch: BranchId, listing?: Listing): Promise<readonly Register[]>;
    open(input: NewRegister): Outcome<Register>;
    rename(id: RegisterId, name: string): Outcome<Register>;
    /**
     * Says which machine is standing at this till now (`SYS-02`).
     *
     * A different machine raises the device generation and cannot be undone; the
     * same machine named again changes nothing, which is what lets a till that
     * reconnects say so as often as it likes.
     *
     * **Text, and not the branded identifier**, which is the one place this port
     * departs from the domain's vocabulary and does so deliberately. What
     * arrives here is what an administrator read off a till's own screen and
     * typed; the brand is a compile-time claim this side cannot substantiate,
     * and pretending otherwise would put the check in a screen. `SYS` judges the
     * shape and refuses one it could not have issued — which it has to do
     * regardless, since the same command also arrives from a sync that never
     * passed a screen at all.
     */
    assignDevice(id: RegisterId, device: string): Outcome<Register>;
    deactivate(id: RegisterId): Outcome<Register>;
    reactivate(id: RegisterId): Outcome<Register>;
  };
  /**
   * `SYS-02` as a screen configures it.
   *
   * `preview` is a read and the only way this application may know what a
   * format prints: the parser and the renderer belong to the module that prints
   * on every receipt in the shop, and a screen that worked the answer out for
   * itself would be a second copy of them.
   */
  readonly numbering: {
    configured(branch: BranchId): Promise<readonly NumberingSpecimen[]>;
    preview(scope: SeriesScope, format: string | null): Numbered<NumberingSpecimen>;
    define(scope: SeriesScope, format: string): Numbered<NumberingSeries>;
  };
  readonly profile: {
    /** Null only for a company this tenant did not register: every one it did has one. */
    read(company: CompanyId): Promise<BusinessProfile | null>;
    revise(company: CompanyId, changes: ProfileRevision): Outcome<BusinessProfile>;
  };
}

type Rated<T> = Promise<Result<T, CurrencyRefusal>>;

/**
 * `FX-01` and `FX-02` as the currencies screen uses them.
 *
 * It is `Currencies` and `CurrencyAdministration` with the same thing taken
 * out as `OrganisationOfRecord`: the `CommandContext`. `FX`, like `SYS`, is
 * the real module hosted in this browser — nothing in it needs a runtime a
 * browser does not have — so this port is answered by the genuine module from
 * the moment `dev-system.ts` composes it, exactly the way `organisation`
 * above already is.
 *
 * There is no `remove`, for the reason `CurrencyAdministration` itself gives:
 * every amount ever recorded names its currency's code.
 */
export interface CurrenciesOfRecord {
  /**
   * `including: 'enabled' | 'all'` — `FX`'s own spelling, not `SYS`'s
   * `'active' | 'all'`: the two modules chose different words for the same
   * idea and this port keeps each in its own, rather than forcing one
   * vocabulary onto a record that never asked for it.
   */
  list(listing?: CurrencyListing): Promise<readonly TenantCurrency[]>;
  /** `FX-02`: null only for a tenant whose currencies were never set up. */
  functional(): Promise<TenantCurrency | null>;
  define(input: NewCurrency): Rated<TenantCurrency>;
  revise(code: CurrencyCode, changes: CurrencyRevision): Rated<TenantCurrency>;
  disable(code: CurrencyCode): Rated<TenantCurrency>;
  enable(code: CurrencyCode): Rated<TenantCurrency>;
  makeFunctional(code: CurrencyCode): Rated<TenantCurrency>;
}

type RateOutcome<T> = Promise<Result<T, RateRefusal>>;

/**
 * `FX-04` as the daily rate board uses it.
 *
 * It is `ExchangeRates` and `RateAdministration` with the same thing taken out
 * as `CurrenciesOfRecord`: the `CommandContext`. Answered by the real `FX`
 * hosted in this browser, exactly as `currencies` is.
 *
 * `revisions` is not here: this screen corrects a mistyped rate by recording
 * the next one, which is what `FX-04`'s own words say a correction is, so a
 * day's revision history has no reader yet and stays off the port until one
 * needs it. `confirmLastKnown` is not here either — it is asked from the
 * register a supervisor is standing at, and no register exists in this
 * codebase yet (`modules.md` §2: `U07` brings one).
 */
export interface RatesOfRecord {
  /** A branch's rates for today, one line per currency other than the functional one. */
  board(branch: BranchId): RateOutcome<RateBoard>;
  /** Today's first rate for a currency at a branch, or a correction of it. */
  record(branch: BranchId, currency: CurrencyCode, quote: RateQuote): RateOutcome<RateRevision>;
  /** Publishes a rate for the tenant's branches to adopt. Owner-only; asked tenant-wide. */
  suggest(currency: CurrencyCode, quote: RateQuote): RateOutcome<SuggestedRate>;
  /** Makes today's suggestions this branch's own rates, every currency in one action. */
  adopt(branch: BranchId): RateOutcome<readonly RateRevision[]>;
}

/**
 * A right a module has declared, as the role editor needs it: the identifier
 * a grant names, and whether granting it is sensitive (`SEC-05`).
 *
 * Not `PermissionDeclaration` itself — that is `@vertex/platform`'s own shape,
 * carrying a `labelKey` this application never reads. This screen names every
 * right through `nameOfPermission` (`catalogue.ts`), keyed on the identifier
 * alone, so the same right is worded identically wherever it appears: in a
 * refusal, in a role's own row here. A second source of words for the same
 * right is exactly the drift that convention exists to prevent.
 */
export interface DeclaredRight {
  readonly id: PermissionId;
  readonly sensitive: boolean;
}

/**
 * `SEC-09`, `SEC-01`, `SEC-02` and `SEC-04` as the users and roles screens use
 * them.
 *
 * It is `UserDirectory`, `UserAdministration`, `RoleDirectory` and
 * `RoleAdministration` with the same thing taken out as `OrganisationOfRecord`:
 * the `CommandContext`. Everything that remains is `SEC`'s own vocabulary.
 *
 * `SEC` cannot be composed in this browser at all (`dev-system.ts` says why:
 * password hashing needs a runtime no browser has), so unlike `organisation`
 * above — the real `SYS` hosted here — this port is answered by a development
 * stand-in until `U07` brings a transport to the store node, where the real
 * module actually runs. The shape does not change when it does.
 */
export interface UsersOfRecord {
  list(listing?: Listing): Promise<readonly User[]>;
  enrol(input: NewUser): Secured<User>;
  rename(id: UserId, name: string): Secured<User>;
  deactivate(id: UserId): Secured<User>;
  reactivate(id: UserId): Secured<User>;
  resetPassword(id: UserId, password: string): Secured<User>;
  forceSignOut(id: UserId): Secured<User>;
  readonly roles: {
    /** The tenant's roles, `SEC-01`'s seven among them. */
    list(listing?: Listing): Promise<readonly Role[]>;
    /** Every right this edition's modules declare, for the grid (`SEC-02`). */
    rights(): Promise<readonly DeclaredRight[]>;
    define(input: NewRole): Secured<Role>;
    rename(id: RoleId, name: string): Secured<Role>;
    grant(id: RoleId, rights: readonly PermissionId[]): Secured<Role>;
    revoke(id: RoleId, rights: readonly PermissionId[]): Secured<Role>;
    /** Named as the contract names them (`RoleAdministration.roles`): a role is withdrawn, never deleted. */
    withdraw(id: RoleId): Secured<Role>;
    restore(id: RoleId): Secured<Role>;
  };
  readonly assignments: {
    of(user: UserId): Promise<readonly Assignment[]>;
    /** Every assignment of one role, across every user who holds it (`SEC-04`). */
    holdersOf(role: RoleId): Promise<readonly Assignment[]>;
    assign(input: NewAssignment): Secured<Assignment>;
    withdraw(user: UserId, role: RoleId): Secured<Assignment>;
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

  /**
   * Ends the session this port acts for.
   *
   * On the port, and not only in the screen's state. Signing out once cleared
   * what React held and nothing else, so the stand-in went on answering as the
   * person who had left — and `U07`'s transport, built to this shape, would
   * have had no call through which to end a session on the store node at all.
   */
  signOut(): Promise<void>;

  /**
   * `Credentials.changeOwnPassword`, as the account screen uses it.
   *
   * On the signed-in person's own record rather than under `users`: this is
   * `SEC`'s own vocabulary for the one command whose subject is always the
   * caller, available to everybody whether their sign-in is shared with another
   * tenant or not (`SEC-09`). It asks for nobody's identifier, because it could
   * not name anybody but the person already signed in.
   */
  changeOwnPassword(current: string, next: string): Secured<void>;

  readonly organisation: OrganisationOfRecord;
  readonly users: UsersOfRecord;
  readonly currencies: CurrenciesOfRecord;
  readonly rates: RatesOfRecord;
}
