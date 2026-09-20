import type { BranchId } from '@vertex/contracts';
import type { RateStampId } from '@vertex/fx/contract';
import {
  isOk,
  localDate,
  money,
  newId,
  type LocalDate,
  type Money,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FIN_PERMISSION_SEEDS,
  FIN_PERMISSIONS,
  type Account,
  type Balance,
  type EntrySide,
  type LedgerAccount,
  type StatementLine,
  type StatementSection,
} from './contract.js';
import {
  CASH_ROLE,
  COGS_ROLE,
  EXPENSE_ROLE,
  installFin,
  INVENTORY_ROLE,
  REVENUE_ROLE,
  type Installed,
} from './edition.fixture.js';

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

function usd(amount: string): Money {
  return money(amount, 'USD');
}

/** A balance as a person reads one: "1080 debit", or "—" for nothing on either side. */
function shown(balance: Balance): string {
  return balance.side === null ? '—' : `${balance.amount.amount} ${balance.side}`;
}

/** A section read as a person reads it: every line by code, indented under its group. */
function lines(section: StatementSection): readonly string[] {
  const walk = (line: StatementLine, depth: number): string[] => [
    `${'  '.repeat(depth)}${line.account.code} ${shown(line.total)}`,
    ...line.children.flatMap((child) => walk(child, depth + 1)),
  ];
  return section.lines.flatMap((line) => walk(line, 0));
}

function ledgerOf(ledger: readonly LedgerAccount[], account: Account): LedgerAccount {
  const found = ledger.find((one) => one.account.id === account.id);
  if (found === undefined) throw new Error(`No ledger for account ${account.code}.`);
  return found;
}

/**
 * A shop with four months of trading behind it: the books opened on New
 * Year's Day, a sale in March, a sale and the rent in April.
 *
 * Every figure below is a whole dollar, so that what the statements come to
 * can be read off the scenario rather than recomputed from it — and so that
 * what rounding does to a translated page is visible where it is put under
 * test on purpose, and nowhere else.
 */
interface Shop {
  readonly fin: Installed;
  readonly branch: BranchId;
  readonly accounts: readonly Account[];
}

const JANUARY = day('2026-01-01');
const MARCH = day('2026-03-10');
const APRIL = day('2026-04-12');
const RENT_DAY = day('2026-04-20');

/** The month the statements below are read over. */
const SPAN = { from: day('2026-04-01'), to: day('2026-04-30') };

/** Every day the shop has traded, which is what a balance sheet stands on. */
const EVER = { from: day('2026-01-01'), to: day('2026-12-31') };

interface Line {
  readonly role: string;
  readonly currency?: string;
  readonly side: EntrySide;
  readonly amount: Money;
  /** In the document's own currency, and the `FX-05` stamp that valued it. */
  readonly original?: Money;
  readonly stamp?: RateStampId;
}

async function openShop(): Promise<Shop> {
  const fin = installFin();
  const accounts = taken(await fin.admin.seed(fin.system));
  taken(await fin.calendarAdmin.seed(fin.system));
  const branch = fin.openBranch();
  fin.setRate(branch, 'SYP', { buy: '13000', sell: '13100' });
  taken(await fin.admin.map(fin.by, REVENUE_ROLE, seeded(accounts, 'sales-revenue').id));
  taken(await fin.admin.map(fin.by, EXPENSE_ROLE, seeded(accounts, 'rent').id));
  return { fin, branch, accounts };
}

/** A posting, through the engine every business event posts through. */
async function post(
  shop: Shop,
  kind: string,
  on: LocalDate,
  drafted: readonly Line[],
  at: BranchId = shop.branch,
): Promise<void> {
  const { fin } = shop;
  const prepared = taken(
    await fin.posting.prepare(fin.by, {
      id: newId<'journal-entry'>(),
      source: { kind, document: newId<'sale'>() },
      branch: at,
      day: on,
      lines: drafted,
    }),
  );
  taken(await fin.run(fin.by, (uow) => fin.posting.post(uow, prepared)));
}

