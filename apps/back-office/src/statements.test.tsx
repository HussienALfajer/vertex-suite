import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue } from './catalogue.js';
import {
  aTradingShop,
  recordManualEntry,
  ACCRUED,
  CAPITAL,
  EQUIPMENT,
  RENT,
  type EntryDraft,
} from './ledger.fixture.js';
import { chooseOption, goTo, startAt, type OpenShop } from './screens.fixture.js';

/**
 * `FIN-07`: the trial balance, the income statement, the balance sheet and the
 * general ledger detail — each for any date range and viewable in any
 * presentation currency.
 *
 * Signs into `dev-system.ts`, which hosts the real `FIN`, so every figure on
 * screen is one the module computed from the entries themselves: none of the
 * four is a cache, and a figure kept beside the ledger would be a figure free
 * to disagree with it. `statements.test.ts` proves the arithmetic; this file is
 * about the four pages an accountant reads — that one request answers all of
 * them, that the identities a reader checks are visible, and that a page in
 * another currency says what rate it got there by.
 */

const SHOP = { company: 'مؤسسة الشام', branch: 'حلب' };

/** Rent owed for the month: an expense against an accrual, in the books' own currency. */
const RENT_ACCRUAL: EntryDraft = {
  description: 'إيجار حزيران المستحق',
  lines: [
    { account: RENT, side: 'debit', amount: '1200' },
    { account: ACCRUED, side: 'credit', amount: '1200' },
  ],
};

