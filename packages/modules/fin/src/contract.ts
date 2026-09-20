import {
  operation,
  permissionId,
  type Action,
  type PermissionId,
  type ReservedAccount,
  type SeededRole,
  type TenantId,
  type UserId,
} from '@vertex/contracts';
import type { CurrencyCode, Id, Instant, LocalDate, Refusal, Result } from '@vertex/kernel';
import { contractKey, type CommandContext } from '@vertex/platform';

/**
 * What `FIN` lets the rest of the system see.
 *
 * The ledger runs invisibly (`core-features.md` §1): a shop owner never meets a
 * debit or a credit, and every module above this one posts to it without
 * knowing what a journal looks like. So what is published here is narrow on
 * purpose — the chart, and the way a module's account **role** becomes one
 * tenant's account — and nothing may reach past it (`modules.md` §4).
 *
 * Types and keys only, as in `FX`. Anything this file imported would be imported
 * by every module that posts, which is every module that trades.
 */

/**
 * What `FIN` needs from a store, and nothing more.
 *
 * Declared here rather than borrowed, for the reason `SEC` and `FX` give: a
 * store port is nobody's property, and structural typing lets one session
 * satisfy every module.
 *
 * **There is no `remove`, and that is `FIN-03`.** Journal entries cannot be
 * edited or deleted, and the strongest statement of that is a module with no
 * way to delete anything at all — not a rule to remember, and not a method that
 * every reviewer has to notice is never called. An account is withdrawn from
 * use and never deleted, because every line ever posted names it.
 */
export interface RecordSession {
  put(key: string, value: unknown): void;
  get(key: string): unknown;
  keys(): readonly string[];
}

interface TenantOwned {
  readonly tenant: TenantId;
}

export type AccountId = Id<'account'>;

/**
 * The five kinds of account, in the order a balance sheet and an income
 * statement read them.
 *
 * Closed, because the kind is what every statement of `FIN-07` is computed
 * from: assets against liabilities and equity, income against expenses. A kind
 * a tenant could invent is a figure no statement knows where to put.
 */
export const ACCOUNT_KINDS = Object.freeze([
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
] as const);

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Which side an account of a kind normally carries its balance on. */
export type NormalBalance = 'debit' | 'credit';

/**
 * One account of one tenant's chart (`FIN-01`).
 *
 * The **code** is what a statement prints and an accountant reads; it is unique
 * within the tenant and is never edited, because every report ever printed
 * names it. The **name** is what is edited. It is null for a seeded account
 * nobody has renamed, which is then displayed through the terminology layer
 * (`account.<seeded>`) — the arrangement `SEC` uses for its seeded roles, and
 * what `design-system.md` §12 requires of every user-facing string. An account
 * the tenant added is displayed as the tenant typed it.
 *
 * The **parent** makes the tree. An account with children is a group and takes
 * no postings; the posting engine of `FIN-02` refuses it and posts to leaves.
 *
 * **`reserved`** is the mark `FIN-01` puts on the system's own accounts: the
 * purpose the account exists for, and the reason it cannot be withdrawn. A
 * module's role declared for that purpose resolves here (`ChartOfAccounts.resolve`).
 * `currency` is set on exactly the accounts reserved for `cash`, which `FIN-01`
 * keeps one of per currency, and null on every other.
 *
 * Withdrawn rather than deleted, like everything else in this system, and here
 * for the ledger's own reason: a line posted last year names this account, and
 * `FIN-07` still has to read it.
 */
export interface Account extends TenantOwned {
  readonly id: AccountId;
  readonly code: string;
  readonly kind: AccountKind;
  readonly parent: AccountId | null;
  readonly reserved: ReservedAccount | null;
  readonly currency: CurrencyCode | null;
  /** The seed this began as, or null for an account the tenant added. */
  readonly seeded: string | null;
  readonly name: string | null;
  readonly active: boolean;
}

/** An account with its children, each with theirs, in code order. */
export interface AccountNode {
  readonly account: Account;
  readonly children: readonly AccountNode[];
}

