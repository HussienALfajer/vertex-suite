import type { Result } from '@vertex/kernel';
import type {
  Category,
  CategoryId,
  CategoryRevision,
  CatRefusal,
  Item,
  ItemId,
  ItemStatus,
  ItemTrade,
  NewCategory,
  NewItem,
} from '@vertex/cat/contract';
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
  Account,
  AccountId,
  AccountNode,
  AccountingPeriod,
  AccountingPeriodId,
  AttachedFile,
  BalanceSheet,
  CalendarRefusal,
  ChartRefusal,
  ExceptionDecision,
  ExceptionListing,
  FiscalYear,
  FiscalYearId,
  GeneralLedger,
  IncomeStatement,
  JournalEntry,
  JournalEntryId,
  JournalListing,
  LedgerRequest,
  Listing as AccountListing,
  ManualEntry,
  NewAccount,
  OpeningBalances,
  PeriodReopening,
  Posted,
  PostingException,
  PostingExceptionId,
  PostingRefusal,
  Reversal,
  ReversalTerms,
  StatementRefusal,
  StatementRequest,
  TrialBalance,
  YearDefinition,
  YearShape,
} from '@vertex/fin/contract';
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
 * The production adapter speaks to the store node; isolated browser journeys
 * still use a development fixture through this same port.
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
 * `SEC` runs in the store node, which verifies sign-in and resolves the actor
 * and tenant for every operation. Browser tests may answer this port with a
 * fixture that has the same shape.
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

type Charted<T> = Promise<Result<T, ChartRefusal>>;

/**
 * `FIN-01` as the chart screen uses it.
 *
 * It is `ChartOfAccounts` and `ChartAdministration` with the same thing taken
 * out as every port above: the `CommandContext`. `FIN`, like `SYS` and `FX`, is
 * the real module hosted in this browser — nothing in the chart needs a runtime
 * a browser does not have — so this is answered by the genuine module from the
 * moment `dev-system.ts` composes it.
 *
 * **There is no `seed`**, and its absence is the point. Installing the retail
 * chart is what happens to a tenant on its first morning (`SYS-03`), not
 * something an accountant does to a shop that is trading; a button for it
 * would be a button that either does nothing or re-runs an installation. The
 * same goes for the calendar below.
 *
 * **There is no `delete`, and no way to change a code.** Both are the
 * contract's own (`ChartAdministration`): every line ever posted names its
 * account, and every report ever printed names its code.
 *
 * `resolve` and `mappings` are not here either. A module's account **role** is
 * mapped by the accountant, and this edition declares only roles reserved for
 * a purpose — which resolve to the seeded account and are mapped by nobody. The
 * screen for that arrives with the first module whose role needs it.
 */
export interface ChartOfRecord {
  /**
   * The tenant's accounts as a tree, roots in code order and each subtree in
   * code order.
   *
   * The tree and not the flat list, because the order and the shape are the
   * module's and a screen that rebuilt them would be a second copy of
   * `FIN-01`'s own arrangement.
   */
  tree(listing?: AccountListing): Promise<readonly AccountNode[]>;
  add(input: NewAccount): Charted<Account>;
  rename(id: AccountId, name: string): Charted<Account>;
  /** Under another parent of the same kind, or to the roots with null. */
  move(id: AccountId, parent: AccountId | null): Charted<Account>;
  withdraw(id: AccountId): Charted<Account>;
  restore(id: AccountId): Charted<Account>;
}

type Kept<T> = Promise<Result<T, CalendarRefusal>>;

/**
 * `FIN-05` as the fiscal-calendar screen uses it.
 *
 * `FiscalCalendar` and `FiscalCalendarAdministration`, minus the
 * `CommandContext` and minus the two the screen has no business asking.
 *
 * `postingPeriodOn` is not here: it is the question the posting engine asks of
 * every entry it writes, and a screen that asked it would be offering a second
 * reading of what the period table already states — which of a shop's months
 * are open. Nothing here removes a year, because `FIN-05` has no shape for a
 * calendar with a hole in it.
 */
export interface CalendarOfRecord {
  /** Every fiscal year, in date order, each with its periods. */
  years(): Promise<readonly FiscalYear[]>;
  /** Every reopening the books have ever had, oldest first (`FIN-05`). */
  reopenings(): Promise<readonly PeriodReopening[]>;
  /** The next year, beginning the day after the last one ends. Its start is never given. */
  append(shape?: YearShape): Kept<FiscalYear>;
  redefine(year: FiscalYearId, definition: YearDefinition): Kept<FiscalYear>;
  close(period: AccountingPeriodId): Kept<AccountingPeriod>;
  /** Owner-only and `SEC-05` sensitive, against a written reason, and logged. */
  reopen(period: AccountingPeriodId, reason: string): Kept<AccountingPeriod>;
}

/**
 * The engine refuses in its own vocabulary, and it is kept apart from the
 * chart's and the calendar's for the reason `Numbered` is kept apart from
 * `Outcome`: a screen renders a refusal by its code, and a union of every code
 * in `FIN` would let a screen claim to handle one its command cannot return.
 *
 * `PostingRefusal` is already wide — it carries the chart's codes, the
 * calendar's and `FX`'s, because a posting is refused by whichever of them
 * says no first — and that width is the contract's own rather than this port's.
 */
