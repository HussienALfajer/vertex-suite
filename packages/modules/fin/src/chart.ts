import { PER_CURRENCY_ACCOUNT, type TenantId } from '@vertex/contracts';
import { isId, newId, ok, parseId, refuse, type CurrencyCode, type Result } from '@vertex/kernel';
import type { AccountRoleDeclaration } from '@vertex/platform';
import type { TenantCurrency } from '@vertex/fx/contract';

import {
  ACCOUNT_KINDS,
  type Account,
  type AccountId,
  type AccountKind,
  type AccountMapping,
  type AccountNode,
  type ChartRefusal,
  type Listing,
  type NewAccount,
  type NormalBalance,
  type RecordSession,
} from './contract.js';
import { readRecord, scanRecords, writeRecord } from './records.js';
import { CASH_GROUP, CASH_SEED, SEEDED_ACCOUNTS } from './seeds.js';

/**
 * The chart of accounts: `FIN-01`.
 *
 * Every function takes the session of a transaction already open and does all
 * of its checking **before** any of its writing, for the reason `SYS` and `FX`
 * give: a refusal is a returned value rather than a thrown one, so the
 * transaction it was refused in still commits — and a command that had written
 * something before refusing would leave it behind.
 */

type Outcome<T> = Result<T, ChartRefusal>;

/** A definition's fields as they may actually arrive: typed by a person, or read off a wire. */
type Arriving = { readonly [Field in keyof NewAccount]: unknown };

/**
 * A code: something a statement prints in a column and an accountant reads
 * back over the phone.
 *
 * ASCII letters, digits, dots and dashes, up to thirty-two of them, and nothing
 * else — no whitespace, and not the Arabic-Indic digits an Arabic keyboard
 * offers, because `١١٠١` and `1101` would be two accounts that read as one.
 * Exactly as given, neither trimmed nor folded: the screen that takes the
 * typing is where that is fixed, and a code accepted in two spellings is a code
 * that compares unequal to itself.
 */
const CODE = /^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$/;

const KINDS: ReadonlySet<string> = new Set(ACCOUNT_KINDS);

function isKind(value: unknown): value is AccountKind {
  return typeof value === 'string' && KINDS.has(value);
}

/**
 * Something a person wrote: letters, and not punctuation or a bare figure
 * standing in for a name.
 *
 * The standard the exemption comments in `tools/` and the override reason in
 * `FX` are held to, and here because an account named `5400` is an account
 * with no name: the code already says that.
 */
function named(value: unknown): string | null {
  if (typeof value !== 'string' || !/\p{L}/u.test(value)) return null;
  return value.trim();
}

/**
 * What arrived, for a refusal to show: the value itself when it can be shown,
 * and otherwise what kind of thing it was — an object rendered by its default
 * form says nothing to the person reading the refusal.
 */
function shown(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
    case 'undefined':
    case 'object':
    case 'function':
      return typeof value;
  }
}

/** Which side an account of a kind normally carries its balance on. */
export function normalBalanceOf(kind: AccountKind): NormalBalance {
  return kind === 'asset' || kind === 'expense' ? 'debit' : 'credit';
}

/**
 * Codes in the order an accountant reads them.
 *
 * Two all-digit codes compare as numbers, so `999` precedes `1000` and `1101`
 * precedes `1200`; anything else compares by code unit, never by locale, so
 * that every machine in the shop lists the same chart in the same order. A
 * numeric code sorts before a non-numeric one, and equal codes never meet —
 * a code is unique within a tenant.
 */
export function compareCodes(one: string, other: string): number {
  const numeric = /^\d+$/;
  const oneNumeric = numeric.test(one);
  const otherNumeric = numeric.test(other);
  if (oneNumeric && otherNumeric) {
    if (one.length !== other.length) return one.length - other.length;
  } else if (oneNumeric !== otherNumeric) {
    return oneNumeric ? -1 : 1;
  }
  return one < other ? -1 : one > other ? 1 : 0;
}

function byCode(one: Account, other: Account): number {
  return compareCodes(one.code, other.code);
}

export function accountIn(session: RecordSession, tenant: TenantId, id: AccountId): Account | null {
  return readRecord(session, 'account', tenant, [id]);
}

/** Every account of the tenant, in use or not, in code order. */
function allAccountsIn(session: RecordSession, tenant: TenantId): readonly Account[] {
  return scanRecords(session, 'account', tenant).sort(byCode);
}