/**
 * An account being added by the tenant.
 *
 * The kind is stated even under a parent, rather than inherited from it: a
 * definition that reaches this module off a wire with no kind is refused,
 * where inheritance would quietly file it under whatever the parent happened
 * to be. Stated and disagreeing with the parent is refused too.
 */
export interface NewAccount {
  readonly code: string;
  readonly name: string;
  readonly kind: AccountKind;
  /** Null for a new root. */
  readonly parent: AccountId | null;
}

/** Whether a listing hides the accounts withdrawn from use, or shows every one. */
export interface Listing {
  readonly including?: 'active' | 'all';
}

/**
 * How a module's account role reaches one tenant's account.
 *
 * `reserved` roles resolve to the account seeded for their purpose and are
 * never mapped by hand; every other role is mapped by the accountant, once,
 * and this is that record. Read back so a mapping screen can show what points
 * where.
 */
export interface AccountMapping extends TenantOwned {
  readonly role: string;
  readonly account: AccountId;
}

export type ChartRefusalCode =
  /** Not a code: empty, or carrying whitespace or a character no statement prints. */
  | 'fin.account-code-invalid'
  | 'fin.account-code-taken'
  /** Words, and not punctuation or a bare figure standing in for a name. */
  | 'fin.account-name-required'
  | 'fin.account-kind-unknown'
  /** An income account under an asset: no statement could place its balance. */
  | 'fin.account-kind-mismatch'
  | 'fin.account-not-found'
  /** A parent withdrawn from use takes no new child, and gives none back. */
  | 'fin.account-inactive'
  /**
   * Reserved by the system (`FIN-01`), so it cannot be withdrawn — and takes
   * no children, because the system posts to it as a leaf.
   */
  | 'fin.account-reserved'
  /** A group is withdrawn after its children, never over them. */
  | 'fin.account-has-children'
  /** Moved under itself, or under one of its own descendants. */
  | 'fin.account-cycle'
  /** A group takes no postings and no mapping; only a leaf does. */
  | 'fin.account-is-group'
  /** No module in this edition declares the role (`modules.md` §4.4). */
  | 'fin.account-role-undeclared'
  /** A role reserved for a purpose resolves to that purpose's account and is mapped by nobody. */
  | 'fin.account-role-reserved'
  /** Declared, not reserved, and nobody has said which account it posts to. */
  | 'fin.account-role-unmapped'
  /** A debit role onto a credit account, or the reverse — see `AccountRoleDeclaration`. */
  | 'fin.account-normal-balance-mismatch'
  /** Resolving a cash role with no currency to resolve it for. */
  | 'fin.currency-required'
  /** No cash account for that currency: the currency was never announced to the ledger. */
  | 'fin.account-for-currency-missing'
  /** The tenant's chart was never seeded, so there is no reserved account to resolve to. */
  | 'fin.chart-unseeded'
  /** The caller does not hold the right this command declares (`SEC-02`). */
  | 'fin.not-permitted';

export type ChartRefusal = Refusal<ChartRefusalCode>;

type Outcome<T> = Promise<Result<T, ChartRefusal>>;

/**
 * The read side, which is what other modules and the posting engine use.
 *
 * **Unguarded**, for the reason `SYS` and `FX` give for their reads: these are
 * what other modules build on, under the context of whoever started the
 * command. A stock movement resolves the inventory account whether or not the
 * warehouse keeper may open the chart. What a *person* may see is decided
 * where their request enters the system of record (`U07`), with the view
 * right declared below.
 */
export interface ChartOfAccounts {
  /**
   * The tenant's accounts, flat, in code order, so a list somebody is reading
   * does not rearrange itself between two reads. Only those in use, unless the
   * listing asks for all.
   */
  accounts(by: CommandContext, listing?: Listing): Promise<readonly Account[]>;

  /** One account, in use or not: a line posted last year still names it. */
  account(by: CommandContext, id: AccountId): Promise<Account | null>;

  /** The same accounts as a tree, roots in code order, each subtree in code order. */
  tree(by: CommandContext, listing?: Listing): Promise<readonly AccountNode[]>;

