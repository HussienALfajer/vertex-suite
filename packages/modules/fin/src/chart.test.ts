import { RESERVED_ACCOUNTS, type ReservedAccount } from '@vertex/contracts';
import { isOk, newId, type Refusal, type Result } from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACCOUNT_KINDS,
  FIN_PERMISSION_SEEDS,
  FIN_PERMISSIONS,
  type Account,
  type AccountNode,
} from './contract.js';
import {
  CASH_ROLE,
  COGS_ROLE,
  EXPENSE_ROLE,
  INVENTORY_ROLE,
  installFin,
  REVENUE_ROLE,
  UNDECLARED_ROLE,
  type Installed,
} from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code}`);
}

function refusalOf(result: Result<unknown, Refusal>): Refusal {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error;
}

function codesOf(accounts: readonly Account[]): readonly string[] {
  return accounts.map((one) => one.code);
}

function reserved(accounts: readonly Account[], purpose: ReservedAccount): readonly Account[] {
  return accounts.filter((one) => one.reserved === purpose);
}

function seeded(accounts: readonly Account[], seed: string): Account {
  const found = accounts.find((one) => one.seeded === seed);
  if (found === undefined) throw new Error(`No seeded account "${seed}".`);
  return found;
}

/** Every account in a forest, depth first, as a screen would draw it. */
function flatten(nodes: readonly AccountNode[]): readonly Account[] {
  return nodes.flatMap((node) => [node.account, ...flatten(node.children)]);
}

let fin: Installed;

beforeEach(() => {
  fin = installFin();
});

describe('Chart of accounts — FIN-01', () => {
  it('seeds a retail-oriented chart on tenant creation, as a tree of the five kinds', async () => {
    const chart = taken(await fin.admin.seed(fin.system));

    expect(await fin.chart.accounts(fin.by)).toEqual(chart);
    for (const account of chart) {
      expect(account.tenant).toBe(fin.tenant);
      expect(account.active).toBe(true);
      // Seeded, and displayed through the terminology layer until renamed.
      expect(account.seeded).not.toBeNull();
      expect(account.name).toBeNull();
    }
    expect(new Set(codesOf(chart)).size).toBe(chart.length);

    // One root per kind, and every account under the root of its own kind.
    const roots = (await fin.chart.tree(fin.by)).map((node) => node.account);
    expect(roots.map((one) => one.kind)).toEqual([...ACCOUNT_KINDS]);
    expect(roots.every((one) => one.parent === null)).toBe(true);
    for (const node of await fin.chart.tree(fin.by)) {
      for (const account of flatten(node.children)) expect(account.kind).toBe(node.account.kind);
    }

    // Retail-oriented: the accounts a shop posts to every day are there by
    // name, not only the reserved ones.
    for (const seed of ['sales-revenue', 'cost-of-goods-sold', 'rent', 'salaries-and-wages']) {
      expect(seeded(chart, seed)).toBeDefined();
    }
  });

  it('marks the system-reserved accounts, one for each purpose and one cash account per currency', async () => {
    const chart = taken(await fin.admin.seed(fin.system));

    for (const purpose of RESERVED_ACCOUNTS) {
      if (purpose === 'cash') continue;
      const [account, ...others] = reserved(chart, purpose);
      expect(account, purpose).toBeDefined();
      expect(others, purpose).toEqual([]);
      expect(account?.currency).toBeNull();
    }

    // FIN-01: cash **per currency** — every currency the tenant has, in code
    // order, each under the cash group, and none twice.
    const cash = reserved(chart, 'cash');
    expect(cash.map((one) => one.currency)).toEqual(['EUR', 'SYP', 'TRY', 'USD']);
    expect(new Set(cash.map((one) => one.parent)).size).toBe(1);
    expect(cash.every((one) => one.kind === 'asset')).toBe(true);

    // The kinds a statement needs them under.
    expect(reserved(chart, 'inventory')[0]?.kind).toBe('asset');
    expect(reserved(chart, 'receivables')[0]?.kind).toBe('asset');
    expect(reserved(chart, 'payables')[0]?.kind).toBe('liability');
    expect(reserved(chart, 'opening-equity')[0]?.kind).toBe('equity');
    expect(reserved(chart, 'cogs')[0]?.kind).toBe('expense');
    expect(reserved(chart, 'shrinkage')[0]?.kind).toBe('expense');
    expect(reserved(chart, 'fx-gain-loss')[0]?.kind).toBe('income');
    expect(reserved(chart, 'rounding')[0]?.kind).toBe('income');

    // Marked, as the feature says, and every other account is not.
    expect(chart.filter((one) => one.reserved !== null)).toHaveLength(
      RESERVED_ACCOUNTS.length - 1 + cash.length,
    );
  });

  it('seeds once: a replayed seed adds nothing and keeps what the tenant changed', async () => {
    const first = taken(await fin.admin.seed(fin.system));
    const rent = seeded(first, 'rent');
    taken(await fin.admin.rename(fin.by, rent.id, 'إيجار المحل'));
    taken(await fin.admin.withdraw(fin.by, seeded(first, 'bank-charges').id));

    const again = taken(await fin.admin.seed(fin.system));

    expect(again).toHaveLength(first.length);
    expect(again.find((one) => one.id === rent.id)?.name).toBe('إيجار المحل');
    expect(codesOf(await fin.chart.accounts(fin.by, { including: 'all' }))).toEqual(codesOf(first));
    expect(codesOf(await fin.chart.accounts(fin.by))).toHaveLength(first.length - 1);
  });

  it('does not install a seed over an account the tenant already keeps at that code', async () => {
    // A shop set up before a later product version added a seed at this code
    // has its own account there — here, a tenant with accounts at rent's code
    // and at merchandise inventory's before the seed ever ran. The tenant's
    // accounts stand; each seed takes the next free code beside its own, the
    // reserved one included, because the system posts to it.
    const mine = taken(
      await fin.admin.add(fin.by, {
        code: '5400',
        name: 'دعاية وإعلان',
        kind: 'expense',
        parent: null,
      }),
    );
    const stock = taken(
      await fin.admin.add(fin.by, {
        code: '1310',
        name: 'مخزون قديم',
        kind: 'asset',
        parent: null,
      }),
    );

    const chart = taken(await fin.admin.seed(fin.system));
    expect(chart.find((one) => one.code === '5400')).toEqual(mine);
    expect(seeded(chart, 'rent')).toMatchObject({
      code: '5401',
      parent: seeded(chart, 'expenses').id,
    });
    expect(chart.find((one) => one.code === '1310')).toEqual(stock);
    expect(reserved(chart, 'inventory')[0]).toMatchObject({
      code: '1311',
      seeded: 'merchandise-inventory',
      parent: seeded(chart, 'inventory').id,
    });
    expect(taken(await fin.chart.resolve(fin.by, INVENTORY_ROLE)).code).toBe('1311');
    expect(seeded(chart, 'utilities')).toBeDefined();
    expect(new Set(codesOf(chart)).size).toBe(chart.length);
  });

  it('keeps each tenant’s chart to itself', async () => {
    taken(await fin.admin.seed(fin.system));
    expect(await fin.chart.accounts(fin.byOther)).toEqual([]);

    const theirs = taken(await fin.admin.seed(fin.byOther));
    expect(theirs.every((one) => one.tenant === fin.otherTenant)).toBe(true);
    // Their cash accounts are for their currencies, not ours.
    expect(reserved(theirs, 'cash').map((one) => one.currency)).toEqual(['USD']);

    const inventory = reserved(theirs, 'inventory')[0]!;
    expect(await fin.chart.account(fin.by, inventory.id)).toBeNull();
    expect(refusalOf(await fin.admin.rename(fin.by, inventory.id, 'x')).code).toBe(
      'fin.account-not-found',
    );
  });

  it('refuses to delete a reserved account, and withdraws an ordinary one from use', async () => {
    const chart = taken(await fin.admin.seed(fin.system));

    for (const account of chart.filter((one) => one.reserved !== null)) {
      expect(refusalOf(await fin.admin.withdraw(fin.by, account.id))).toEqual({
        code: 'fin.account-reserved',
        values: { account: account.id, reserved: account.reserved },
      });
    }

    const rent = seeded(chart, 'rent');
    const withdrawn = taken(await fin.admin.withdraw(fin.by, rent.id));
    expect(withdrawn).toEqual({ ...rent, active: false });
    // Still there — a line posted last year names it — and answered as done twice.
    expect(await fin.chart.account(fin.by, rent.id)).toEqual(withdrawn);
    expect(taken(await fin.admin.withdraw(fin.by, rent.id))).toEqual(withdrawn);
    expect(refusalOf(await fin.admin.withdraw(fin.by, newId<'account'>())).code).toBe(
      'fin.account-not-found',
    );
  });

  it('is editable as a tree: adds under a parent of its kind, and refuses what no statement could place', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const cashGroup = seeded(chart, 'cash-and-bank');

    const bank = taken(
      await fin.admin.add(fin.by, {
        code: '1150',
        name: ' حساب البنك ',
        kind: 'asset',
        parent: cashGroup.id,
      }),
    );
    expect(bank).toEqual({
      id: bank.id,
      tenant: fin.tenant,
      code: '1150',
      kind: 'asset',
      parent: cashGroup.id,
      reserved: null,
      currency: null,
      seeded: null,
      name: 'حساب البنك',
      active: true,
    });
    expect(Object.isFrozen(bank)).toBe(true);

    const under = (input: Partial<Parameters<typeof fin.admin.add>[1]>) =>
      fin.admin.add(fin.by, {
        code: '1160',
        name: 'x',
        kind: 'asset',
        parent: cashGroup.id,
        ...input,
      });

    expect(refusalOf(await under({ kind: 'income' }))).toEqual({
      code: 'fin.account-kind-mismatch',
      values: { kind: 'income', parent: cashGroup.id, parentKind: 'asset' },
    });
    expect(refusalOf(await under({ code: '1150' }))).toEqual({
      code: 'fin.account-code-taken',
      values: { code: '1150' },
    });
    for (const code of ['', ' 1160', '11 60', '١١٦٠', 'a'.repeat(33)]) {
      expect(refusalOf(await under({ code })).code, JSON.stringify(code)).toBe(
        'fin.account-code-invalid',
      );
    }
    for (const name of ['', '   ', '---', '1160']) {
      expect(refusalOf(await under({ name })).code, JSON.stringify(name)).toBe(
        'fin.account-name-required',
      );
    }
    expect(refusalOf(await under({ kind: 'revenue' as 'income' })).code).toBe(
      'fin.account-kind-unknown',
    );
    const missing = newId<'account'>();
    expect(refusalOf(await under({ parent: missing }))).toEqual({
      code: 'fin.account-not-found',
      values: { account: missing },
    });

    // A reserved account takes no child: the system posts to it as a leaf,
    // and a breakdown of inventory goes beside it, under its group.
    const inventory = reserved(chart, 'inventory')[0]!;
    expect(
      refusalOf(
        await fin.admin.add(fin.by, {
          code: '1311',
          name: 'x',
          kind: 'asset',
          parent: inventory.id,
        }),
      ),
    ).toEqual({
      code: 'fin.account-reserved',
      values: { account: inventory.id, reserved: 'inventory' },
    });

    // A parent withdrawn from use takes no new child.
    const loans = seeded(chart, 'loans');
    taken(await fin.admin.withdraw(fin.by, loans.id));
    expect(
      refusalOf(
        await fin.admin.add(fin.by, {
          code: '2310',
          name: 'x',
          kind: 'liability',
          parent: loans.id,
        }),
      ),
    ).toEqual({ code: 'fin.account-inactive', values: { account: loans.id } });

    // Codes are the tenant's own shape: dotted and dashed ones are codes too.
    for (const code of ['1.1.50', '1100-B', 'B1']) {
      taken(await fin.admin.add(fin.by, { code, name: 'x', kind: 'asset', parent: cashGroup.id }));
    }
  });

  it('adds a new root, and lists roots and siblings in code order', async () => {
    taken(await fin.admin.seed(fin.system));

    const root = taken(
      await fin.admin.add(fin.by, { code: '999', name: 'أصول أخرى', kind: 'asset', parent: null }),
    );
    expect(root.parent).toBeNull();

    // Numeric codes order as numbers, so 999 comes before 1000 rather than
    // after 5000 — an accountant reads a chart in code order and a list that
    // put a three-digit code last would be a list nobody could find anything in.
    const roots = (await fin.chart.tree(fin.by)).map((node) => node.account.code);
    expect(roots).toEqual(['999', '1000', '2000', '3000', '4000', '5000']);
    expect(codesOf(await fin.chart.accounts(fin.by))[0]).toBe('999');
  });

  it('renames, and a seeded account renamed is displayed as the tenant named it', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const inventory = reserved(chart, 'inventory')[0]!;

    // Reserved accounts are renamed freely: the mark is the purpose, not the name.
    const renamed = taken(await fin.admin.rename(fin.by, inventory.id, ' بضاعة المستودع '));
    expect(renamed).toEqual({ ...inventory, name: 'بضاعة المستودع' });
    expect(renamed.seeded).toBe(inventory.seeded);

    expect(refusalOf(await fin.admin.rename(fin.by, inventory.id, ' ')).code).toBe(
      'fin.account-name-required',
    );
    expect(refusalOf(await fin.admin.rename(fin.by, newId<'account'>(), 'x')).code).toBe(
      'fin.account-not-found',
    );
  });

  it('moves a subtree, and refuses a move under itself, under a descendant, or across kinds', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const receivables = seeded(chart, 'receivables');
    const trade = reserved(chart, 'receivables')[0]!;
    const assets = seeded(chart, 'assets');
    const liabilities = seeded(chart, 'liabilities');

    // A group moved carries its children: the reserved account under it is
    // still under it, and still resolves.
    const moved = taken(await fin.admin.move(fin.by, receivables.id, null));
    expect(moved).toEqual({ ...receivables, parent: null });
    expect((await fin.chart.account(fin.by, trade.id))?.parent).toBe(receivables.id);
    expect((await fin.chart.tree(fin.by)).map((node) => node.account.code)).toContain(
      receivables.code,
    );
    taken(await fin.admin.move(fin.by, receivables.id, assets.id));

    expect(refusalOf(await fin.admin.move(fin.by, receivables.id, receivables.id))).toEqual({
      code: 'fin.account-cycle',
      values: { account: receivables.id, parent: receivables.id },
    });
    expect(refusalOf(await fin.admin.move(fin.by, assets.id, trade.id)).code).toBe(
      'fin.account-cycle',
    );
    expect(refusalOf(await fin.admin.move(fin.by, seeded(chart, 'loans').id, trade.id)).code).toBe(
      'fin.account-reserved',
    );
    expect(refusalOf(await fin.admin.move(fin.by, receivables.id, liabilities.id))).toEqual({
      code: 'fin.account-kind-mismatch',
      values: { kind: 'asset', parent: liabilities.id, parentKind: 'liability' },
    });
    const missing = newId<'account'>();
    expect(refusalOf(await fin.admin.move(fin.by, receivables.id, missing)).code).toBe(
      'fin.account-not-found',
    );
    // Under a withdrawn parent is refused, as adding under one is.
    taken(await fin.admin.withdraw(fin.by, seeded(chart, 'loans').id));
    expect(
      refusalOf(
        await fin.admin.move(
          fin.by,
          seeded(chart, 'accrued-expenses').id,
          seeded(chart, 'loans').id,
        ),
      ).code,
    ).toBe('fin.account-inactive');
    // Moving to where it already is changes nothing and is answered as done.
    expect(taken(await fin.admin.move(fin.by, trade.id, receivables.id))).toEqual(
      await fin.chart.account(fin.by, trade.id),
    );
  });

  it('withdraws a group only after its children, and restores under the checks the way in makes', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const rent = seeded(chart, 'rent');
    const cashGroup = seeded(chart, 'cash-and-bank');
    const bank = taken(
      await fin.admin.add(fin.by, { code: '1150', name: 'x', kind: 'asset', parent: cashGroup.id }),
    );
    const savings = taken(
      await fin.admin.add(fin.by, { code: '1151', name: 'x', kind: 'asset', parent: bank.id }),
    );

    expect(refusalOf(await fin.admin.withdraw(fin.by, bank.id))).toEqual({
      code: 'fin.account-has-children',
      values: { account: bank.id },
    });
    taken(await fin.admin.withdraw(fin.by, savings.id));
    taken(await fin.admin.withdraw(fin.by, bank.id));

    // The way back mirrors the way in: a child cannot come back under a parent
    // that is still withdrawn, and the parent comes back first.
    expect(refusalOf(await fin.admin.restore(fin.by, savings.id))).toEqual({
      code: 'fin.account-inactive',
      values: { account: bank.id },
    });
    expect(taken(await fin.admin.restore(fin.by, bank.id))).toEqual({ ...bank, active: true });
    expect(taken(await fin.admin.restore(fin.by, savings.id))).toEqual({
      ...savings,
      active: true,
    });
    expect(taken(await fin.admin.restore(fin.by, savings.id))).toEqual({
      ...savings,
      active: true,
    });

    // A withdrawn account is hidden from the ordinary listing and the tree,
    // shown when every account is asked for, and still read by its id.
    taken(await fin.admin.withdraw(fin.by, rent.id));
    expect(codesOf(await fin.chart.accounts(fin.by))).not.toContain(rent.code);
    expect(codesOf(await fin.chart.accounts(fin.by, { including: 'all' }))).toContain(rent.code);
    expect(codesOf(flatten(await fin.chart.tree(fin.by)))).not.toContain(rent.code);
    expect(codesOf(flatten(await fin.chart.tree(fin.by, { including: 'all' })))).toContain(
      rent.code,
    );
    expect(refusalOf(await fin.admin.restore(fin.by, newId<'account'>())).code).toBe(
      'fin.account-not-found',
    );
  });

  it('opens a cash account for a currency defined after the chart was seeded, and only once', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const cashGroup = seeded(chart, 'cash-and-bank');

    await fin.defineCurrency('AED');

    // In code order, which is the order the accounts were opened in: the
    // four the seed gave out, then the one opened today.
    const cash = reserved(await fin.chart.accounts(fin.by), 'cash');
    expect(cash.map((one) => one.currency)).toEqual(['EUR', 'SYP', 'TRY', 'USD', 'AED']);
    const aed = cash.find((one) => one.currency === 'AED')!;
    expect(aed).toMatchObject({
      parent: cashGroup.id,
      kind: 'asset',
      reserved: 'cash',
      seeded: 'cash',
      name: null,
      active: true,
    });
    // The next free code under the group, after the four the seed gave out.
    expect(codesOf(cash)).toEqual(['1101', '1102', '1103', '1104', '1105']);

    // Announced again — a replayed command, a seed run twice — it opens nothing.
    await fin.defineCurrency('AED');
    expect(reserved(await fin.chart.accounts(fin.by), 'cash')).toEqual(cash);

    // And the other tenant's currency is the other tenant's account.
    await fin.defineCurrency('AED', { tenant: fin.otherTenant });
    expect(reserved(await fin.chart.accounts(fin.by), 'cash')).toEqual(cash);
  });

  it('opens a cash account for a currency the shop no longer takes, because its amounts still exist', async () => {
    fin.withdrawCurrency('TRY');
    const chart = taken(await fin.admin.seed(fin.system));
    expect(reserved(chart, 'cash').map((one) => one.currency)).toEqual([
      'EUR',
      'SYP',
      'TRY',
      'USD',
    ]);
  });

  it('opens a cash account under a withdrawn cash group as withdrawn, so the way back stays whole', async () => {
    // A shop with no currencies at all can withdraw the cash group, which no
    // reserved account then protects.
    fin.forgetCurrencies();
    const chart = taken(await fin.admin.seed(fin.system));
    expect(reserved(chart, 'cash')).toEqual([]);
    const cashGroup = seeded(chart, 'cash-and-bank');
    taken(await fin.admin.withdraw(fin.by, cashGroup.id));

    await fin.defineCurrency('USD');

    const usd = reserved(await fin.chart.accounts(fin.by, { including: 'all' }), 'cash')[0]!;
    expect(usd).toMatchObject({ currency: 'USD', parent: cashGroup.id, active: false });
    // Withdrawn, so nothing posts to it: the one answer the engine acts on.
    expect(refusalOf(await fin.chart.resolve(fin.by, CASH_ROLE, 'USD'))).toEqual({
      code: 'fin.account-inactive',
      values: { account: usd.id },
    });
    // Reserved, so it cannot be withdrawn; under a withdrawn group, so it
    // comes back only after the group does — as any child would.
    expect(refusalOf(await fin.admin.restore(fin.by, usd.id)).code).toBe('fin.account-inactive');
    taken(await fin.admin.restore(fin.by, cashGroup.id));
    expect(taken(await fin.admin.restore(fin.by, usd.id)).active).toBe(true);
    expect(refusalOf(await fin.admin.withdraw(fin.by, cashGroup.id)).code).toBe(
      'fin.account-has-children',
    );
  });

  it('opens the account even when its first attempt loses a race, as it can on a shop’s first morning', async () => {
    taken(await fin.admin.seed(fin.system));

    // The subscriber's transaction is refused once — the store changed under
    // it — and nothing but the subscriber itself would ever run it again.
    await fin.defineCurrency('AED', { raced: true });

    const cash = reserved(await fin.chart.accounts(fin.by), 'cash');
    expect(cash.map((one) => one.currency)).toEqual(['EUR', 'SYP', 'TRY', 'USD', 'AED']);
    expect(cash.filter((one) => one.currency === 'AED')).toHaveLength(1);
  });

  it('leaves a currency announced before the chart exists to the seed', async () => {
    // FX seeded first, FIN after — the order an edition activates them in.
    await fin.defineCurrency('AED');
    expect(await fin.chart.accounts(fin.by)).toEqual([]);

    const chart = taken(await fin.admin.seed(fin.system));
    expect(reserved(chart, 'cash').map((one) => one.currency)).toEqual([
      'AED',
      'EUR',
      'SYP',
      'TRY',
      'USD',
    ]);
  });
});

describe('Account roles, resolved to the tenant’s own accounts — FIN-01', () => {
  it('resolves a role reserved for a purpose to the reserved account, with nobody asked', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    fin.answers(() => false);

    expect(taken(await fin.chart.resolve(fin.by, INVENTORY_ROLE))).toEqual(
      reserved(chart, 'inventory')[0],
    );
    expect(taken(await fin.chart.resolve(fin.by, COGS_ROLE))).toEqual(reserved(chart, 'cogs')[0]);
    // FX's own residual, declared by FX and reserved for the purpose FIN seeds.
    expect(taken(await fin.chart.resolve(fin.by, 'fx.rounding'))).toEqual(
      reserved(chart, 'rounding')[0],
    );
    // And this module's own: the opening balances of FIN-06 balance against it.
    expect(taken(await fin.chart.resolve(fin.by, 'fin.opening-balance-equity'))).toEqual(
      reserved(chart, 'opening-equity')[0],
    );
    // Renamed or moved, the purpose still resolves: the mark is the purpose.
    const inventory = reserved(chart, 'inventory')[0]!;
    fin.answers(() => true);
    taken(await fin.admin.rename(fin.by, inventory.id, 'بضاعة'));
    taken(await fin.admin.move(fin.by, inventory.id, seeded(chart, 'assets').id));
    expect(taken(await fin.chart.resolve(fin.by, INVENTORY_ROLE))).toMatchObject({
      id: inventory.id,
      name: 'بضاعة',
    });
  });

  it('resolves cash per currency, and refuses without a currency or without an account for it', async () => {
    const chart = taken(await fin.admin.seed(fin.system));

    const syp = taken(await fin.chart.resolve(fin.by, CASH_ROLE, 'SYP'));
    expect(syp).toEqual(reserved(chart, 'cash').find((one) => one.currency === 'SYP'));
    expect(taken(await fin.chart.resolve(fin.by, CASH_ROLE, 'USD')).currency).toBe('USD');

    expect(refusalOf(await fin.chart.resolve(fin.by, CASH_ROLE))).toEqual({
      code: 'fin.currency-required',
      values: { role: CASH_ROLE },
    });
    expect(refusalOf(await fin.chart.resolve(fin.by, CASH_ROLE, 'AED'))).toEqual({
      code: 'fin.account-for-currency-missing',
      values: { role: CASH_ROLE, currency: 'AED' },
    });
    // A currency given for a purpose that has no currency is not an error:
    // the purpose resolves on its own and the currency is not what selects it.
    expect(taken(await fin.chart.resolve(fin.by, INVENTORY_ROLE, 'SYP'))).toEqual(
      reserved(chart, 'inventory')[0],
    );
  });

  it('refuses a role no module in this edition declares', async () => {
    taken(await fin.admin.seed(fin.system));
    expect(refusalOf(await fin.chart.resolve(fin.by, UNDECLARED_ROLE))).toEqual({
      code: 'fin.account-role-undeclared',
      values: { role: UNDECLARED_ROLE },
    });
    const rent = seeded(await fin.chart.accounts(fin.by), 'rent');
    expect(refusalOf(await fin.admin.map(fin.by, UNDECLARED_ROLE, rent.id))).toEqual({
      code: 'fin.account-role-undeclared',
      values: { role: UNDECLARED_ROLE },
    });
  });

  it('maps an ordinary role to a leaf of its own side, and resolves through the mapping', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const rent = seeded(chart, 'rent');
    const sales = seeded(chart, 'sales-revenue');

    expect(refusalOf(await fin.chart.resolve(fin.by, EXPENSE_ROLE))).toEqual({
      code: 'fin.account-role-unmapped',
      values: { role: EXPENSE_ROLE },
    });

    const mapping = taken(await fin.admin.map(fin.by, EXPENSE_ROLE, rent.id));
    expect(mapping).toEqual({ tenant: fin.tenant, role: EXPENSE_ROLE, account: rent.id });
    expect(Object.isFrozen(mapping)).toBe(true);
    expect(taken(await fin.chart.resolve(fin.by, EXPENSE_ROLE))).toEqual(rent);
    taken(await fin.admin.map(fin.by, REVENUE_ROLE, sales.id));
    expect(await fin.chart.mappings(fin.by)).toEqual([
      { tenant: fin.tenant, role: EXPENSE_ROLE, account: rent.id },
      { tenant: fin.tenant, role: REVENUE_ROLE, account: sales.id },
    ]);
    expect(await fin.chart.mappings(fin.byOther)).toEqual([]);

    // Mapped again, the new mapping replaces the old.
    const utilities = seeded(chart, 'utilities');
    taken(await fin.admin.map(fin.by, EXPENSE_ROLE, utilities.id));
    expect(taken(await fin.chart.resolve(fin.by, EXPENSE_ROLE))).toEqual(utilities);
    expect(await fin.chart.mappings(fin.by)).toHaveLength(2);
  });

  it('refuses to map a reserved role, a group, a withdrawn account, or an account of the other side', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const rent = seeded(chart, 'rent');
    const sales = seeded(chart, 'sales-revenue');
    const expenses = seeded(chart, 'expenses');

    expect(refusalOf(await fin.admin.map(fin.by, INVENTORY_ROLE, rent.id))).toEqual({
      code: 'fin.account-role-reserved',
      values: { role: INVENTORY_ROLE, reserved: 'inventory' },
    });
    expect(refusalOf(await fin.admin.map(fin.by, EXPENSE_ROLE, expenses.id))).toEqual({
      code: 'fin.account-is-group',
      values: { account: expenses.id },
    });
    // A debit role into a credit-kind account posts perfectly well and reports
    // a shop that earns what it spends.
    expect(refusalOf(await fin.admin.map(fin.by, EXPENSE_ROLE, sales.id))).toEqual({
      code: 'fin.account-normal-balance-mismatch',
      values: { role: EXPENSE_ROLE, normalBalance: 'debit', account: sales.id, kind: 'income' },
    });
    expect(refusalOf(await fin.admin.map(fin.by, REVENUE_ROLE, rent.id)).code).toBe(
      'fin.account-normal-balance-mismatch',
    );
    taken(await fin.admin.withdraw(fin.by, rent.id));
    expect(refusalOf(await fin.admin.map(fin.by, EXPENSE_ROLE, rent.id))).toEqual({
      code: 'fin.account-inactive',
      values: { account: rent.id },
    });
    const missing = newId<'account'>();
    expect(refusalOf(await fin.admin.map(fin.by, EXPENSE_ROLE, missing))).toEqual({
      code: 'fin.account-not-found',
      values: { account: missing },
    });
    // Another tenant's account is as absent as one that never existed.
    const theirs = taken(await fin.admin.seed(fin.byOther));
    expect(
      refusalOf(await fin.admin.map(fin.by, EXPENSE_ROLE, seeded(theirs, 'rent').id)).code,
    ).toBe('fin.account-not-found');
  });

  it('answers a mapped account that has since become a group or been withdrawn with the reason', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const rent = seeded(chart, 'rent');
    taken(await fin.admin.map(fin.by, EXPENSE_ROLE, rent.id));

    taken(
      await fin.admin.add(fin.by, { code: '5410', name: 'x', kind: 'expense', parent: rent.id }),
    );
    expect(refusalOf(await fin.chart.resolve(fin.by, EXPENSE_ROLE))).toEqual({
      code: 'fin.account-is-group',
      values: { account: rent.id },
    });

    const utilities = seeded(chart, 'utilities');
    taken(await fin.admin.map(fin.by, EXPENSE_ROLE, utilities.id));
    taken(await fin.admin.withdraw(fin.by, utilities.id));
    expect(refusalOf(await fin.chart.resolve(fin.by, EXPENSE_ROLE))).toEqual({
      code: 'fin.account-inactive',
      values: { account: utilities.id },
    });
  });

  it('refuses to resolve a reserved purpose in a tenant whose chart was never seeded', async () => {
    expect(refusalOf(await fin.chart.resolve(fin.by, INVENTORY_ROLE))).toEqual({
      code: 'fin.chart-unseeded',
      values: { role: INVENTORY_ROLE, reserved: 'inventory' },
    });
    // Accounts of the tenant's own do not make a seeded chart.
    taken(await fin.admin.add(fin.by, { code: '1', name: 'x', kind: 'asset', parent: null }));
    expect(refusalOf(await fin.chart.resolve(fin.by, CASH_ROLE, 'USD')).code).toBe(
      'fin.chart-unseeded',
    );
  });
});

describe('Who may shape the chart', () => {
  it('asks the right each command declares, and refuses before anything is read', async () => {
    const chart = taken(await fin.admin.seed(fin.system));
    const rent = seeded(chart, 'rent');
    const asked: string[] = [];
    fin.answers((by, right, where) => {
      expect(by).toBe(fin.by);
      // Tenant-wide: a chart is one per tenant, so there is no branch to judge at.
      expect(where).toBeUndefined();
      asked.push(right);
      return false;
    });

    const { account, accountMapping } = FIN_PERMISSIONS;
    const attempts = [
      [fin.admin.seed(fin.by), account.create],
      [
        fin.admin.add(fin.by, { code: '9', name: 'x', kind: 'asset', parent: null }),
        account.create,
      ],
      [fin.admin.rename(fin.by, rent.id, 'x'), account.edit],
      [fin.admin.move(fin.by, rent.id, null), account.edit],
      [fin.admin.withdraw(fin.by, rent.id), account.withdraw],
      [fin.admin.restore(fin.by, rent.id), account.withdraw],
      [fin.admin.map(fin.by, EXPENSE_ROLE, rent.id), accountMapping.edit],
    ] as const;
    for (const [attempt, right] of attempts) {
      expect(refusalOf(await attempt)).toEqual({ code: 'fin.not-permitted', values: { right } });
    }
    expect(asked).toEqual(attempts.map(([, right]) => right));
    expect(await fin.chart.accounts(fin.by)).toEqual(chart);
  });

  it('lets the system seed without asking anybody', async () => {
    fin.answers(() => {
      throw new Error('The system holds every right; nobody should have been asked.');
    });
    expect(taken(await fin.admin.seed(fin.system)).length).toBeGreaterThan(0);
  });

  it('declares every right it asks, and seeds each to the accountant and the chart’s readers', () => {
    const declared = new Map(FIN_PERMISSION_SEEDS.map((one) => [one.id, one]));
    const { account, accountMapping } = FIN_PERMISSIONS;

    expect([...declared.keys()].filter((id) => /^fin\.account(-mapping)?\./.test(id))).toEqual([
      'fin.account.view',
      'fin.account.create',
      'fin.account.edit',
      'fin.account.delete',
      'fin.account-mapping.edit',
    ]);
    expect(declared.get(account.view)?.seededFor).toEqual(['manager', 'accountant']);
    for (const right of [account.create, account.edit, account.withdraw, accountMapping.edit]) {
      expect(declared.get(right)?.seededFor).toEqual(['accountant']);
      expect(declared.get(right)?.sensitive).toBeUndefined();
    }
    // What the platform is handed is this list, under the same names.
    expect(fin.registry.module('FIN')?.permissions.map((one) => one.id)).toEqual([
      ...declared.keys(),
    ]);
  });
});