export function accountsIn(
  session: RecordSession,
  tenant: TenantId,
  listing?: Listing,
): readonly Account[] {
  const all = allAccountsIn(session, tenant);
  return listing?.including === 'all' ? all : all.filter((one) => one.active);
}

/**
 * The same accounts as a forest.
 *
 * A withdrawn account is withdrawn with everything under it — a group cannot
 * be withdrawn over an active child — so hiding withdrawn accounts hides whole
 * subtrees and never orphans a node.
 */
export function treeOf(
  session: RecordSession,
  tenant: TenantId,
  listing?: Listing,
): readonly AccountNode[] {
  const accounts = accountsIn(session, tenant, listing);
  const childrenOf = new Map<AccountId | null, Account[]>();
  for (const account of accounts) {
    const siblings = childrenOf.get(account.parent) ?? [];
    siblings.push(account);
    childrenOf.set(account.parent, siblings);
  }
  const build = (parent: AccountId | null): AccountNode[] =>
    (childrenOf.get(parent) ?? []).map((account) =>
      Object.freeze({ account, children: Object.freeze(build(account.id)) }),
    );
  return Object.freeze(build(null));
}

function hasChildren(
  session: RecordSession,
  tenant: TenantId,
  id: AccountId,
  listing?: Listing,
): boolean {
  return accountsIn(session, tenant, listing).some((one) => one.parent === id);
}

function codeTaken(session: RecordSession, tenant: TenantId, code: string): boolean {
  return allAccountsIn(session, tenant).some((one) => one.code === code);
}

/**
 * A parent an account may go under: present, in use, not reserved, and of the
 * same kind.
 *
 * Judged in that order so that the refusal names the first thing to fix. The
 * kind is checked last because it is the one an accountant cannot change — an
 * income account never goes under an asset, whatever else is done to either.
 *
 * A reserved account takes no children, because the system posts to it and
 * posts to leaves: a sub-account under merchandise inventory would turn the
 * account every stock movement resolves to into a group, and every movement
 * after that into a refusal. The accountant who wants to break inventory down
 * adds accounts **beside** it, under its group.
 */
function parentFor(
  session: RecordSession,
  tenant: TenantId,
  parent: AccountId,
  kind: AccountKind,
): Outcome<Account> {
  const found = accountIn(session, tenant, parent);
  if (found === null) return refuse('fin.account-not-found', { account: parent });
  if (!found.active) return refuse('fin.account-inactive', { account: parent });
  if (found.reserved !== null) {
    return refuse('fin.account-reserved', { account: parent, reserved: found.reserved });
  }
  if (found.kind !== kind) {
    return refuse('fin.account-kind-mismatch', { kind, parent, parentKind: found.kind });
  }
  return ok(found);
}

function store(session: RecordSession, account: Account): Account {
  return writeRecord(session, 'account', account.tenant, [account.id], account);
}

/**
 * A parent as it may actually arrive, judged: null is the one spelling of
 * "the roots", an identifier is read in the one case every record is filed
 * under (a UUID is case-insensitive by specification, and stored lower), and
 * anything else names no account at all.
 */
function parentArriving(parent: unknown): Outcome<AccountId | null> {
  if (parent === null) return ok(null);
  if (typeof parent !== 'string' || !isId(parent)) {
    return refuse('fin.account-not-found', { account: shown(parent) });
  }
  return ok(parseId<'account'>(parent));
}

export function addAccount(
  session: RecordSession,
  tenant: TenantId,
  input: NewAccount,
): Outcome<Account> {
  // Every field read as it may actually arrive rather than as the type
  // promises: the type is gone at run time, and a definition reaches this
  // module off a wire and out of a queue `SYN-02` replays.
  const { code, name, kind, parent } = input as Arriving;
  if (typeof code !== 'string' || !CODE.test(code)) {
    return refuse('fin.account-code-invalid', { code: shown(code) });
  }
  const trimmed = named(name);
  if (trimmed === null) return refuse('fin.account-name-required', { code });
  if (!isKind(kind)) return refuse('fin.account-kind-unknown', { kind: shown(kind) });
  const arriving = parentArriving(parent);
  if (!arriving.ok) return arriving;

  if (arriving.value !== null) {
    const under = parentFor(session, tenant, arriving.value, kind);
    if (!under.ok) return under;
  }
  if (codeTaken(session, tenant, code)) return refuse('fin.account-code-taken', { code });

  return ok(
    store(session, {
      id: newId<'account'>(),
      tenant,
      code,
      kind,
      parent: arriving.value,
      reserved: null,
      currency: null,
      seeded: null,
      name: trimmed,
      active: true,
    }),
  );
}