  /**
   * The account a module's role posts to, in this tenant (`FIN-01`).
   *
   * A role reserved for a purpose resolves to the account seeded for it — for
   * `cash`, to the account of the currency given. Any other declared role
   * resolves through the accountant's mapping, or is refused as unmapped, so
   * that a posting can say which role nobody has placed rather than land in an
   * account somebody guessed. What comes back is an account a posting may land
   * in: in use, and a leaf. One that is not is refused here, with the reason,
   * so the posting engine has one answer to act on.
   */
  resolve(by: CommandContext, role: string, currency?: CurrencyCode): Outcome<Account>;

  /** Every mapping the accountant has made, in role order. */
  mappings(by: CommandContext): Promise<readonly AccountMapping[]>;
}

/**
 * The write side: what the tenant's accountant does to its own chart.
 *
 * Every command asks the right it declares through `ModuleContext.authorise`,
 * before its transaction opens, at the tenant-wide place — a chart is one per
 * tenant, so there is no branch to be judged at (`SEC-04`).
 *
 * There is no delete, and no way to change a code. See `RecordSession` and
 * `Account`.
 */
export interface ChartAdministration {
  /**
   * Installs the retail chart of `FIN-01` for a tenant that has none, with one
   * cash account for every currency the tenant has.
   *
   * Idempotent, and that is load-bearing for the reason `FX`'s seed gives:
   * first-run installation can be interrupted and `SYN-02` replays commands.
   * An account already there is left exactly as it is — renamed, moved or
   * withdrawn — and a seed whose code the tenant has already given to an
   * account of their own is not installed over it: the tenant's account
   * stands, and the seed takes the next free code beside it.
   *
   * Asked under `account.create`: the seed adds accounts and nothing else.
   */
  seed(by: CommandContext): Outcome<readonly Account[]>;

  /** Adds an account, as a root or under a parent of its own kind. */
  add(by: CommandContext, input: NewAccount): Outcome<Account>;

  /** Renames. A seeded account renamed keeps the name over any later seed. */
  rename(by: CommandContext, id: AccountId, name: string): Outcome<Account>;

  /**
   * Moves an account, with everything under it, under another parent of the
   * same kind — or to the roots, with null.
   */
  move(by: CommandContext, id: AccountId, parent: AccountId | null): Outcome<Account>;

  /**
   * Takes an account out of use. Refused for a reserved account and for a
   * group whose children are still in use. Repeating it is answered as done.
   */
  withdraw(by: CommandContext, id: AccountId): Outcome<Account>;

  /**
   * Puts one back into use, under the checks the way in makes: its parent has
   * to be in use. Repeating it is answered as done.
   */
  restore(by: CommandContext, id: AccountId): Outcome<Account>;

  /**
   * Says which account a declared, unreserved role posts to. Mapping a role
   * again replaces the mapping; the lines already posted keep the account they
   * were posted to (`FIN-03`).
   */
  map(by: CommandContext, role: string, account: AccountId): Outcome<AccountMapping>;
}

export const ChartOfAccounts = contractKey<ChartOfAccounts>('fin.chart-of-accounts');

export const ChartAdministration = contractKey<ChartAdministration>('fin.chart-administration');

export type FiscalYearId = Id<'fiscal-year'>;

export type AccountingPeriodId = Id<'accounting-period'>;

export type PeriodReopeningId = Id<'period-reopening'>;

/** Who closed a period, and when. */
export interface PeriodClosure {
  readonly by: UserId | null;
  readonly at: Instant;
}

/**
 * One accounting period (`FIN-05`): a span of days, and whether the books are
 * still open on it.
 *
 * **Closed is a fact with an author**, not a flag: `closed` is null while the
 * period is open and otherwise says who closed it and when, so that one field
 * cannot disagree with another about the same thing. Closing blocks every
 * posting dated within the span — see `FiscalCalendar.postingPeriodOn`.
 *
 * **`posted`** is whether anything has ever been posted into it. It is what
 * stops a year being restructured under entries already written: the shape of
 * a year is the accountant's until the first entry lands in it, and a figure
 * that has moved to another period since it was reported is a figure nobody
 * can reconcile.
 *
 * `closesOn` is the last day the period covers and never the first day of the
 * next: a period is a range of days a person reads and a statement prints, and
 * a half-open range read as a closed one is an entry filed a month out.
 */