/** A sale: cash in and the cost of what left the shelf, in one entry. */
function sale(price: string, cost: string): readonly Line[] {
  return [
    { role: CASH_ROLE, currency: 'USD', side: 'debit', amount: usd(price) },
    { role: REVENUE_ROLE, side: 'credit', amount: usd(price) },
    { role: COGS_ROLE, side: 'debit', amount: usd(cost) },
    { role: INVENTORY_ROLE, side: 'credit', amount: usd(cost) },
  ];
}

/**
 * The books as the scenario leaves them: opened with a thousand dollars of
 * stock, two hundred in the till, three hundred owed by customers and two
 * hundred and fifty owed to suppliers; a four-hundred-dollar sale in March
 * costing two hundred and fifty; a six-hundred-dollar sale in April costing
 * three hundred and eighty; and a hundred and twenty dollars of rent.
 */
async function trade(shop: Shop): Promise<void> {
  const { fin, branch } = shop;
  taken(
    await fin.journalAdmin.open(fin.by, {
      id: newId<'journal-entry'>(),
      branch,
      day: JANUARY,
      inventory: { amount: usd('1000') },
      tills: [{ amount: usd('200') }],
      customerDebts: { amount: usd('300') },
      supplierDebts: { amount: usd('250') },
    }),
  );
  await post(shop, 'pos.sale', MARCH, sale('400', '250'));
  await post(shop, 'pos.sale', APRIL, sale('600', '380'));
  await post(shop, 'csh.expense', RENT_DAY, [
    { role: EXPENSE_ROLE, side: 'debit', amount: usd('120') },
    { role: CASH_ROLE, currency: 'USD', side: 'credit', amount: usd('120') },
  ]);
}

let shop: Shop;

beforeEach(async () => {
  shop = await openShop();
  await trade(shop);
});

