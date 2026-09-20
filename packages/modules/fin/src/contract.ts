import {
  permissionId,
  type PermissionId,
  type ReservedAccount,
  type SeededRole,
  type TenantId,
} from '@vertex/contracts';
import type { CurrencyCode, Id, Refusal, Result } from '@vertex/kernel';
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

type StructuralSeeds = Readonly<Record<keyof StructuralRights, readonly SeededRole[]>>;

function rightsOver(resource: string, seeds: StructuralSeeds): StructuralRights {
  const rights: StructuralRights = Object.freeze({
    view: permissionId('fin', resource, 'view'),
    create: permissionId('fin', resource, 'create'),
    edit: permissionId('fin', resource, 'edit'),
    withdraw: permissionId('fin', resource, 'delete'),
  });
  DECLARED.push(
    { id: rights.view, seededFor: seeds.view },
    { id: rights.create, seededFor: seeds.create },
    { id: rights.edit, seededFor: seeds.edit },
    { id: rights.withdraw, seededFor: seeds.withdraw },
  );
  return rights;
}

function rightsToRevise(resource: string, seeds: readonly SeededRole[]): MappingRights {
  const rights: MappingRights = Object.freeze({ edit: permissionId('fin', resource, 'edit') });
  DECLARED.push({ id: rights.edit, seededFor: seeds });
  return rights;
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

export interface FinPermissions {
  readonly account: StructuralRights;
  readonly accountMapping: MappingRights;
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
});

/** What the module hands the platform: every right, and who starts out holding it. */
export const FIN_PERMISSION_SEEDS: readonly Declared[] = Object.freeze([...DECLARED]);