export interface AccountingPeriod {
  readonly id: AccountingPeriodId;
  readonly year: FiscalYearId;
  /** Its place in the year, counted from one. */
  readonly ordinal: number;
  readonly opensOn: LocalDate;
  readonly closesOn: LocalDate;
  readonly closed: PeriodClosure | null;
  readonly posted: boolean;
}

/**
 * One fiscal year, and its division into periods (`FIN-05`).
 *
 * The periods are **inside** the year rather than beside it, which is the one
 * structural decision here. A year's division is a single decision — twelve
 * months, or four quarters — made and revised as a whole; no period is ever
 * added to a year on its own, and no period outlives the division it belongs
 * to. Writing the year writes the division, so it can never be left half
 * applied, and the module that cannot delete anything (`RecordSession`) is
 * never left holding the periods of a shape nobody chose.
 *
 * There is no name. A year is the span it covers and a period is its place in
 * that span; a screen writes both through the date formats of
 * `design-system.md` §12, in the reader's own calendar and digits. A free-text
 * name would be one more string to translate, keep unique, and disagree with
 * the dates printed beside it.
 */
export interface FiscalYear {
  readonly id: FiscalYearId;
  readonly opensOn: LocalDate;
  /** The last day of its last period. */
  readonly closesOn: LocalDate;
  /** In order, each opening the day after the one before it closes. */
  readonly periods: readonly AccountingPeriod[];
}

/**
 * A tenant's whole calendar, which is **one record**.
 *
 * `FIN-05` needs the years to run end to end with nothing between them: a day
 * in a gap belongs to no period, so nothing could say whether it is closed, and
 * the posting engine would have no answer to give. Holding every year in one
 * record makes that a property of a single write rather than an invariant
 * spread across rows written separately.
 *
 * It is also what keeps the posting path off the key space. `FIN-02` asks which
 * period a day falls in for **every** entry it writes; finding the year by
 * scanning would make each of those a listing of the store, and under
 * serialisable isolation a listing is a conflict with every command that adds a
 * record anywhere. One key, read by name, conflicts with nothing but a change
 * to the calendar itself.
 *
 * It stays small: a shop trading for a decade has ten years in it and a hundred
 * and twenty periods.
 */
export interface TenantCalendar extends TenantOwned {
  readonly years: readonly FiscalYear[];
}

/**
 * How a fiscal year is divided, which is the whole of what an accountant
 * chooses about one.
 *
 * Months, because that is the unit every calendar this product serves is
 * divided by, and because periods of a whole number of months are the only ones
 * that tile a year exactly however long its months are.
 */
export interface YearShape {
  /** How many months the year spans. Twelve, unless a shop is moving its year end. */
  readonly months: number;
  /** How many months one period spans — one monthly, three quarterly. It must divide `months`. */
  readonly monthsPerPeriod: number;
}

/** A shape, and the day the year begins on. */
export interface YearDefinition extends YearShape {
  readonly opensOn: LocalDate;
}

/**
 * A closed period opened again (`FIN-05`), in `FIN`'s own log.
 *
 * Its own record rather than fields on the period, for the reason `FX` keeps
 * its overrides in one: a period is read one at a time by whoever is posting,
 * and this is read by whoever is reviewing what was done to the books — and a
 * period reopened twice would otherwise keep only the last of them. It holds
 * the closure it undid, so that the whole act reads in one line: closed by
 * whom, on what day, opened again by whom, and why.
 */
export interface PeriodReopening extends TenantOwned {
  readonly id: PeriodReopeningId;
  readonly year: FiscalYearId;
  readonly period: AccountingPeriodId;
  /** The closure this undid. */
  readonly undone: PeriodClosure;
  readonly reason: string;
  readonly by: UserId | null;
  readonly at: Instant;
}

/**
 * Why the calendar refused.
 *
 * An accounting period is the only kind of period `FIN` has, so these say
 * `period` where the types say `accounting-period`: a code is read in a log and
 * written into a screen's messages a hundred times, and it is unambiguous.
 */
