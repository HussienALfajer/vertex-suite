import type { ReservedAccount } from '@vertex/contracts';

import type { AccountKind } from './contract.js';

/**
 * The retail chart of accounts a tenant finds on its first morning (`FIN-01`).
 *
 * A **seed and not a rule**. From the moment they exist these are ordinary rows
 * the accountant renames, moves under other groups, adds beside and withdraws
 * from use — with one exception the feature itself states: the accounts the
 * system posts to are marked reserved and cannot be withdrawn, because a
 * stock movement that has nowhere to post is a shop that has stopped.
 *
 * **The codes are a convention and nothing branches on them.** The tree is the
 * `parent` link, not the leading digit; an accountant who moves `1310` under
 * `1100` has moved it, and the code goes with it as a label. They are four
 * digits in the shape most of the region's accountants learned — assets in the
 * thousands, liabilities in the two thousands, and so on — so a chart printed
 * from here reads as a chart and not as a list.
 *
 * **Cash is not in this table.** `FIN-01` keeps one cash account per currency,
 * and which currencies a tenant has is `FX`'s to know: the seed asks it, and
 * opens one account under `cash-and-bank` for each, under the codes `1101`
 * upward in the order `FX` lists them. A currency defined later is announced
 * (`fx.currency-defined`) and gets the next code the same way.
 *
 * **Nine reserved accounts, where the feature lists seven.** The two beyond
 * `FIN-01`'s list — `rounding` and `opening-equity` — are reserved because two
 * other features cannot work without them: every residual of `FX-07` is posted
 * to the one, and the opening journal entry of `FIN-06` balances against the
 * other. `@vertex/contracts` says why they are named there and not here.
 *
 * **Retail-oriented, not exhaustive.** A shop's daily postings — sales, cost of
 * goods, rent, wages, utilities, transport, bank charges — have an account
 * waiting; a fixed-asset register, depreciation schedules and tax accounts do
 * not, because the product has no tax engine and a shop that needs a
 * depreciation account adds one under `1400` in a minute. The seed states the
 * market this product is first sold into and stops there.
 *
 * Every name is a terminology key (`account.<seed>`), never a sentence: a
 * seeded account is displayed through the terminology layer until the tenant
 * renames it (`design-system.md` §12), and it is the same key in both of the
 * product's languages.
 */
export interface SeededAccount {
  /** The terminology key, and the mark the seed leaves on the account it made. */
  readonly seed: string;
  readonly code: string;
  readonly kind: AccountKind;
  /** The seed of the parent, or null for the root of a kind. */
  readonly under: string | null;
  readonly reserved?: ReservedAccount;
}

/** Where the per-currency cash accounts are opened, and the seed they carry. */
export const CASH_GROUP = 'cash-and-bank';
export const CASH_SEED = 'cash';

/**
 * In the order they are installed: a parent always before its children, so
 * that the seed can install top to bottom in one pass and a partial install
 * — interrupted, then replayed — never leaves a child whose parent is not yet
 * there.
 */
export const SEEDED_ACCOUNTS: readonly SeededAccount[] = Object.freeze([
  // Assets
  { seed: 'assets', code: '1000', kind: 'asset', under: null },
  { seed: CASH_GROUP, code: '1100', kind: 'asset', under: 'assets' },
  { seed: 'receivables', code: '1200', kind: 'asset', under: 'assets' },
  {
    seed: 'trade-receivables',
    code: '1210',
    kind: 'asset',
    under: 'receivables',
    reserved: 'receivables',
  },
  { seed: 'inventory', code: '1300', kind: 'asset', under: 'assets' },
  {
    seed: 'merchandise-inventory',
    code: '1310',
    kind: 'asset',
    under: 'inventory',
    reserved: 'inventory',
  },
  { seed: 'equipment-and-fixtures', code: '1400', kind: 'asset', under: 'assets' },

  // Liabilities
  { seed: 'liabilities', code: '2000', kind: 'liability', under: null },
  { seed: 'payables', code: '2100', kind: 'liability', under: 'liabilities' },
  {
    seed: 'trade-payables',
    code: '2110',
    kind: 'liability',
    under: 'payables',
    reserved: 'payables',
  },
  { seed: 'accrued-expenses', code: '2200', kind: 'liability', under: 'liabilities' },
  { seed: 'loans', code: '2300', kind: 'liability', under: 'liabilities' },

  // Equity
  { seed: 'equity', code: '3000', kind: 'equity', under: null },
  { seed: 'owner-capital', code: '3100', kind: 'equity', under: 'equity' },
  {
    seed: 'opening-balance-equity',
    code: '3200',
    kind: 'equity',
    under: 'equity',
    reserved: 'opening-equity',
  },
  { seed: 'owner-drawings', code: '3300', kind: 'equity', under: 'equity' },

  // Income
  { seed: 'income', code: '4000', kind: 'income', under: null },
  { seed: 'sales-revenue', code: '4100', kind: 'income', under: 'income' },
  { seed: 'sales-returns-and-discounts', code: '4200', kind: 'income', under: 'income' },
  { seed: 'other-income', code: '4300', kind: 'income', under: 'income' },
  // A gain or a loss, on one account: the sign says which, and a statement
  // reads it under income either way, as the region's accountants expect
  // "فروقات أسعار الصرف" to be read.
  { seed: 'fx-gain-loss', code: '4400', kind: 'income', under: 'income', reserved: 'fx-gain-loss' },
  {
    seed: 'rounding-differences',
    code: '4500',
    kind: 'income',
    under: 'income',
    reserved: 'rounding',
  },

  // Expenses
  { seed: 'expenses', code: '5000', kind: 'expense', under: null },
  {
    seed: 'cost-of-goods-sold',
    code: '5100',
    kind: 'expense',
    under: 'expenses',
    reserved: 'cogs',
  },
  {
    seed: 'inventory-shrinkage',
    code: '5200',
    kind: 'expense',
    under: 'expenses',
    reserved: 'shrinkage',
  },
  { seed: 'salaries-and-wages', code: '5300', kind: 'expense', under: 'expenses' },
  { seed: 'rent', code: '5400', kind: 'expense', under: 'expenses' },
  { seed: 'utilities', code: '5500', kind: 'expense', under: 'expenses' },
  { seed: 'transport-and-delivery', code: '5600', kind: 'expense', under: 'expenses' },
  { seed: 'bank-charges', code: '5700', kind: 'expense', under: 'expenses' },
  { seed: 'other-expenses', code: '5800', kind: 'expense', under: 'expenses' },
]);