export function renameAccount(
  session: RecordSession,
  tenant: TenantId,
  id: AccountId,
  name: string,
): Outcome<Account> {
  const account = accountIn(session, tenant, id);
  if (account === null) return refuse('fin.account-not-found', { account: id });
  const trimmed = named(name);
  if (trimmed === null) return refuse('fin.account-name-required', { code: account.code });
  if (account.name === trimmed) return ok(account);
  return ok(store(session, { ...account, name: trimmed }));
}

/**
 * Whether `candidate` is `id` itself or sits anywhere beneath it.
 *
 * Walked upward from the candidate rather than downward from the account,
 * because a chart is wide and shallow: the path to a root is a handful of
 * reads, and the subtree below a root is the whole chart.
 */
function isWithin(
  session: RecordSession,
  tenant: TenantId,
  candidate: AccountId,
  id: AccountId,
): boolean {
  let current: AccountId | null = candidate;
  const seen = new Set<AccountId>();
  while (current !== null) {
    if (current === id) return true;
    // A store whose parent links loop has been damaged; stop rather than spin.
    if (seen.has(current)) return false;
    seen.add(current);
    current = accountIn(session, tenant, current)?.parent ?? null;
  }
  return false;
}

export function moveAccount(
  session: RecordSession,
  tenant: TenantId,
  id: AccountId,
  destination: AccountId | null,
): Outcome<Account> {
  const account = accountIn(session, tenant, id);
  if (account === null) return refuse('fin.account-not-found', { account: id });
  const arriving = parentArriving(destination);
  if (!arriving.ok) return arriving;
  const parent = arriving.value;
  if (account.parent === parent) return ok(account);

  if (parent !== null) {
    // Under itself, or under its own descendant, is checked before the parent
    // is judged: a cycle is a statement about the move rather than about the
    // destination, and the destination may be perfectly good on its own.
    if (isWithin(session, tenant, parent, id)) {
      return refuse('fin.account-cycle', { account: id, parent });
    }
    const under = parentFor(session, tenant, parent, account.kind);
    if (!under.ok) return under;
  }
  return ok(store(session, { ...account, parent }));
}

/**
 * Takes an account out of use, or puts it back. Neither deletes anything.
 *
 * Asking for the state it is already in is answered as done and writes nothing:
 * a button pressed twice, or a command `SYN-02` replays, must not fail.
 *
 * The way back mirrors the way in. `add` refuses a child under a withdrawn
 * parent, so `restore` refuses the same — the children of a withdrawn group
 * come back after it, never before. And `withdraw` refuses a group while any
 * child is in use, which is what makes that mirror hold: a withdrawn account
 * never has an active child.
 */
export function setAccountActive(
  session: RecordSession,
  tenant: TenantId,
  id: AccountId,
  active: boolean,
): Outcome<Account> {
  const account = accountIn(session, tenant, id);
  if (account === null) return refuse('fin.account-not-found', { account: id });
  if (account.active === active) return ok(account);

  if (!active) {
    if (account.reserved !== null) {
      return refuse('fin.account-reserved', { account: id, reserved: account.reserved });
    }
    if (hasChildren(session, tenant, id))
      return refuse('fin.account-has-children', { account: id });
  } else if (account.parent !== null) {
    const parent = accountIn(session, tenant, account.parent);
    // The parent is read, not trusted: a chart whose child names a parent that
    // is not there has been damaged, and putting the child back into use
    // would make the damage load-bearing.
    if (parent === null) return refuse('fin.account-not-found', { account: account.parent });
    if (!parent.active) return refuse('fin.account-inactive', { account: account.parent });
  }
  return ok(store(session, { ...account, active }));
}

/**
 * The first free code counting up from `from`: `from` itself, or the next
 * number of the same width, and so on for ninety-nine steps.
 *
 * For a cash account the count starts at `1101`, two digits of sequence under
 * the group's own code, because a shop has a handful of currencies and a code
 * an accountant can read as "the group, then the currency" is worth more than
 * room for a hundred. For a reserved seed whose own code the tenant has taken
 * it starts at that code, so the account lands beside where the seed meant it
 * to. Ninety-nine is the bound in both cases, and reaching it is a defect
 * rather than a refusal: it says a tenant has ninety-nine currencies, or
 * ninety-nine accounts in one seed's way, which no owner did on purpose.
 */