export type CalendarRefusalCode =
  /** Not a day: see `localDate` in `@vertex/kernel` for the one spelling. */
  | 'fin.day-invalid'
  /** The tenant has no fiscal year at all, so no day is in a period. */
  | 'fin.calendar-unseeded'
  /** Before the first year or after the last. There are no gaps between them. */
  | 'fin.day-outside-calendar'
  /** The period covering it is closed, which is what `FIN-05` blocks postings with. */
  | 'fin.period-closed'
  | 'fin.fiscal-year-not-found'
  | 'fin.period-not-found'
  /** Only the last year can be redefined: changing an earlier one moves every year after it. */
  | 'fin.fiscal-year-not-last'
  /** Something has been posted into the year, so its shape is no longer the accountant's. */
  | 'fin.fiscal-year-posted'
  /** A redefined year that would not begin the day after the one before it ends. */
  | 'fin.fiscal-year-gap'
  /** Not a whole number of months between one and twenty-four. */
  | 'fin.fiscal-year-months-invalid'
  /** Not a whole number of months that divides the year exactly. */
  | 'fin.months-per-period-invalid'
  /** Reopening a closed period was asked for with nothing written in the reason. */
  | 'fin.reopen-reason-required'
  /** The caller does not hold the right this command declares (`SEC-02`). */
  | 'fin.not-permitted';

export type CalendarRefusal = Refusal<CalendarRefusalCode>;

/** The books are kept in periods; this is what keeping them answers with. */
type Kept<T> = Promise<Result<T, CalendarRefusal>>;

/**
 * The calendar, read.
 *
 * **Unguarded**, for the reason `ChartOfAccounts` is: this is what the posting
 * engine and every module above it build on, under the context of whoever
 * started the command. A cashier's sale asks which period its day falls in
 * whether or not a cashier may open the fiscal calendar. What a *person* may
 * see is decided where their request enters the system of record (`U07`), with
 * the view right declared below.
 */
export interface FiscalCalendar {
  /** Every fiscal year the tenant has, in date order, each with its periods. */
  years(by: CommandContext): Promise<readonly FiscalYear[]>;

  /**
   * The open period an entry dated on `day` belongs in — or why there is none
   * (`FIN-05`).
   *
   * The one question the posting engine asks the calendar, and the whole of
   * "closing a period blocks all postings dated within it". A refusal names
   * which of the four reasons it is, because they are answered differently: a
   * day in no period is a mistake to correct, and a day in a closed one is what
   * `FIN-05` routes to the exceptions queue for a decision.
   */
  postingPeriodOn(by: CommandContext, day: LocalDate): Kept<AccountingPeriod>;

  /** Every reopening, oldest first — of one period, or of the whole calendar. */
  reopenings(by: CommandContext, period?: AccountingPeriodId): Promise<readonly PeriodReopening[]>;
}

/**
 * The calendar, kept: what the tenant's accountant does to its own.
 *
 * Every command asks the right it declares through `ModuleContext.authorise`,
 * before its transaction opens, at the tenant-wide place. A calendar is one per
 * tenant and `FIN-05` closes a period for the whole of it — a branch still
 * posting into a month the others have closed is a set of books that does not
 * add up — so there is no branch to be judged at (`SEC-04`).
 *
 * Nothing here removes a year. `RecordSession` has no way to delete anything,
 * and a calendar with a year taken out of the middle of it is the one shape
 * `FIN-05` cannot have.
 */
export interface FiscalCalendarAdministration {
  /**
   * Installs the tenant's first fiscal year: the calendar year it is now,
   * divided into twelve monthly periods.
   *
   * "Now" is counted at the branch the tenant opened first, since a day in this
   * product is always somewhere's day; a tenant with no branch yet is counted in
   * the zone a branch is opened in by default. It decides the year and nothing
   * else, and only in the hours either side of a New Year — after which the
   * accountant redefines the year anyway, which is what `redefine` is for.
   *
   * Idempotent, and that is load-bearing for the reason the chart's seed gives:
   * first-run installation can be interrupted and `SYN-02` replays commands. A
   * tenant that already has a calendar gets the one it has, untouched.
   */
  seed(by: CommandContext): Kept<readonly FiscalYear[]>;