type Booked<T> = Promise<Result<T, PostingRefusal>>;

/**
 * `FIN-02`, `FIN-03`, `FIN-04` and `FIN-06` as the ledger screens use them.
 *
 * `Journal` and `JournalAdministration` with the `CommandContext` taken out,
 * as every port above. One port rather than two, because the journal screen
 * reads an entry and reverses it in one act and the two would be the same
 * transport either way.
 *
 * **There is no `post` and no `accept`.** `PostingEngine` writes into somebody
 * else's transaction, and a transaction does not cross a process boundary: an
 * entry is posted by the module that owns the event, on the machine that owns
 * the store. What a person does to the journal is the three things
 * `JournalAdministration` offers and no fourth — and there is no edit and no
 * delete anywhere beneath this interface, because `FIN-03` has none.
 *
 * `entryFor` is not here: a screen looks entries up by what it is reading, and
 * by a business event only when a module asks on its own behalf.
 */
export interface JournalOfRecord {
  /** Entries in day order, then in the order they were recorded (`FIN-02`). */
  entries(listing?: JournalListing): Promise<readonly JournalEntry[]>;
  /** One entry with its lines and its attachments, or null. */
  entry(id: JournalEntryId): Promise<Posted | null>;
  /** The entry that reversed this one, or null while it stands (`FIN-03`). */
  reversalOf(id: JournalEntryId): Promise<Reversal | null>;
  /**
   * One attachment with its bytes (`FIN-04`), by its place among the entry's.
   *
   * The bytes cross the boundary because the evidence for a posting is a file
   * somebody has to be able to open, and the store node has verified them
   * against the hash the entry records before handing them over.
   */
  attachment(entry: JournalEntryId, ordinal: number): Promise<AttachedFile | null>;
  /** The accountant's own adjusting entry (`FIN-04`). */
  record(entry: ManualEntry): Booked<Posted>;
  /** The books opened, as one dated entry (`FIN-06`). */
  open(balances: OpeningBalances): Booked<Posted>;
  /** The one correction there is (`FIN-03`): a reversing entry naming the original. */
  reverse(original: JournalEntryId, terms: ReversalTerms): Booked<Posted>;
}

/**
 * `FIN-05`'s exceptions queue as the screen that empties it uses it.
 *
 * `PostingExceptions` and `PostingExceptionAdministration`, minus the
 * `CommandContext` and minus `exception`: the screen lists what is waiting and
 * decides on it from that list, so a read of one by identifier has no caller.
 *
 * There is no dismissal here because the contract has none — `FIN-02` allows
 * no event without its entry, so an event that should never have happened is
 * posted and then reversed, where both acts can be read.
 */
export interface PostingExceptionsOfRecord {
  exceptions(listing?: ExceptionListing): Promise<readonly PostingException[]>;
  /** As dated, or on another day against a written reason. */
  post(id: PostingExceptionId, decision?: ExceptionDecision): Booked<Posted>;
}

/** Reading the books refuses in its own vocabulary too, and for the same reason. */
type Stated<T> = Promise<Result<T, StatementRefusal>>;

/**
 * `FIN-07` as the statements screen uses it: `Statements` with the
 * `CommandContext` taken out, and nothing else changed.
 *
 * Each of the four is its own call rather than one call with a kind, because
 * that is what the contract offers and because two of them do not take the
 * same request — a general ledger is the one statement asked for by account.
 */
export interface StatementsOfRecord {
  trialBalance(request: StatementRequest): Stated<TrialBalance>;
  incomeStatement(request: StatementRequest): Stated<IncomeStatement>;
  balanceSheet(request: StatementRequest): Stated<BalanceSheet>;
  generalLedger(request: LedgerRequest): Stated<GeneralLedger>;
}

export interface SystemOfRecord {
  readonly catalogue: {
    categories(): Promise<readonly Category[]>;
    category(id: CategoryId): Promise<Category | null>;
    items(): Promise<readonly Item[]>;
    item(id: ItemId): Promise<Item | null>;
    eligibility(id: ItemId, trade: ItemTrade): Promise<Result<Item, CatRefusal>>;
    createCategory(input: NewCategory): Promise<Result<Category, CatRefusal>>;
    reviseCategory(
      id: CategoryId,
      revision: CategoryRevision,
    ): Promise<Result<Category, CatRefusal>>;
    moveCategory(id: CategoryId, parent: CategoryId | null): Promise<Result<Category, CatRefusal>>;
    createItem(input: NewItem): Promise<Result<Item, CatRefusal>>;
    changeItemStatus(
      id: ItemId,
      status: ItemStatus,
      reason: string,
    ): Promise<Result<Item, CatRefusal>>;
  };
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
  readonly chart: ChartOfRecord;
  readonly calendar: CalendarOfRecord;
  readonly journal: JournalOfRecord;
  readonly postingExceptions: PostingExceptionsOfRecord;
  readonly statements: StatementsOfRecord;
}
