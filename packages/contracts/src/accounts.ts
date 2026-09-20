/**
 * The purposes of `FIN-01`'s system-reserved accounts, as a name any module is
 * allowed to say.
 *
 * `FIN` owns the chart of accounts, and every tenant's chart is its own: the
 * inventory account is `1310` in one shop and `1.3.1` in the next (`FIN-01`).
 * So a module never posts to a code. It declares an account **role** —
 * `stk.inventory` — and `FIN` maps the role to whichever account the tenant
 * keeps for that purpose (`@vertex/platform`'s `AccountRoleDeclaration`).
 *
 * That mapping has to come from somewhere, and for the reserved accounts it
 * must not come from a person: `FIN-01` marks them precisely so that the
 * inventory posted by `STK`, the shrinkage posted by `CNT` and the payable
 * raised by `PUR` land in accounts the tenant cannot delete and did not have
 * to configure. A declaration therefore names the **purpose** it expects, and
 * `FIN` resolves the purpose to the reserved account it seeded for it — without
 * `FIN` ever learning that `STK` exists, and without `STK` importing `FIN`,
 * which `modules.md` §3 does not let it do.
 *
 * It cannot live in `FIN`'s contract, for the reason `SEEDED_ROLES` cannot live
 * in `SEC`'s: `FIN` depends on `FX`, and `FX` posts a rounding residual
 * (`FX-07`), so an `FX` that imported `FIN` to name that purpose would be the
 * cycle `modules.md` §4 exists to prevent. The names are vocabulary shared by
 * everyone and owned by nobody, which is what this package is for.
 *
 * **Nine, where the feature lists seven.** `FIN-01` names inventory, cost of
 * goods sold, receivables, payables, cash per currency, FX gain and loss, and
 * shrinkage. Two more are reserved because two other features cannot work
 * without them: `FX-07` posts every rounding residual "to a rounding account so
 * totals never drift", and `FIN-06` needs an equity account for the opening
 * journal entry to balance against. An account a feature depends on and a
 * tenant can delete is a feature that stops working one afternoon with nothing
 * to say why.
 *
 * `cash` is the one purpose that resolves **per currency**: `FIN-01` says "cash
 * per currency", and a role reserved for it is resolved with a currency in
 * hand, to that currency's own account.
 */
export const RESERVED_ACCOUNTS = Object.freeze([
  'inventory',
  'cogs',
  'receivables',
  'payables',
  'cash',
  'fx-gain-loss',
  'shrinkage',
  'rounding',
  'opening-equity',
] as const);

export type ReservedAccount = (typeof RESERVED_ACCOUNTS)[number];

const RESERVED: ReadonlySet<string> = new Set(RESERVED_ACCOUNTS);

export function isReservedAccount(value: string): value is ReservedAccount {
  return RESERVED.has(value);
}

/** The one purpose whose account is resolved with a currency, not on its own. */
export const PER_CURRENCY_ACCOUNT: ReservedAccount = 'cash';