function freeCodeFrom(session: RecordSession, tenant: TenantId, from: string): string {
  const taken = new Set(allAccountsIn(session, tenant).map((one) => one.code));
  const width = from.length;
  const start = Number(from);
  for (let step = 0; step < 99; step += 1) {
    const code = String(start + step).padStart(width, '0');
    if (!taken.has(code)) return code;
  }
  throw new Error(`Tenant ${tenant} has no free code within ninety-nine of ${from}.`);
}

/**
 * Opens the cash account for a currency, unless one is open already.
 *
 * Called by the seed for every currency `FX` has, and again for every currency
 * `FX` announces afterwards. Idempotent on the currency, because the second
 * call is exactly the replayed command `SYN-02` promises — and a tenant whose
 * chart is not yet seeded gets nothing here: its seed will read the currency
 * from `FX` when it runs, and an account opened under a group that does not
 * exist would be an orphan.
 */
export function ensureCashAccount(
  session: RecordSession,
  tenant: TenantId,
  currency: CurrencyCode,
): Account | null {
  const accounts = allAccountsIn(session, tenant);
  const existing = accounts.find(
    (one) => one.reserved === PER_CURRENCY_ACCOUNT && one.currency === currency,
  );
  if (existing !== undefined) return existing;
  const group = accounts.find((one) => one.seeded === CASH_GROUP);
  if (group === undefined) return null;

  return store(session, {
    id: newId<'account'>(),
    tenant,
    code: freeCodeFrom(session, tenant, `${group.code.slice(0, -2)}01`),
    kind: group.kind,
    parent: group.id,
    reserved: PER_CURRENCY_ACCOUNT,
    currency,
    seeded: CASH_SEED,
    name: null,
    // As the group is. A shop with no currencies can withdraw the cash group,
    // and an account opened active beneath it would break the one rule
    // `restore` relies on — a withdrawn account never has an active child.
    active: group.active,
  });
}

/**
 * Installs the retail chart, adding only what is missing (see
 * `ChartAdministration.seed`).
 *
 * A seed is identified by the mark it leaves (`seeded`), never by its code: an
 * account the tenant renamed, moved or withdrew is still the seeded account
 * and is left exactly as it is. A seed whose code the tenant has already given
 * to an account of their own — a shop set up before a later version of the
 * product added that seed — is not installed over it. The tenant's account
 * stands, and the seed takes the next free code beside the one it meant to
 * take. Every seed, and not only the reserved ones: a group that stepped aside
 * would leave its children with no parent to go under, and a reserved account
 * that stepped aside would leave the system with nowhere to post — and
 * whether the tenant's account at that code *is* the rent account is nothing
 * this module can know. The tenant withdraws a seed it has no use for.
 *
 * A seed under a parent the tenant withdrew is still installed under it, and
 * arrives withdrawn too, so that the rule "a withdrawn account never has an
 * active child" holds through a seed as it holds through `restore`.
 */
export function seedChart(
  session: RecordSession,
  tenant: TenantId,
  currencies: readonly TenantCurrency[],
): readonly Account[] {
  const bySeed = new Map(
    allAccountsIn(session, tenant)
      .filter((one) => one.seeded !== null)
      .map((one) => [one.seeded, one] as const),
  );

  for (const definition of SEEDED_ACCOUNTS) {
    if (bySeed.has(definition.seed)) continue;
    const taken = codeTaken(session, tenant, definition.code);

    const parent = definition.under === null ? null : bySeed.get(definition.under);
    // The table lists every parent before its children and every parent is a
    // seed, so an absent parent is the table disagreeing with itself — a
    // defect in the product, identical in every shop.
    if (definition.under !== null && parent === undefined) {
      throw new Error(
        `The seeded account "${definition.seed}" sits under "${definition.under}", ` +
          'which the seed has not installed.',
      );
    }
    const account = store(session, {
      id: newId<'account'>(),
      tenant,
      code: taken ? freeCodeFrom(session, tenant, definition.code) : definition.code,
      kind: definition.kind,
      parent: parent?.id ?? null,
      reserved: definition.reserved ?? null,
      currency: null,
      seeded: definition.seed,
      name: null,
      active: parent?.active ?? true,
    });
    bySeed.set(definition.seed, account);
  }

  for (const currency of currencies) ensureCashAccount(session, tenant, currency.code);

  return accountsIn(session, tenant, { including: 'all' });
}

