import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue } from './catalogue.js';
import { aTradingShop, typeDay, TRADING_DAY } from './ledger.fixture.js';
import { goTo, optionsOf, selectNamed, startAt, type OpenShop } from './screens.fixture.js';

/**
 * `FIN-06`: structured entry of the opening inventory, the till balances, what
 * customers owe and what is owed to suppliers — posted as one dated opening
 * journal entry.
 *
 * Signs into `dev-system.ts`, which hosts the real `FIN`, so the entry these
 * tests produce is the one the module built: each figure on the account
 * reserved for its purpose, and the whole balanced against opening-balance
 * equity on whichever side balances it. `opening.test.ts` proves that shape;
 * this file is about the screen — that it asks for what a shop *has* rather
 * than for debits and credits, and that the two mistakes a structured entry
 * exists to prevent cannot be made on it.
 */

const SHOP = { company: 'مؤسسة الشام', branch: 'حلب' };

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function onTheOpeningScreen(): Promise<OpenShop> {
  const shop = await aTradingShop(SHOP);
  await goTo(shop, catalogue['nav.openingBalances']);
  await screen.findByLabelText(catalogue['opening.inventory']);
  return shop;
}

/** The currency one till is counted in, read off its own chooser. */
function currencyOf(till: HTMLElement): string {
  return selectNamed(catalogue['opening.figure.currency'], till).textContent.trim();
}

/** The panel a heading names, for a screen whose figures repeat their labels. */
function panelOf(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const panel = heading.closest('section');
  if (panel === null) throw new Error(`No panel titled "${title}".`);
  return panel;
}

describe('Opening balances — FIN-06', () => {
  it('opens the books from what the shop has, as one dated entry', async () => {
    const shop = await onTheOpeningScreen();

    await typeDay(shop, TRADING_DAY);
    await shop.person.type(screen.getByLabelText(catalogue['opening.inventory']), '5000');
    await shop.person.type(screen.getByLabelText(catalogue['opening.supplierDebts']), '2000');
    await shop.person.click(screen.getByRole('button', { name: catalogue['opening.submit'] }));

    expect(await screen.findByText(catalogue['opening.posted.title'])).toBeTruthy();

    // What the shop has, less what it owes, is what it started with: the
    // difference goes to opening-balance equity, and nobody typed it.
    await shop.person.click(screen.getByRole('button', { name: catalogue['opening.posted.open'] }));
    const lines = await screen.findByRole('grid', { name: catalogue['journal.lines'] });
    expect(within(lines).getAllByRole('row')).toHaveLength(4);
    expect(lines.textContent).toContain(catalogue['account.opening-balance-equity']);
  });

  it('leaves out what the shop does not have, rather than entering it as nought', async () => {
    // `FIN-06` says every figure is optional. A line naming an account with
    // nothing in it would be the books claiming the shop counted and found
    // none, which is not what an empty field means.
    const shop = await onTheOpeningScreen();

    await typeDay(shop, TRADING_DAY);
    await shop.person.type(screen.getByLabelText(catalogue['opening.inventory']), '5000');
    await shop.person.click(screen.getByRole('button', { name: catalogue['opening.submit'] }));
    await screen.findByText(catalogue['opening.posted.title']);
    await shop.person.click(screen.getByRole('button', { name: catalogue['opening.posted.open'] }));

    const lines = await screen.findByRole('grid', { name: catalogue['journal.lines'] });
    // The stock, and the equity it is funded by. Nothing for the customers, the
    // suppliers or a till, because nothing was entered for them.
    expect(within(lines).getAllByRole('row')).toHaveLength(3);
    expect(lines.textContent).not.toContain(catalogue['account.trade-receivables']);
  });

  it('will not open the books with nothing in them', async () => {
    const shop = await onTheOpeningScreen();

    await typeDay(shop, TRADING_DAY);
    await shop.person.click(screen.getByRole('button', { name: catalogue['opening.submit'] }));

    expect(await screen.findByText(catalogue['opening.figures.required'])).toBeTruthy();
    expect(screen.queryByText(catalogue['opening.posted.title'])).toBeNull();
  });

  it('counts a till once, by taking its currency off the list the next one offers', async () => {
    // `FIN-01` keeps one cash account per currency, so two figures for one
    // currency are one till counted twice — and a sum would hide exactly the
    // mistake an opening balance exists to not make
    // (`fin.opening-till-repeated`). The chooser makes it unreachable.
    const shop = await onTheOpeningScreen();
    const tills = panelOf(catalogue['opening.tills']);
    const add = (): HTMLElement =>
      within(tills).getByRole('button', { name: catalogue['opening.till.add'] });

    await shop.person.click(add());
    const [first] = within(tills).getAllByRole('listitem');
    if (first === undefined) throw new Error('No till was added.');
    const firstOffered = await optionsOf(shop, catalogue['opening.figure.currency'], first);
    await shop.person.keyboard('{Escape}');
    const firstCurrency = currencyOf(first);

    await shop.person.click(add());
    const second = within(tills).getAllByRole('listitem')[1];
    if (second === undefined) throw new Error('No second till was added.');
    const secondOffered = await optionsOf(shop, catalogue['opening.figure.currency'], second);

    // A new till opens on a currency no other till has taken, and cannot be
    // pointed at one that is taken.
    expect(currencyOf(second)).not.toBe(firstCurrency);
    expect(firstOffered).toContain(firstCurrency);
    expect(secondOffered).not.toContain(firstCurrency);
    expect(secondOffered).toHaveLength(firstOffered.length - 1);
  });

  it('runs out of tills when every currency has one, rather than offering an empty chooser', async () => {
    const shop = await onTheOpeningScreen();
    const tills = panelOf(catalogue['opening.tills']);
    const add = (): HTMLElement =>
      within(tills).getByRole('button', { name: catalogue['opening.till.add'] });

    // Four currencies are seeded (`FX-01`), so the fifth press has nothing to
    // offer and the control says so by being unavailable.
    for (let count = 0; count < 4; count += 1) {
      await shop.person.click(add());
    }

    await waitFor(() => {
      expect(within(tills).getAllByRole('listitem')).toHaveLength(4);
    });
    expect(add().hasAttribute('disabled')).toBe(true);
  });
});