describe('Financial statements — FIN-07', () => {
  it('reads a trial balance over any span of days: what every account opened on, what moved within it, and what it closed on', async () => {
    const { fin, accounts } = shop;

    const trial = taken(await fin.statements.trialBalance(fin.by, SPAN));

    expect(
      trial.rows.map((row) => [
        row.account.code,
        shown(row.opening),
        row.debits.amount,
        row.credits.amount,
        shown(row.closing),
      ]),
    ).toEqual([
      // The till: six hundred at the end of March, six hundred taken in April
      // and a hundred and twenty paid out for the rent.
      [cashIn(accounts, 'USD').code, '600 debit', '600', '120', '1080 debit'],
      ['1210', '300 debit', '0', '0', '300 debit'],
      ['1310', '750 debit', '0', '380', '370 debit'],
      ['2110', '250 credit', '0', '0', '250 credit'],
      ['3200', '1250 credit', '0', '0', '1250 credit'],
      ['4100', '400 credit', '0', '600', '1000 credit'],
      ['5100', '250 debit', '380', '0', '630 debit'],
      // The rent: nothing before April, and nothing to bring into it.
      ['5400', '—', '120', '0', '120 debit'],
    ]);
    expect(trial.scope).toEqual({ from: SPAN.from, to: SPAN.to, branch: null });
    expect(trial.currency).toBe('USD');
    expect(trial.rate).toBeNull();
  });

  it('balances: the debits equal the credits in every column of the trial balance', async () => {
    const { fin } = shop;

    const trial = taken(await fin.statements.trialBalance(fin.by, SPAN));

    // Not arithmetic this module does: every entry ever written balanced, so
    // any sum of whole entries balances. A column that did not would mean the
    // store had lost a line.
    expect(trial.totals).toEqual({
      opening: {
        debits: { amount: '1900', currency: 'USD' },
        credits: { amount: '1900', currency: 'USD' },
      },
      movements: {
        debits: { amount: '1100', currency: 'USD' },
        credits: { amount: '1100', currency: 'USD' },
      },
      closing: {
        debits: { amount: '2500', currency: 'USD' },
        credits: { amount: '2500', currency: 'USD' },
      },
    });
  });

  it('leaves off a trial balance the accounts that neither hold a balance nor moved', async () => {
    const { fin } = shop;

    const trial = taken(await fin.statements.trialBalance(fin.by, SPAN));

    // The chart is seeded with three dozen accounts and this shop has used
    // eight of them. A page of noughts hides the figures on it.
    const codes = trial.rows.map((row) => row.account.code);
    expect(codes).not.toContain('5700');
    expect(codes).not.toContain('1400');
  });

  it('reads an income statement of what moved within the span, arranged by the chart’s own groups', async () => {
    const { fin } = shop;

    const statement = taken(await fin.statements.incomeStatement(fin.by, SPAN));

    expect(lines(statement.income)).toEqual(['4000 600 credit', '  4100 600 credit']);
    expect(lines(statement.expenses)).toEqual([
      '5000 500 debit',
      '  5100 380 debit',
      '  5400 120 debit',
    ]);
    expect(shown(statement.income.total)).toBe('600 credit');
    expect(shown(statement.expenses.total)).toBe('500 debit');
    // A credit is what the shop made: the books carry income on that side, so a
    // profit is what is left over there.
    expect(shown(statement.result)).toBe('100 credit');
  });

  it('keeps out of an income statement the balance an income account brought into the span', async () => {
    const { fin } = shop;

    const april = taken(await fin.statements.incomeStatement(fin.by, SPAN));
    const whole = taken(await fin.statements.incomeStatement(fin.by, EVER));

    // April sold six hundred of the thousand the year has sold. An income
    // statement measures what moved and nothing that stood.
    expect(shown(april.income.total)).toBe('600 credit');
    expect(shown(whole.income.total)).toBe('1000 credit');
    expect(shown(whole.result)).toBe('250 credit');
  });

  it('counts a group’s own postings with what is beneath it, when the chart grows under an account already posted to', async () => {
    const { fin, accounts } = shop;
    // The accountant splits the rent in two part-way through the year. What
    // was already posted to it stays where it was posted (`FIN-03`), so the
    // account is now a group with postings of its own.
    const rent = seeded(accounts, 'rent');
    const shopFront = taken(
      await fin.admin.add(fin.by, {
        code: '5410',
        name: 'Shop front',
        kind: 'expense',
        parent: rent.id,
      }),
    );
    taken(await fin.admin.map(fin.by, EXPENSE_ROLE, shopFront.id));
    await post(shop, 'csh.expense', RENT_DAY, [
      { role: EXPENSE_ROLE, side: 'debit', amount: usd('80') },
      { role: CASH_ROLE, currency: 'USD', side: 'credit', amount: usd('80') },
    ]);

    const statement = taken(await fin.statements.incomeStatement(fin.by, SPAN));

    // Two hundred under the rent: the hundred and twenty posted to it before
    // it had children, and the eighty posted beneath it after. A group total
    // that showed only one of them would be a page whose lines do not come to
    // their totals.
    expect(lines(statement.expenses)).toEqual([
      '5000 580 debit',
      '  5100 380 debit',
      '  5400 200 debit',
      '    5410 80 debit',
    ]);
    expect(shown(statement.result)).toBe('20 credit');
  });

  it('reads a balance sheet as at the last day of the span, against what funds it', async () => {
    const { fin } = shop;

    const sheet = taken(await fin.statements.balanceSheet(fin.by, SPAN));

    expect(lines(sheet.assets)).toEqual([
      '1000 1750 debit',
      '  1100 1080 debit',
      `    ${cashIn(shop.accounts, 'USD').code} 1080 debit`,
      '  1200 300 debit',
      '    1210 300 debit',
      '  1300 370 debit',
      '    1310 370 debit',
    ]);
    expect(lines(sheet.liabilities)).toEqual([
      '2000 250 credit',
      '  2100 250 credit',
      '    2110 250 credit',
    ]);
    expect(lines(sheet.equity)).toEqual(['3000 1250 credit', '  3200 1250 credit']);
    // The one thing a balance sheet is: the two sides are equal, and on
    // opposite sides of the books.
    expect(sheet.totals).toEqual({
      assets: { side: 'debit', amount: { amount: '1750', currency: 'USD' } },
      liabilitiesAndEquity: { side: 'credit', amount: { amount: '1750', currency: 'USD' } },
    });
  });

  it('splits what the shop has made at the span’s first day, with no closing entry anywhere', async () => {
    const { fin } = shop;

    const sheet = taken(await fin.statements.balanceSheet(fin.by, SPAN));
    const statement = taken(await fin.statements.incomeStatement(fin.by, SPAN));

    // What was made before April — four hundred sold at a cost of two hundred
    // and fifty — and what was made within it, which is the figure the income
    // statement of the same request ends on. Two statements of one request are
    // one statement read twice.
    expect(shown(sheet.broughtForward)).toBe('150 credit');
    expect(sheet.result).toEqual(statement.result);
    // And no posting made it so: nothing swept income into equity, and the
    // journal holds exactly the four entries the shop actually made.
    const journal = await fin.journal.entries(fin.by);
    expect(journal).toHaveLength(4);
  });

  it('reads a balance sheet of a shop that has made nothing yet, and balances it', async () => {
    const quiet = await openShop();
    const { fin, branch } = quiet;
    taken(
      await fin.journalAdmin.open(fin.by, {
        id: newId<'journal-entry'>(),
        branch,
        day: JANUARY,
        tills: [{ amount: usd('500') }],
      }),
    );

    const sheet = taken(await fin.statements.balanceSheet(fin.by, EVER));

    expect(shown(sheet.broughtForward)).toBe('—');
    expect(shown(sheet.result)).toBe('—');
    expect(shown(sheet.totals.assets)).toBe('500 debit');
    expect(shown(sheet.totals.liabilitiesAndEquity)).toBe('500 credit');
  });

  it('reads a general ledger of an account: where it opened, every posting in order with the balance after it, and where it closed', async () => {
    const { fin, accounts, branch } = shop;
    const till = cashIn(accounts, 'USD');

    const ledger = taken(
      await fin.statements.generalLedger(fin.by, { ...SPAN, accounts: [till.id] }),
    );

    const cash = ledgerOf(ledger.accounts, till);
    expect(shown(cash.opening)).toBe('600 debit');
    expect(
      cash.postings.map((posting) => [
        posting.day,
        posting.number,
        posting.side,
        posting.amount.amount,
        shown(posting.running),
      ]),
    ).toEqual([
      [APRIL, '2026-000003', 'debit', '600', '1200 debit'],
      [RENT_DAY, '2026-000004', 'credit', '120', '1080 debit'],
    ]);
    expect(cash.postings.map((posting) => [posting.source.kind, posting.branch])).toEqual([
      ['pos.sale', branch],
      ['csh.expense', branch],
    ]);
    expect(cash.debits.amount).toBe('600');
    expect(cash.credits.amount).toBe('120');
    expect(shown(cash.closing)).toBe('1080 debit');
    // Named one account, so it is the only one detailed.
    expect(ledger.accounts).toHaveLength(1);
  });

  it('details every account that holds a balance or moved, when the reader names none', async () => {
    const { fin } = shop;

    const ledger = taken(await fin.statements.generalLedger(fin.by, SPAN));

    expect(ledger.accounts.map((one) => one.account.code)).toEqual([
      cashIn(shop.accounts, 'USD').code,
      '1210',
      '1310',
      '2110',
      '3200',
      '4100',
      '5100',
      '5400',
    ]);
    // An account that stood still over the span is still on its own ledger,
    // with the balance it stood at and nothing between.
    const receivables = ledger.accounts.find((one) => one.account.code === '1210');
    expect(receivables?.postings).toEqual([]);
    expect(shown(receivables!.closing)).toBe('300 debit');
  });

  it('refuses a general ledger for an account the tenant does not have', async () => {
    const { fin } = shop;

    const refusal = refusalOf(
      await fin.statements.generalLedger(fin.by, { ...SPAN, accounts: [newId<'account'>()] }),
    );

    // The reader asked about an account by name. Silence would be a wrong
    // answer to a question that was asked precisely.
    expect(refusal.code).toBe('fin.account-not-found');
  });

  it('shows every statement in any presentation currency, at one rate, stated', async () => {
    const { fin, branch } = shop;
    const presentation = { into: 'SYP' } as const;

    const trial = taken(await fin.statements.trialBalance(fin.by, { ...SPAN, presentation }));
    const sheet = taken(await fin.statements.balanceSheet(fin.by, { ...SPAN, presentation }));

    // The exact middle of the branch's board: thirteen thousand received and
    // thirteen thousand one hundred paid out.
    expect(trial.rate).toMatchObject({
      basis: 'mid',
      rate: '13050',
      currency: 'SYP',
      day: '2026-09-20',
    });
    expect(trial.currency).toBe('SYP');
    expect(trial.totals.closing).toEqual({
      debits: { amount: '32625000', currency: 'SYP' },
      credits: { amount: '32625000', currency: 'SYP' },
    });
    // Every identity the ledger guarantees survives the conversion, because
    // two figures equal in the books convert to two equal figures.
    expect(sheet.totals.assets.amount.amount).toBe(sheet.totals.liabilitiesAndEquity.amount.amount);
    expect(shown(sheet.totals.assets)).toBe('22837500 debit');
    expect(sheet.rate?.revision).toBe(trial.rate?.revision);
    // Translated at the board of the branch the figures are of, when the
    // reader named no other.
    const elsewhere = fin.openBranch();
    fin.setRate(elsewhere, 'SYP', { buy: '20000', sell: '20000' });
    const atAnother = taken(
      await fin.statements.balanceSheet(fin.by, {
        ...SPAN,
        presentation: { into: 'SYP', board: elsewhere },
      }),
    );
    expect(atAnother.rate?.rate).toBe('20000');
    expect(shown(atAnother.totals.assets)).toBe('35000000 debit');
    expect(branch).not.toBe(elsewhere);
  });

  it('leaves a posting’s own currency out of the translation, because it is a fact about a document', async () => {
    const { fin, accounts } = shop;
    const till = cashIn(accounts, 'SYP');
    // A million and three hundred thousand pounds over the counter, worth a
    // hundred dollars at the rate the document was stamped with.
    await post(shop, 'csh.cash-movement', APRIL, [
      {
        role: CASH_ROLE,
        currency: 'SYP',
        side: 'debit',
        amount: usd('100'),
        original: money('1300000', 'SYP'),
        stamp: newId<'rate-stamp'>(),
      },
      { role: REVENUE_ROLE, side: 'credit', amount: usd('100') },
    ]);

    const ledger = taken(
      await fin.statements.generalLedger(fin.by, {
        ...SPAN,
        accounts: [till.id],
        presentation: { into: 'SYP' },
      }),
    );

    const [posting] = ledgerOf(ledger.accounts, till).postings;
    // The figure in the books, read in pounds at today's mid…
    expect(posting?.amount).toEqual({ amount: '1305000', currency: 'SYP' });
    // …and the amount the document was actually written for, which is neither
    // translated nor translatable: it is already in its own currency.
    expect(posting?.original).toEqual({ amount: '1300000', currency: 'SYP' });
  });

  it('reads the rate for a statement with no figures on it, rather than labelling it unchecked', async () => {
    const { fin } = shop;
    const quiet = fin.openBranch();

    // A general ledger of no accounts asks for no figure, so there is nothing
    // on the page to convert — and a page labelled in pounds whose branch has
    // entered no rate today, or in a currency the shop does not take, would be
    // a heading nobody had checked.
    expect(
      refusalOf(
        await fin.statements.generalLedger(fin.by, {
          ...SPAN,
          accounts: [],
          presentation: { into: 'SYP', board: quiet },
        }),
      ).code,
    ).toBe('fx.rate-missing');
    expect(
      refusalOf(
        await fin.statements.generalLedger(fin.by, {
          ...SPAN,
          accounts: [],
          presentation: { into: 'JOD' },
        }),
      ).code,
    ).toBe('fx.currency-not-found');
    // And read at a board that has one, it is a ledger of nothing, in pounds.
    const empty = taken(
      await fin.statements.generalLedger(fin.by, {
        ...SPAN,
        accounts: [],
        presentation: { into: 'SYP' },
      }),
    );
    expect(empty.accounts).toEqual([]);
    expect(empty.currency).toBe('SYP');
    expect(empty.rate?.rate).toBe('13050');
  });

  it('refuses to translate a statement at a board the branch has not entered today', async () => {
    const { fin } = shop;
    const quiet = fin.openBranch();

    const refusal = refusalOf(
      await fin.statements.trialBalance(fin.by, {
        ...SPAN,
        presentation: { into: 'SYP', board: quiet },
      }),
    );

    // `FX-04` blocks a currency-sensitive operation rather than quietly
    // reusing yesterday's rate, and a statement read at a wrong rate is the
    // most quietly wrong thing this system could produce.
    expect(refusal.code).toBe('fx.rate-missing');
  });

  it('reads the statements of one branch, which balance as the tenant’s own do', async () => {
    const { fin, branch } = shop;
    const aleppo = fin.openBranch();
    await post(shop, 'pos.sale', APRIL, sale('900', '700'), aleppo);

    const here = taken(await fin.statements.trialBalance(fin.by, { ...SPAN, branch }));
    const there = taken(await fin.statements.trialBalance(fin.by, { ...SPAN, branch: aleppo }));
    const both = taken(await fin.statements.trialBalance(fin.by, SPAN));

    // A branch is a fact of the entry and not of its lines, so a subtotal of
    // the journal by branch is made of whole entries — and whole entries
    // balance.
    expect(here.totals.movements.debits).toEqual(here.totals.movements.credits);
    expect(there.totals.movements).toEqual({
      debits: { amount: '1600', currency: 'USD' },
      credits: { amount: '1600', currency: 'USD' },
    });
    expect(both.totals.movements.debits.amount).toBe('2700');
    expect(here.scope.branch).toBe(branch);
  });

  it('counts an account withdrawn from use that still holds history', async () => {
    const { fin, accounts } = shop;
    const rent = seeded(accounts, 'rent');
    taken(await fin.admin.withdraw(fin.by, rent.id));

    const trial = taken(await fin.statements.trialBalance(fin.by, SPAN));
    const statement = taken(await fin.statements.incomeStatement(fin.by, SPAN));

    // `SYS-09`'s rule about a location, which is the ledger's about an
    // account: what is withdrawn keeps its history and stays reportable. The
    // rent was paid, and taking the account out of use afterwards does not
    // unpay it.
    expect(trial.rows.find((row) => row.account.id === rent.id)?.closing.amount.amount).toBe('120');
    expect(shown(statement.expenses.total)).toBe('500 debit');
  });

  it('counts a reversal on its own day, and never by unmaking the entry it reverses', async () => {
    const { fin } = shop;
    const [, , april] = await fin.journal.entries(fin.by);
    taken(
      await fin.journalAdmin.reverse(fin.by, april!.id, {
        day: day('2026-05-04'),
        reason: 'The sale was rung up twice.',
      }),
    );

    const inApril = taken(await fin.statements.incomeStatement(fin.by, SPAN));
    const toMay = taken(
      await fin.statements.incomeStatement(fin.by, { from: SPAN.from, to: day('2026-05-31') }),
    );

    // April still reads as April did. A correction is an entry of its own on
    // its own day (`FIN-03`), so a statement already printed is still the
    // statement of that span.
    expect(shown(inApril.result)).toBe('100 credit');
    expect(shown(toMay.result)).toBe('120 debit');
  });

  it('counts nothing from an entry the books never admitted', async () => {
    const { fin, branch } = shop;
    // Sold at a register with the line down, on a day April was still open.
    const arrived = await fin.postedElsewhere(fin.by, {
      id: newId<'journal-entry'>(),
      source: { kind: 'pos.sale', document: newId<'sale'>() },
      branch,
      day: day('2026-04-28'),
      lines: [...sale('50', '20')],
    });
    const [year] = await fin.calendar.years(fin.by);
    const april = year!.periods[3]!;
    taken(await fin.calendarAdmin.close(fin.by, april.id));
    await fin.run(fin.by, (uow) => fin.posting.accept(uow, arrived));

    const trial = taken(await fin.statements.trialBalance(fin.by, SPAN));

    // A late arrival for a closed month waits in the queue of `FIN-05` for a
    // decision. It is not in the books, so it is not in the figures.
    expect(await fin.exceptions.exceptions(fin.by)).toHaveLength(1);
    expect(trial.totals.movements.debits.amount).toBe('1100');
  });

  it('reads one tenant’s books and nobody else’s', async () => {
    const { fin } = shop;

    const trial = taken(await fin.statements.trialBalance(fin.byOther, SPAN));

    expect(trial.rows).toEqual([]);
    expect(trial.totals.closing.debits.amount).toBe('0');
  });

  it('refuses a span that ends before it begins, and a day that is not a day', async () => {
    const { fin } = shop;

    expect(
      refusalOf(await fin.statements.trialBalance(fin.by, { from: SPAN.to, to: SPAN.from })).code,
    ).toBe('fin.span-inverted');
    expect(
      refusalOf(
        await fin.statements.balanceSheet(fin.by, {
          ...SPAN,
          to: '30-04-2026' as unknown as LocalDate,
        }),
      ).code,
    ).toBe('fin.day-invalid');
  });

  it('refuses a branch that is not the tenant’s, whether its figures or its board were asked for', async () => {
    const { fin } = shop;
    const elsewhere = fin.openBranch({ tenant: fin.otherTenant });

    expect(
      refusalOf(await fin.statements.trialBalance(fin.by, { ...SPAN, branch: elsewhere })).code,
    ).toBe('fin.branch-not-found');
    expect(
      refusalOf(
        await fin.statements.trialBalance(fin.by, {
          ...SPAN,
          presentation: { into: 'SYP', board: elsewhere },
        }),
      ).code,
    ).toBe('fx.branch-not-found');
  });

  it('refuses every statement of a tenant that has not said what its books are kept in', async () => {
    const { fin } = shop;
    fin.setFunctional(null);

    expect(refusalOf(await fin.statements.trialBalance(fin.by, SPAN)).code).toBe(
      'fin.functional-currency-unset',
    );
    expect(refusalOf(await fin.statements.generalLedger(fin.by, SPAN)).code).toBe(
      'fin.functional-currency-unset',
    );
  });

  it('declares a right to read the statements, held by whoever the books are reported to', async () => {
    const { fin } = shop;
    const { statement } = FIN_PERMISSIONS;

    const declared = FIN_PERMISSION_SEEDS.find((one) => one.id === statement.view);
    expect(declared?.seededFor).toEqual(['manager', 'accountant']);
    // Declared and not asked here: what a person may see is decided where
    // their request enters the system of record, as it is for every other read
    // this module publishes. A cashier's sale posts whether or not the cashier
    // may read the books.
    fin.answers(() => false);
    expect(taken(await fin.statements.trialBalance(fin.by, SPAN)).rows.length).toBeGreaterThan(0);
  });
});
