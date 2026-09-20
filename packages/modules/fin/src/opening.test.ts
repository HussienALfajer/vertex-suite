import type { BranchId } from '@vertex/contracts';
import {
  isOk,
  localDate,
  money,
  newId,
  type LocalDate,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import { FX_PERMISSIONS } from '@vertex/fx/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FIN_ACCOUNT_ROLES,
  FIN_ENTRY_KINDS,
  FIN_PERMISSION_SEEDS,
  FIN_PERMISSIONS,
  type Account,
  type FiscalYear,
  type JournalLine,
  type OpeningBalances,
} from './contract.js';
import { installFin, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code} ${JSON.stringify(result.error.values)}`);
}

function refusalOf(result: Result<unknown, Refusal>): Refusal {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error;
}

/** A day written the way an accountant writes one. */
function day(text: string): LocalDate {
  const value = localDate(text);
  if (value === null) throw new Error(`"${text}" is not a day.`);
  return value;
}

function seeded(accounts: readonly Account[], seed: string): Account {
  const found = accounts.find((one) => one.seeded === seed);
  if (found === undefined) throw new Error(`No seeded account "${seed}".`);
  return found;
}

function cashIn(accounts: readonly Account[], currency: string): Account {
  const found = accounts.find((one) => one.reserved === 'cash' && one.currency === currency);
  if (found === undefined) throw new Error(`No cash account for ${currency}.`);
  return found;
}

function usd(amount: string) {
  return money(amount, 'USD');
}

function syp(amount: string) {
  return money(amount, 'SYP');
}

/** What a line says about the books, and nothing about how it was recorded. */
function figuresOf(lines: readonly JournalLine[]) {
  return lines.map(({ account, role, side, amount, original, stamp }) => ({
    account,
    role,
    side,
    amount,
    original,
    stamp,
  }));
}

/**
 * A shop on the morning its books open: the chart and the calendar seeded,
 * one branch, and today's board for the pound at it.
 */
interface Shop {
  readonly fin: Installed;
  readonly branch: BranchId;
  readonly accounts: readonly Account[];
  readonly year: FiscalYear;
}

async function openShop(): Promise<Shop> {
  const fin = installFin();
  const accounts = taken(await fin.admin.seed(fin.system));
  const [year] = taken(await fin.calendarAdmin.seed(fin.system));
  const branch = fin.openBranch();
  fin.setRate(branch, 'SYP', { buy: '13000', sell: '13100' });
  return { fin, branch, accounts, year: year! };
}

/**
 * What the shop had on New Year's Day: a thousand dollars of stock, five
 * million pounds and two hundred dollars in the tills, three hundred dollars
 * owed by customers and two hundred and fifty owed to suppliers.
 */
function balances(shop: Shop, changes: Partial<OpeningBalances> = {}): OpeningBalances {
  return {
    id: newId<'journal-entry'>(),
    branch: shop.branch,
    day: day('2026-01-01'),
    inventory: { amount: usd('1000') },
    tills: [{ amount: syp('5000000') }, { amount: usd('200') }],
    customerDebts: { amount: usd('300') },
    supplierDebts: { amount: usd('250') },
    ...changes,
  };
}

let shop: Shop;

beforeEach(async () => {
  shop = await openShop();
});

describe('Opening balances — FIN-06', () => {
  it('posts the opening inventory, till balances, customer debts and supplier debts as one opening journal entry dated the day the books open, balanced against opening-balance equity', async () => {
    const { fin, branch, accounts, year } = shop;
    const draft = balances(shop);

    const posted = taken(await fin.journalAdmin.open(fin.by, draft));

    expect(posted.entry).toEqual({
      id: draft.id,
      tenant: fin.tenant,
      number: '2026-000001',
      lineCount: 6,
      attachmentCount: 0,
      source: { kind: FIN_ENTRY_KINDS.openingBalance, document: draft.id },
      branch,
      register: null,
      day: '2026-01-01',
      period: year.periods[0]!.id,
      description: null,
      total: { amount: '1884.6154', currency: 'USD' },
      reverses: null,
      exception: null,
      by: fin.by.actor,
      device: null,
      at: fin.clock.now(),
    });
    // Each figure to the account reserved for its purpose, through this
    // module's own role for it — so the journal says where each line came
    // from — and the pound till counted in pounds, with the stamp that
    // valued it.
    const [stamp] = fin.stamps();
    expect(figuresOf(posted.lines)).toEqual([
      {
        account: seeded(accounts, 'merchandise-inventory').id,
        role: FIN_ACCOUNT_ROLES.openingInventory,
        side: 'debit',
        amount: { amount: '1000', currency: 'USD' },
        original: null,
        stamp: null,
      },
      {
        account: cashIn(accounts, 'SYP').id,
        role: FIN_ACCOUNT_ROLES.openingCash,
        side: 'debit',
        amount: { amount: '384.6154', currency: 'USD' },
        original: { amount: '5000000', currency: 'SYP' },
        stamp: stamp!.id,
      },
      {
        account: cashIn(accounts, 'USD').id,
        role: FIN_ACCOUNT_ROLES.openingCash,
        side: 'debit',
        amount: { amount: '200', currency: 'USD' },
        original: null,
        stamp: null,
      },
      {
        account: seeded(accounts, 'trade-receivables').id,
        role: FIN_ACCOUNT_ROLES.openingCustomerDebts,
        side: 'debit',
        amount: { amount: '300', currency: 'USD' },
        original: null,
        stamp: null,
      },
      {
        account: seeded(accounts, 'trade-payables').id,
        role: FIN_ACCOUNT_ROLES.openingSupplierDebts,
        side: 'credit',
        amount: { amount: '250', currency: 'USD' },
        original: null,
        stamp: null,
      },
      {
        account: seeded(accounts, 'opening-balance-equity').id,
        role: FIN_ACCOUNT_ROLES.openingBalanceEquity,
        side: 'credit',
        amount: { amount: '1634.6154', currency: 'USD' },
        original: null,
        stamp: null,
      },
    ]);
    expect(posted.lines.map((one) => one.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(posted.lines.every((one) => one.memo === null)).toBe(true);
    expect(posted.attachments).toEqual([]);
    expect(await fin.journal.entry(fin.by, draft.id)).toEqual(posted);
    expect((await fin.calendar.years(fin.by))[0]!.periods[0]!.posted).toBe(true);

    // Entered twice — the button pressed again, the command replayed — it is
    // one entry, and the pound till was stamped once.
    expect(taken(await fin.journalAdmin.open(fin.by, draft))).toEqual(posted);
    expect(await fin.journal.entries(fin.by)).toEqual([posted.entry]);
    expect(fin.stamps()).toHaveLength(1);
  });

  it('declares a role reserved for each of the five purposes an opening entry posts to, the way every module declares the accounts it needs', () => {
    const declared = shop.fin.registry.module('FIN')?.accounts ?? [];

    expect(
      declared.map(({ role, normalBalance, reserved }) => ({ role, normalBalance, reserved })),
    ).toEqual([
      {
        role: FIN_ACCOUNT_ROLES.openingBalanceEquity,
        normalBalance: 'credit',
        reserved: 'opening-equity',
      },
      { role: FIN_ACCOUNT_ROLES.openingInventory, normalBalance: 'debit', reserved: 'inventory' },
      { role: FIN_ACCOUNT_ROLES.openingCash, normalBalance: 'debit', reserved: 'cash' },
      {
        role: FIN_ACCOUNT_ROLES.openingCustomerDebts,
        normalBalance: 'debit',
        reserved: 'receivables',
      },
      {
        role: FIN_ACCOUNT_ROLES.openingSupplierDebts,
        normalBalance: 'credit',
        reserved: 'payables',
      },
    ]);
    expect(declared.map((one) => one.labelKey)).toEqual(
      declared.map((one) => `account-role.${one.role}`),
    );
  });

  it('values a figure in another currency at the rate of the day it is entered — not the day the books open on — on the side its line selects, with a written override allowed', async () => {
    const { fin, branch } = shop;
    const override = {
      form: 'units-per-functional',
      rate: '12500',
      reason: 'سعر يوم الجرد',
    } as const;

    // The books open on New Year's Day; the rate is September's, because FX-04
    // keeps no other, and the stamp says so.
    const posted = taken(
      await fin.journalAdmin.open(fin.by, {
        ...balances(shop),
        tills: [{ amount: syp('5000000') }],
        supplierDebts: { amount: syp('2620000') },
        customerDebts: { amount: syp('1300000'), override },
      }),
    );

    expect(posted.entry.day).toBe('2026-01-01');
    const [till, customers, suppliers] = fin.stamps();
    expect(till).toMatchObject({
      branch,
      currency: 'SYP',
      day: '2026-09-20',
      rateDay: '2026-09-20',
      direction: 'received',
      side: 'buy',
      rate: '13000',
      override: null,
    });
    expect(customers).toMatchObject({ direction: 'received', side: 'buy', rate: '12500' });
    expect(suppliers).toMatchObject({ direction: 'paid-out', side: 'sell', rate: '13100' });
    expect(
      figuresOf(posted.lines).map(({ role, side, amount, original }) => [
        role,
        side,
        amount.amount,
        original?.amount ?? null,
      ]),
    ).toEqual([
      [FIN_ACCOUNT_ROLES.openingInventory, 'debit', '1000', null],
      [FIN_ACCOUNT_ROLES.openingCash, 'debit', '384.6154', '5000000'],
      [FIN_ACCOUNT_ROLES.openingCustomerDebts, 'debit', '104', '1300000'],
      [FIN_ACCOUNT_ROLES.openingSupplierDebts, 'credit', '200', '2620000'],
      [FIN_ACCOUNT_ROLES.openingBalanceEquity, 'credit', '1288.6154', null],
    ]);
    expect(posted.lines.map((one) => one.stamp)).toEqual([
      null,
      till!.id,
      customers!.id,
      suppliers!.id,
      null,
    ]);
    expect(fin.overrides()).toHaveLength(1);
    expect(fin.overrides()[0]).toMatchObject({
      stamp: customers!.id,
      automatic: '13000',
      applied: '12500',
      reason: 'سعر يوم الجرد',
    });

    // FX's own refusals of a rate come back naming the figure.
    expect(
      refusalOf(
        await fin.journalAdmin.open(fin.by, {
          ...balances(shop),
          tills: [{ amount: syp('5000000'), override: { ...override, reason: ' ' } }],
        }),
      ),
    ).toEqual({
      code: 'fx.override-reason-required',
      values: { line: 2, figure: 'till', currency: 'SYP' },
    });
    expect(
      refusalOf(
        await fin.journalAdmin.open(
          fin.by,
          balances(shop, { tills: [{ amount: money('90', 'EUR') }] }),
        ),
      ),
    ).toEqual({
      code: 'fx.rate-missing',
      values: { line: 2, figure: 'till', currency: 'EUR', branch, day: '2026-09-20' },
    });
    fin.answers((_by, right) => right !== FX_PERMISSIONS.rate.override);
    expect(
      refusalOf(
        await fin.journalAdmin.open(
          fin.by,
          balances(shop, { inventory: { amount: syp('13000000'), override } }),
        ),
      ),
    ).toEqual({
      code: 'fx.not-permitted',
      values: { line: 1, figure: 'inventory', right: FX_PERMISSIONS.rate.override },
    });
    expect(
      refusalOf(
        await fin.journalAdmin.open(
          fin.by,
          balances(shop, { inventory: { amount: usd('1000'), override } }),
        ),
      ),
    ).toEqual({
      code: 'fin.line-override-on-functional',
      values: { line: 1, figure: 'inventory' },
    });
    expect(fin.stamps()).toHaveLength(3);
  });

  it('puts the equity line on whichever side balances the figures, and leaves it out when they already balance', async () => {
    const { fin, accounts } = shop;
    const equity = seeded(accounts, 'opening-balance-equity').id;

    // A shop that opens owing more than it holds.
    const owing = taken(
      await fin.journalAdmin.open(fin.by, {
        ...balances(shop),
        inventory: null,
        tills: [{ amount: usd('100') }],
        customerDebts: null,
        supplierDebts: { amount: usd('250') },
      }),
    );
    expect(
      figuresOf(owing.lines).map(({ account, side, amount }) => [account, side, amount.amount]),
    ).toEqual([
      [cashIn(accounts, 'USD').id, 'debit', '100'],
      [seeded(accounts, 'trade-payables').id, 'credit', '250'],
      [equity, 'debit', '150'],
    ]);
    expect(owing.entry.total).toEqual({ amount: '250', currency: 'USD' });

    // A shop whose stock is exactly what it owes for it.
    const even = taken(
      await fin.journalAdmin.open(fin.by, {
        ...balances(shop),
        tills: [],
        customerDebts: null,
        supplierDebts: { amount: usd('1000') },
      }),
    );
    expect(even.lines.map((one) => one.account)).toEqual([
      seeded(accounts, 'merchandise-inventory').id,
      seeded(accounts, 'trade-payables').id,
    ]);
    expect(even.entry.total).toEqual({ amount: '1000', currency: 'USD' });

    // A single figure balances against equity alone.
    const stockOnly = taken(
      await fin.journalAdmin.open(fin.by, {
        ...balances(shop),
        tills: [],
        customerDebts: null,
        supplierDebts: null,
      }),
    );
    expect(figuresOf(stockOnly.lines).map(({ account, side }) => [account, side])).toEqual([
      [seeded(accounts, 'merchandise-inventory').id, 'debit'],
      [equity, 'credit'],
    ]);
  });

  it('refuses opening balances with nothing in them, a till counted twice, or a figure that is not a positive amount of money the tenant has, naming the figure', async () => {
    const { fin } = shop;
    const open = (draft: unknown) => fin.journalAdmin.open(fin.by, draft as OpeningBalances);
    const nothing = { inventory: null, tills: [], customerDebts: null, supplierDebts: null };

    expect(refusalOf(await open(balances(shop, nothing)))).toEqual({
      code: 'fin.opening-balances-empty',
      values: {},
    });
    expect(
      refusalOf(
        await open({
          ...balances(shop),
          inventory: undefined,
          tills: undefined,
          customerDebts: undefined,
          supplierDebts: undefined,
        }),
      ).code,
    ).toBe('fin.opening-balances-empty');
    expect(
      refusalOf(
        await open(
          balances(shop, {
            tills: [{ amount: syp('100') }, { amount: usd('5') }, { amount: syp('200') }],
          }),
        ),
      ),
    ).toEqual({
      code: 'fin.opening-till-repeated',
      values: { line: 4, figure: 'till', currency: 'SYP' },
    });

    for (const [figure, changes, values] of [
      [
        'inventory',
        { inventory: { amount: usd('0') } },
        { line: 1, figure: 'inventory', amount: '0' },
      ],
      [
        'customer-debts',
        { customerDebts: { amount: usd('-300') } },
        { line: 4, figure: 'customer-debts', amount: '-300' },
      ],
      [
        'till',
        { tills: [{ amount: usd('200') }, { amount: syp('-5') }] },
        { line: 3, figure: 'till', currency: 'SYP', amount: '-5' },
      ],
    ] as const) {
      expect(refusalOf(await open(balances(shop, changes))), figure).toEqual({
        code: 'fin.line-amount-invalid',
        values,
      });
    }
    for (const notMoney of ['1000', 1000, { amount: '1000', currency: 'USD' }, null]) {
      expect(
        refusalOf(await open(balances(shop, { supplierDebts: { amount: notMoney as never } })))
          .code,
        JSON.stringify(notMoney),
      ).toBe('fin.line-amount-invalid');
    }
    expect(refusalOf(await open(balances(shop, { supplierDebts: 250 as never })))).toEqual({
      code: 'fin.line-amount-invalid',
      values: { line: 5, figure: 'supplier-debts', amount: 'undefined' },
    });
    // Tills that are not a list of tills: refused at the first till's place.
    expect(refusalOf(await open(balances(shop, { tills: 'two tills' as never })))).toEqual({
      code: 'fin.line-amount-invalid',
      values: { line: 2, figure: 'till', amount: 'two tills' },
    });
    expect(
      refusalOf(await open(balances(shop, { inventory: { amount: usd('1000.00001') } }))),
    ).toEqual({
      code: 'fin.line-amount-too-precise',
      values: { line: 1, figure: 'inventory', amount: '1000.00001', currency: 'USD', decimals: 4 },
    });
    expect(
      refusalOf(await open(balances(shop, { tills: [{ amount: syp('5000000.005') }] }))),
    ).toEqual({
      code: 'fin.line-amount-too-precise',
      values: { line: 2, figure: 'till', currency: 'SYP', amount: '5000000.005', decimals: 2 },
    });
    expect(
      refusalOf(await open(balances(shop, { tills: [{ amount: money('70', 'GBP') }] }))),
    ).toEqual({
      code: 'fin.line-currency-unknown',
      values: { line: 2, figure: 'till', currency: 'GBP' },
    });
    expect(await fin.journal.entries(fin.by)).toEqual([]);
    expect(fin.stamps()).toEqual([]);
  });

  it('dates the entry the day the books open, in an open period of the calendar, at a branch that trades, described in words if at all', async () => {
    const { fin, year } = shop;
    const open = (draft: unknown) => fin.journalAdmin.open(fin.by, draft as OpeningBalances);

    expect(refusalOf(await open({ ...balances(shop), id: 'opening' }))).toEqual({
      code: 'fin.entry-id-invalid',
      values: { id: 'opening' },
    });
    expect(refusalOf(await open({ ...balances(shop), day: '2026-1-1' }))).toEqual({
      code: 'fin.day-invalid',
      values: { day: '2026-1-1' },
    });
    expect(refusalOf(await open(balances(shop, { day: day('2025-12-31') })))).toEqual({
      code: 'fin.day-outside-calendar',
      values: { day: '2025-12-31' },
    });
    taken(await fin.calendarAdmin.close(fin.by, year.periods[0]!.id));
    expect(refusalOf(await open(balances(shop)))).toEqual({
      code: 'fin.period-closed',
      values: { day: '2026-01-01', period: year.periods[0]!.id },
    });
    const closed = fin.openBranch();
    fin.closeBranch(closed);
    expect(refusalOf(await open(balances(shop, { branch: closed })))).toEqual({
      code: 'fin.branch-inactive',
      values: { branch: closed },
    });
    expect(
      refusalOf(await open(balances(shop, { day: day('2026-02-01'), description: ' 1 ' }))),
    ).toEqual({
      code: 'fin.description-invalid',
      values: {},
    });
    for (const nothing of [null, undefined, 'the opening']) {
      expect(refusalOf(await open(nothing)).code, String(nothing)).toBe('fin.entry-id-invalid');
    }

    const described = taken(
      await open(
        balances(shop, { day: day('2026-02-01'), description: '  أرصدة افتتاحية حسب الجرد  ' }),
      ),
    );
    expect(described.entry.description).toBe('أرصدة افتتاحية حسب الجرد');
    expect(described.entry.day).toBe('2026-02-01');
  });

  it('is reversed like any other entry, which is how an opening entered wrongly is taken back, at the rates it used', async () => {
    const { fin } = shop;
    const original = taken(await fin.journalAdmin.open(fin.by, balances(shop)));

    const reversal = taken(
      await fin.journalAdmin.reverse(fin.by, original.entry.id, {
        day: day('2026-01-01'),
        reason: 'جرد خاطئ',
      }),
    );

    expect(reversal.entry.reverses).toBe(original.entry.id);
    expect(figuresOf(reversal.lines)).toEqual(
      figuresOf(original.lines).map((line) => ({
        ...line,
        side: line.side === 'debit' ? 'credit' : 'debit',
      })),
    );
    expect(fin.stamps()).toHaveLength(1);
    // And the books are opened again, with the right figures, as a new entry.
    const again = taken(
      await fin.journalAdmin.open(fin.by, balances(shop, { inventory: { amount: usd('1200') } })),
    );
    expect(again.entry.number).toBe('2026-000003');
    expect(await fin.journal.entries(fin.by)).toHaveLength(3);
  });

  it('asks the right to open the books, tenant-wide, before anything is asked of SYS or FX or written', async () => {
    const { fin } = shop;
    const asked: string[] = [];
    fin.answers((by, right, where) => {
      expect(by).toBe(fin.by);
      expect(where).toBeUndefined();
      asked.push(right);
      return false;
    });

    expect(refusalOf(await fin.journalAdmin.open(fin.by, balances(shop)))).toEqual({
      code: 'fin.not-permitted',
      values: { right: FIN_PERMISSIONS.openingBalance.create },
    });
    expect(asked).toEqual([FIN_PERMISSIONS.openingBalance.create]);
    expect(await fin.journal.entries(fin.by)).toEqual([]);
    expect(fin.stamps()).toEqual([]);

    // Its own right, the accountant's, and not the manual entry's: see `OpeningRights`.
    const declared = FIN_PERMISSION_SEEDS.find(
      (one) => one.id === FIN_PERMISSIONS.openingBalance.create,
    );
    expect(declared).toEqual({ id: 'fin.opening-balance.create', seededFor: ['accountant'] });
    expect(FIN_PERMISSIONS.openingBalance.create).not.toBe(FIN_PERMISSIONS.journalEntry.create);
  });
});