  /**
   * Adds the next fiscal year, beginning the day after the last one ends.
   *
   * The start is never given, which is what "appended without gaps" means: the
   * only day a new year may begin on is the one after the calendar currently
   * reaches. The shape defaults to the shape of the year it follows, so a shop
   * that keeps quarters goes on keeping them.
   */
  append(by: CommandContext, shape?: YearShape): Kept<FiscalYear>;

  /**
   * Redefines a year — its span, and how it is divided.
   *
   * The shop whose books turn out to run from April, and the year appended with
   * the wrong shape. Refused once anything has been posted into the year, once
   * any of its periods has been closed, and for any year but the last: each of
   * the three is a way of moving a day out of the period it was accounted for
   * in.
   *
   * The year keeps its identity; its periods are new, because a period is a
   * span and these are different spans.
   */
  redefine(by: CommandContext, year: FiscalYearId, definition: YearDefinition): Kept<FiscalYear>;

  /**
   * Closes a period. Every posting dated within it is refused from here on.
   *
   * Periods are closed one at a time and in any order. An accountant who closes
   * a quarter's three months while a supplier invoice is still outstanding in
   * one of them has a reason, and a rule requiring the months in order would
   * only be worked around by closing the later one and reopening it — which is
   * the act this module makes expensive on purpose.
   *
   * Closing one already closed is answered as done: a button pressed twice, and
   * a command `SYN-02` replays, must not fail.
   */
  close(by: CommandContext, period: AccountingPeriodId): Kept<AccountingPeriod>;

  /**
   * Opens a closed period again, against a written reason, and logs it.
   *
   * Allowed at all because the alternative is worse: an entry that belongs in a
   * closed month otherwise has to be dated into an open one, and a sale
   * recorded in the wrong month is a distortion nobody can see, where a
   * reopening is one every reader of the log can. It is declared sensitive and
   * seeded to nobody, which leaves it with the owner alone (`SEC-01`).
   *
   * Reopening a period that is open is answered as done, and logs nothing.
   */
  reopen(by: CommandContext, period: AccountingPeriodId, reason: string): Kept<AccountingPeriod>;
}

export const FiscalCalendar = contractKey<FiscalCalendar>('fin.fiscal-calendar');

export const FiscalCalendarAdministration = contractKey<FiscalCalendarAdministration>(
  'fin.fiscal-calendar-administration',
);

/**
 * The account roles this module posts to itself, declared the way every other
 * module declares its own (`modules.md` §4.4).
 *
 * `FIN` is a module like the rest where its own postings are concerned: the
 * opening journal entry of `FIN-06` balances against opening-balance equity,
 * and that account is reached through a role reserved for the purpose — not
 * by a code this module happens to know it seeded.
 */
export const FIN_ACCOUNT_ROLES = Object.freeze({
  openingBalanceEquity: 'fin.opening-balance-equity',
} as const);

/** The four rights over a thing that is made, read, revised and taken out of use. */
export interface StructuralRights {
  readonly view: PermissionId;
  readonly create: PermissionId;
  readonly edit: PermissionId;
  /** `delete` in `SEC-02`'s grammar. Nothing is deleted: an account is withdrawn from use. */
  readonly withdraw: PermissionId;
}

/** A thing that is revised and never made: the mapping of roles to accounts. */
export interface MappingRights {
  readonly edit: PermissionId;
}

/**
 * A thing that is made and revised and never withdrawn: the fiscal calendar.
 *
 * There is no `delete`, because there is no command to hold it. A year cannot
 * be removed — `FIN-05` has no shape for a calendar with a hole in it — and a
 * right nobody asks for is a tick in the role editor that reads as protection
 * and is none.
 */
export interface CalendarRights {
  readonly view: PermissionId;
  readonly create: PermissionId;
  readonly edit: PermissionId;
}

/**
 * Closing an accounting period, and opening one again.
 *
 * Neither is one of `SEC-02`'s five verbs, and flattening them into `edit`
 * would hide the only distinction that matters here: closing the books is the
 * accountant's ordinary month end, and opening them again is the act an owner
 * decides on.
 */
