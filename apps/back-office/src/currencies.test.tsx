import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue, createTranslator } from './catalogue.js';
import { enterTheShop, firstButton, goTo, startAt, type OpenShop } from './screens.fixture.js';

/**
 * `FX-01`: the four seeded currencies, each with its own rounding rule, and a
 * tenant's own beyond them. `FX-02`: which one the books are kept in.
 *
 * Signs into the real `dev-system.ts`, which now hosts the real `FX` beside
 * the real `SYS` — `composition.test.ts` already proved the wiring between
 * `SEC`, `SYS` and `FX` holds; what this file proves is that the screen built
 * on it says what `FX` actually decided, in the same words a refusal from the
 * module itself would use.
 */

const say = createTranslator();

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function aShopOnCurrencies(): Promise<OpenShop> {
  const shop = await enterTheShop();
  await goTo(shop, catalogue['nav.currencies']);
  return shop;
}

/** The row a currency's code is on, found through the cell §11 makes a row header. */
function rowFor(code: string): HTMLElement {
  const cell = screen.getByRole('rowheader', { name: code });
  const row = cell.closest('[role="row"]');
  if (row === null) throw new Error(`No row for "${code}".`);
  return row as HTMLElement;
}

describe('Currencies — FX-01', () => {
  it('seeds SYP, USD, TRY and EUR, present the moment the shop is', async () => {
    await aShopOnCurrencies();

    expect(rowFor('SYP').textContent).toContain('ل.س');
    expect(rowFor('USD').textContent).toContain('$');
    expect(rowFor('TRY').textContent).toContain('₺');
    expect(rowFor('EUR').textContent).toContain('€');
  });

  it('revises a rounding rule, and shows it at once', async () => {
    const shop = await aShopOnCurrencies();

    await shop.person.click(
      within(rowFor('SYP')).getByRole('button', { name: catalogue['currencies.revise.action'] }),
    );
    const field = screen.getByLabelText(catalogue['currencies.new.increment']);
    await shop.person.clear(field);
    await shop.person.type(field, '500');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['currencies.revise.submit'] }),
    );

    await screen.findByText(say.format('currencies.revised', { code: 'SYP' }));
    expect(rowFor('SYP').textContent).toContain('500');
  });

  it('adds a currency this edition did not ship, usable at once', async () => {
    const shop = await aShopOnCurrencies();

    await shop.person.click(firstButton(catalogue['currencies.define']));
    await shop.person.type(screen.getByLabelText(catalogue['currencies.new.code']), 'AED');
    await shop.person.type(screen.getByLabelText(catalogue['currencies.new.symbol']), 'د.إ');
    await shop.person.type(screen.getByLabelText(catalogue['currencies.new.increment']), '0.25');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['currencies.new.submit'] }),
    );

    await screen.findByRole('rowheader', { name: 'AED' });
    expect(rowFor('AED').textContent).toContain('د.إ');
  });

  it('refuses a rounding step finer than the currency’s own stored precision, shown beside the field', async () => {
    const shop = await aShopOnCurrencies();

    await shop.person.click(
      within(rowFor('SYP')).getByRole('button', { name: catalogue['currencies.revise.action'] }),
    );
    const field = screen.getByLabelText(catalogue['currencies.new.increment']);
    await shop.person.clear(field);
    await shop.person.type(field, '0.005');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['currencies.revise.submit'] }),
    );

    expect(
      await screen.findByText(
        say.format('refusal.fx.currency-increment-too-fine', {
          code: 'SYP',
          increment: '0.005',
          decimals: '2',
        }),
      ),
    ).toBeTruthy();
    // The dialog stays open over the field that caused it, the same rule
    // every other revision on this product follows.
    expect(screen.getByLabelText(catalogue['currencies.new.increment'])).toBeTruthy();
  });

  it('takes a currency out of use, drops it from the default view, and puts it back', async () => {
    const shop = await aShopOnCurrencies();

    await shop.person.click(
      within(rowFor('TRY')).getByRole('button', { name: catalogue['currencies.disable.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['currencies.disable'] }));

    // Hidden the moment it is out of use, the same rule `SYS-09`'s own
    // structural screens follow — a shop's small, active set of currencies
    // is what a glance shows.
    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'TRY' })).toBeNull();
    });
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    expect(await screen.findByRole('rowheader', { name: 'TRY' })).toBeTruthy();
    expect(rowFor('TRY').textContent).toContain(catalogue['status.withdrawn']);

    await shop.person.click(
      within(rowFor('TRY')).getByRole('button', { name: catalogue['currencies.enable.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['currencies.enable'] }));
    await waitFor(() => {
      expect(rowFor('TRY').textContent).toContain(catalogue['status.inUse']);
    });
  });
});

describe('The functional currency — FX-02', () => {
  it('marks USD the functional currency from the first morning', async () => {
    await aShopOnCurrencies();

    expect(rowFor('USD').textContent).toContain(catalogue['currencies.functional.badge']);
    expect(rowFor('SYP').textContent).not.toContain(catalogue['currencies.functional.badge']);
  });

  it('lets the owner adopt a different, enabled currency for the books', async () => {
    const shop = await aShopOnCurrencies();

    await shop.person.click(
      within(rowFor('EUR')).getByRole('button', {
        name: catalogue['currencies.makeFunctional.action'],
      }),
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['currencies.makeFunctional.submit'] }),
    );

    await screen.findByText(say.format('currencies.functionalChanged', { code: 'EUR' }));
    expect(rowFor('EUR').textContent).toContain(catalogue['currencies.functional.badge']);
    expect(rowFor('USD').textContent).not.toContain(catalogue['currencies.functional.badge']);
  });

  it('offers no way to adopt a currency that is out of use', async () => {
    const shop = await aShopOnCurrencies();

    await shop.person.click(
      within(rowFor('TRY')).getByRole('button', { name: catalogue['currencies.disable.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['currencies.disable'] }));
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    await waitFor(() => {
      expect(rowFor('TRY').textContent).toContain(catalogue['status.withdrawn']);
    });

    expect(
      within(rowFor('TRY')).queryByRole('button', {
        name: catalogue['currencies.makeFunctional.action'],
      }),
    ).toBeNull();
  });

  it('refuses to take the functional currency out of use', async () => {
    const shop = await aShopOnCurrencies();

    await shop.person.click(
      within(rowFor('USD')).getByRole('button', { name: catalogue['currencies.disable.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['currencies.disable'] }));

    await screen.findByText(say.format('refusal.fx.currency-is-functional', { code: 'USD' }));
    expect(rowFor('USD').textContent).toContain(catalogue['status.inUse']);
  });
});