export function mappingsIn(session: RecordSession, tenant: TenantId): readonly AccountMapping[] {
  return scanRecords(session, 'mapping', tenant).sort((one, other) =>
    one.role < other.role ? -1 : one.role > other.role ? 1 : 0,
  );
}

/**
 * The declaration behind a role, in this edition.
 *
 * A role no module declared is refused rather than mapped: a mapping for it
 * would be a row nothing reads, and a posting to it would be a module this
 * edition does not have.
 */
function declarationOf(
  declared: readonly AccountRoleDeclaration[],
  role: string,
): Outcome<AccountRoleDeclaration> {
  const found = declared.find((one) => one.role === role);
  return found === undefined ? refuse('fin.account-role-undeclared', { role }) : ok(found);
}

/**
 * An account a role may post to: present, in use, and a leaf.
 *
 * A group takes no postings — the posting engine of `FIN-02` refuses it — so
 * mapping onto one, or resolving onto one that has since gained children, is
 * refused here with the same word.
 */
function postable(session: RecordSession, tenant: TenantId, id: AccountId): Outcome<Account> {
  const account = accountIn(session, tenant, id);
  if (account === null) return refuse('fin.account-not-found', { account: id });
  if (!account.active) return refuse('fin.account-inactive', { account: id });
  if (hasChildren(session, tenant, id, { including: 'all' })) {
    return refuse('fin.account-is-group', { account: id });
  }
  return ok(account);
}

export function mapRole(
  session: RecordSession,
  tenant: TenantId,
  declared: readonly AccountRoleDeclaration[],
  role: string,
  account: AccountId,
): Outcome<AccountMapping> {
  const declaration = declarationOf(declared, role);
  if (!declaration.ok) return declaration;
  const { reserved, normalBalance } = declaration.value;
  if (reserved !== undefined) return refuse('fin.account-role-reserved', { role, reserved });

  const target = postable(session, tenant, account);
  if (!target.ok) return target;
  if (normalBalanceOf(target.value.kind) !== normalBalance) {
    return refuse('fin.account-normal-balance-mismatch', {
      role,
      normalBalance,
      account,
      kind: target.value.kind,
    });
  }

  return ok(writeRecord(session, 'mapping', tenant, [role], { tenant, role, account }));
}

/**
 * The account a role posts to, in this tenant (see `ChartOfAccounts.resolve`).
 *
 * A reserved purpose is found by its mark on the account, never by code or by
 * seed: the accountant may have renamed and moved the account, and it is still
 * the one. Cash is found by its mark and its currency.
 *
 * What comes back is always an account a posting may land in — in use, and a
 * leaf — or the refusal saying why not. A reserved account is a leaf by
 * construction and cannot be withdrawn, but a cash account opened under a
 * withdrawn group arrives withdrawn, and the answer for it is the same one a
 * mapped account gets: `fin.account-inactive`, here, so that the posting
 * engine has one place to ask and one answer to act on.
 */
export function resolveRole(
  session: RecordSession,
  tenant: TenantId,
  declared: readonly AccountRoleDeclaration[],
  role: string,
  currency?: CurrencyCode,
): Outcome<Account> {
  const declaration = declarationOf(declared, role);
  if (!declaration.ok) return declaration;
  const { reserved } = declaration.value;

  if (reserved === undefined) {
    const mapping = readRecord(session, 'mapping', tenant, [role]);
    if (mapping === null) return refuse('fin.account-role-unmapped', { role });
    return postable(session, tenant, mapping.account);
  }

  const accounts = allAccountsIn(session, tenant);
  // Unseeded is "the seed never ran", not "there are no accounts": a tenant may
  // add accounts of its own before the seed runs, and none of them is reserved.
  if (!accounts.some((one) => one.seeded !== null)) {
    return refuse('fin.chart-unseeded', { role, reserved });
  }

  if (reserved === PER_CURRENCY_ACCOUNT) {
    if (currency === undefined) return refuse('fin.currency-required', { role });
    const cash = accounts.find((one) => one.reserved === reserved && one.currency === currency);
    if (cash === undefined) return refuse('fin.account-for-currency-missing', { role, currency });
    return postable(session, tenant, cash.id);
  }

  const account = accounts.find((one) => one.reserved === reserved);
  // Every purpose but cash is seeded exactly once, whatever code it has to
  // take, and cannot be withdrawn — so a seeded chart with no account for a
  // purpose has been damaged.
  if (account === undefined) {
    throw new Error(`Tenant ${tenant} has a chart and no account reserved for ${reserved}.`);
  }
  return postable(session, tenant, account.id);
}