export interface PeriodRights {
  readonly close: PermissionId;
  readonly reopen: PermissionId;
}

/**
 * Every right defined below, collected as each is built, with the roles that
 * hold it the day a shop is set up (`SEC-01`).
 *
 * The same arrangement `SYS`, `SEC` and `FX` use: the module declares its
 * permissions from this list, and the builders beneath are the only way to
 * make a right — so a right cannot exist without being declared, and cannot
 * be declared under a name that differs by a character from the one a command
 * asks for.
 */
interface Declared {
  readonly id: PermissionId;
  readonly seededFor: readonly SeededRole[];
  /** `SEC-05`: re-authorisation before it proceeds. */
  readonly sensitive?: boolean;
}

const DECLARED: Declared[] = [];

/** The one way a right of this module comes into existence. */
function right(
  resource: string,
  action: Action,
  seededFor: readonly SeededRole[],
  sensitive?: true,
): PermissionId {
  const id = permissionId('fin', resource, action);
  DECLARED.push(sensitive === undefined ? { id, seededFor } : { id, seededFor, sensitive });
  return id;
}

type StructuralSeeds = Readonly<Record<keyof StructuralRights, readonly SeededRole[]>>;

function rightsOver(resource: string, seeds: StructuralSeeds): StructuralRights {
  return Object.freeze({
    view: right(resource, 'view', seeds.view),
    create: right(resource, 'create', seeds.create),
    edit: right(resource, 'edit', seeds.edit),
    withdraw: right(resource, 'delete', seeds.withdraw),
  });
}

function rightsToRevise(resource: string, seeds: readonly SeededRole[]): MappingRights {
  return Object.freeze({ edit: right(resource, 'edit', seeds) });
}

/**
 * The accountant: `FIN-04` names the role that owns the books, and the chart
 * is the books' own shape.
 */
const ACCOUNTANT: readonly SeededRole[] = Object.freeze(['accountant']);

/**
 * Whoever reads the books reads the chart they are kept in. The manager reads
 * statements (`FIN-07`) and so has to be able to read the accounts they are
 * made of; nobody who handles stock or a till needs either.
 */
const READERS: readonly SeededRole[] = Object.freeze(['manager', 'accountant']);

/**
 * Seeded to no role at all, which leaves it with the owner — who holds every
 * right this edition declares, by construction rather than by a list (`OWNER`
 * in `@vertex/contracts`). Naming the owner here would be a second statement of
 * that, in the one place it could come to disagree.
 */
const NOBODY: readonly SeededRole[] = Object.freeze([]);

export interface FinPermissions {
  readonly account: StructuralRights;
  readonly accountMapping: MappingRights;
  readonly fiscalYear: CalendarRights;
  readonly accountingPeriod: PeriodRights;
}

export const FIN_PERMISSIONS: FinPermissions = Object.freeze({
  account: rightsOver('account', {
    view: READERS,
    create: ACCOUNTANT,
    edit: ACCOUNTANT,
    withdraw: ACCOUNTANT,
  }),
  // Where a module's postings land is the accountant's decision alone: it is
  // the one setting in the product that can make a correct sale report as a
  // wrong figure in every statement after it.
  accountMapping: rightsToRevise('account-mapping', ACCOUNTANT),

  fiscalYear: Object.freeze({
    view: right('fiscal-year', 'view', READERS),
    create: right('fiscal-year', 'create', ACCOUNTANT),
    edit: right('fiscal-year', 'edit', ACCOUNTANT),
  }),
  accountingPeriod: Object.freeze({
    close: right('accounting-period', operation('close'), ACCOUNTANT),
    // `SEC-05`: sensitive, so that it is re-authorised at the moment it is used
    // and not merely held. Reopening the books is the one act in this module
    // that changes what a period already reported can still be made to say.
    reopen: right('accounting-period', operation('reopen'), NOBODY, true),
  }),
});

/** What the module hands the platform: every right, and who starts out holding it. */
export const FIN_PERMISSION_SEEDS: readonly Declared[] = Object.freeze([...DECLARED]);