/** The owner's own money, put into a shelf: an asset, and the equity funding it. */
const CAPITAL_IN: EntryDraft = {
  description: 'رأس مال المالك: رفوف',
  lines: [
    { account: EQUIPMENT, side: 'debit', amount: '1500' },
    { account: CAPITAL, side: 'credit', amount: '1500' },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

/** A shop with one entry in its books, standing on the statements screen. */
async function aShopWithStatements(): Promise<OpenShop> {
  const shop = await aTradingShop(SHOP);
  await recordManualEntry(shop, RENT_ACCRUAL);
  await goTo(shop, catalogue['nav.statements']);
  await screen.findByRole('tab', { name: catalogue['statements.trialBalance'] });
  return shop;
}

/** The figure printed beside a named line, with the name itself taken off. */
function figureUnder(page: HTMLElement, label: string): string {
  const line = within(page).getByText(label).closest('div');
  if (line === null) throw new Error(`Nothing is printed beside "${label}".`);
  return line.textContent.replace(label, '').trim();
}

/** The same, with the side taken off too: what the figure comes to, in its currency. */
function amountUnder(page: HTMLElement, label: string): string {
  return figureUnder(page, label)
    .replace(catalogue['entry.side.debit'], '')
    .replace(catalogue['entry.side.credit'], '')
    .trim();
}

/**
 * Takes an account out of use through the chart screen, the way an accountant
 * does — and through the screen rather than the port on purpose, since the
 * chart every ledger screen reads is the one `chart.tsx` holds, and only a
 * command through it re-reads that.
 */
async function withdrawAccount(shop: OpenShop, code: string): Promise<void> {
  await goTo(shop, catalogue['nav.chart']);
  const row = (await screen.findAllByRole('row')).find((one) => one.textContent.startsWith(code));
  if (row === undefined) throw new Error(`No row for account "${code}".`);
  await shop.person.click(
    within(row).getByRole('button', { name: catalogue['chart.withdraw.action'] }),
  );
  const dialog = await screen.findByRole('alertdialog');
  await shop.person.click(
    within(dialog).getByRole('button', { name: catalogue['chart.withdraw.action'] }),
  );
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
}

/** Turns to one of the four, and waits for the page it is. */
async function turnTo(shop: OpenShop, tab: string): Promise<HTMLElement> {
  await shop.person.click(screen.getByRole('tab', { name: tab }));
  const panel = await screen.findByRole('tabpanel');
  await waitFor(() => {
    expect(panel.textContent).toContain(catalogue['statements.scope.currency']);
  });
  return panel;
}

describe('Financial statements — FIN-07', () => {
  it('reads the trial balance of the span, with the two sides equal in every column', async () => {
    const shop = await aShopWithStatements();

    const page = await turnTo(shop, catalogue['statements.trialBalance']);

    // Both accounts the entry touched, and nothing else: an account is left off
    // only when it has nothing to contribute to the page.
    expect(page.textContent).toContain(RENT);
    expect(page.textContent).toContain(ACCRUED);

    // The point of a trial balance: the debits equal the credits in the
    // movement column, by construction rather than by arithmetic done here —
    // every entry ever written balanced, so any sum of whole entries balances.
    const movements = within(page).getByText(catalogue['statements.totals.movements']);
    const row = movements.closest('div');
    expect(row?.textContent).toContain('1,200');
    expect(row?.textContent.match(/1,200/g)).toHaveLength(2);
  });

  it('shows on the income statement only what moved within the span', async () => {
    const shop = await aShopWithStatements();

    const page = await turnTo(shop, catalogue['statements.incomeStatement']);

    // The rent is an expense of this span; the accrual is a liability and has
    // no business on this page at all.
    expect(page.textContent).toContain(RENT);
    expect(page.textContent).not.toContain(ACCRUED);
    expect(page.textContent).toContain(catalogue['statements.result']);
  });

  it('balances the balance sheet, and ends it on the figure the income statement ends on', async () => {
    // Two statements of one request are one statement read twice: the balance
    // sheet's `result` is exactly the income statement's, because what the shop
    // has made is computed when it is read and never swept into equity by a
    // year-end entry nobody made.
    const shop = await aShopWithStatements();
    await recordManualEntry(shop, CAPITAL_IN);
    await goTo(shop, catalogue['nav.statements']);
    await screen.findByRole('tab', { name: catalogue['statements.balanceSheet'] });

    const page = await turnTo(shop, catalogue['statements.balanceSheet']);

    // The shop owns shelves worth 1,500, funded by the owner's capital less the
    // rent it has accrued — and the two sides of the page say the same figure.
    // Equal in amount and opposite in side, which is what a balance sheet is:
    // the assets are what the shop has, and the other side is what funds them.
    expect(amountUnder(page, catalogue['statements.totals.assets'])).toContain('1,500');
    expect(amountUnder(page, catalogue['statements.totals.assets'])).toBe(
      amountUnder(page, catalogue['statements.totals.liabilitiesAndEquity']),
    );
    expect(figureUnder(page, catalogue['statements.totals.assets'])).toContain(
      catalogue['entry.side.debit'],
    );
    expect(figureUnder(page, catalogue['statements.totals.liabilitiesAndEquity'])).toContain(
      catalogue['entry.side.credit'],
    );

    // A shop that has only accrued rent has made a loss of exactly that rent,
    // and it reads as a debit — the side a loss falls on in the books' own
    // terms rather than in a sign nobody could check.
    const result = figureUnder(page, catalogue['statements.result']);
    expect(result).toContain('1,200');
    expect(result).toContain(catalogue['entry.side.debit']);
  });

  it('details an account posting by posting, with the balance each one left behind', async () => {
    const shop = await aShopWithStatements();

    const page = await turnTo(shop, catalogue['statements.generalLedger']);

    expect(page.textContent).toContain(catalogue['statements.column.running']);
    expect(page.textContent).toContain(RENT_ACCRUAL.description);
    const postings = within(page).getAllByRole('grid', { name: catalogue['statements.postings'] });
    expect(postings.length).toBeGreaterThan(0);
  });

  it('still names an account taken out of use, because its lines are still in the books', async () => {
    // The chooser reads the books rather than writing into them: an account
    // withdrawn after a year of postings keeps every one of them, and a ledger
    // that could not be asked for it would be a ledger hiding a year of one
    // account's books — the reason the branch filter names withdrawn branches.
    const shop = await aShopWithStatements();
    await withdrawAccount(shop, RENT);
    await goTo(shop, catalogue['nav.statements']);
    await screen.findByRole('tab', { name: catalogue['statements.generalLedger'] });
    const page = await turnTo(shop, catalogue['statements.generalLedger']);

    const chooser = screen.getByRole('combobox', { name: catalogue['statements.account'] });
    await shop.person.click(chooser);
    await shop.person.type(chooser, RENT);
    await shop.person.click(await screen.findByRole('option', { name: new RegExp(RENT) }));

    await waitFor(() => {
      expect(page.textContent).toContain(RENT_ACCRUAL.description);
    });
    expect(page.textContent).not.toContain(ACCRUED);
  });

  it('refuses a page in a currency there is no rate for today, rather than using yesterday’s', async () => {
    // `FX-04` blocks a currency-sensitive operation rather than quietly reading
    // a stale rate, and a page of figures with a wrong rate behind it is the
    // most quietly wrong thing this system could produce.
    const shop = await aShopWithStatements();
    await turnTo(shop, catalogue['statements.trialBalance']);

    await chooseOption(shop, catalogue['statements.presentation'], 'SYP');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toBe('');
    expect(screen.queryByText(catalogue['statements.totals.movements'])).toBeNull();
  });

  it('states the one rate a translated page went through', async () => {
    // `FX-03` shows a rate beside the page and not beside each line, because
    // two figures equal in the books have to stay equal when they are read in
    // another currency.
    const shop = await aShopWithStatements();

    await goTo(shop, catalogue['nav.rates']);
    const row = (await screen.findByRole('rowheader', { name: 'SYP' })).closest('[role="row"]');
    if (row === null) throw new Error('No row for SYP on the board.');
    await shop.person.click(
      within(row as HTMLElement).getByRole('button', {
        name: catalogue['rates.record.action'],
      }),
    );
    await shop.person.type(screen.getByLabelText(catalogue['rates.field.buy']), '13100');
    await shop.person.type(screen.getByLabelText(catalogue['rates.field.sell']), '12900');
    await shop.person.click(screen.getByRole('button', { name: catalogue['rates.record.submit'] }));
    await waitFor(() => {
      expect(
        within(row as HTMLElement).queryByRole('button', {
          name: catalogue['rates.correct.action'],
        }),
      ).toBeTruthy();
    });

    await goTo(shop, catalogue['nav.statements']);
    await turnTo(shop, catalogue['statements.trialBalance']);
    await chooseOption(shop, catalogue['statements.presentation'], 'SYP');

    const page = await screen.findByRole('tabpanel');
    await waitFor(() => {
      expect(page.textContent).toContain('SYP');
    });
    // The mid of the day's buy and sell, which is what a figure that is neither
    // being received nor paid out is worth.
    expect(page.textContent).toContain('13000');
  });
});
