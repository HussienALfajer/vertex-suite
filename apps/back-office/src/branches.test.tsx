import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue } from './catalogue.js';
import {
  chooseOption,
  enterTheShop,
  firstButton,
  goTo,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function openBranch(shop: OpenShop, name: string, company?: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['branches.open']));
  if (company !== undefined) {
    await chooseOption(shop, catalogue['branches.new.company'], company);
  }
  await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), name);
  await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
}

describe('Branches — SYS-09', () => {
  it('opens a branch without anybody calling the vendor', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);

    expect(screen.getByText(catalogue['branches.empty'])).toBeTruthy();
    await openBranch(shop, 'حلب');

    expect(await screen.findByRole('rowheader', { name: 'حلب' })).toBeTruthy();
  });

  it('sends somebody to register a company first, rather than offering an empty chooser', async () => {
    const shop = await enterTheShop();
    await goTo(shop, catalogue['nav.branches']);

    // A branch belongs to a company permanently, so with none registered there
    // is nothing to open one in. A dialog whose first field had no options
    // would be a dead end somebody has to work out for themselves.
    expect(await screen.findByText(catalogue['branches.noCompanies'])).toBeTruthy();
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['branches.noCompanies.action'] }),
    );

    expect(await screen.findByText(catalogue['companies.empty'])).toBeTruthy();
  });

  it('refuses two branches of one company under one name, and allows it across two', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await registerCompany(shop, 'مخازن حلب');
    await goTo(shop, catalogue['nav.branches']);

    await openBranch(shop, 'الفرع الرئيسي', 'مؤسسة الشام');
    await screen.findByRole('rowheader', { name: 'الفرع الرئيسي' });

    // A group that holds two companies may well run a main branch in each, and
    // the two are never listed together. What is refused is two under one
    // company, because that list is read before every stock transfer.
    await openBranch(shop, 'الفرع الرئيسي', 'مخازن حلب');
    await waitFor(() => {
      expect(screen.getAllByRole('rowheader', { name: 'الفرع الرئيسي' })).toHaveLength(2);
    });

    await openBranch(shop, 'الفرع الرئيسي', 'مؤسسة الشام');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('الفرع الرئيسي');
  });

  it('keeps the company filter in the address, so a list can be sent to somebody', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await registerCompany(shop, 'مخازن حلب');
    await goTo(shop, catalogue['nav.branches']);
    await openBranch(shop, 'حلب', 'مؤسسة الشام');
    await screen.findByRole('rowheader', { name: 'حلب' });
    await openBranch(shop, 'حمص', 'مخازن حلب');
    await screen.findByRole('rowheader', { name: 'حمص' });

    await chooseOption(shop, catalogue['branches.filter.company'], 'مخازن حلب');

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'حلب' })).toBeNull();
    });
    expect(screen.getByRole('rowheader', { name: 'حمص' })).toBeTruthy();
    // What is on screen is what the address says, which is what makes it
    // shareable and what lets the companies screen arrive here already filtered.
    expect(globalThis.location.search).not.toBe('');
  });

  it('goes from a branch to the locations inside it', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    await openBranch(shop, 'حلب');
    await screen.findByRole('rowheader', { name: 'حلب' });

    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.locations'] }));

    expect(await screen.findByText(catalogue['locations.empty'])).toBeTruthy();
  });

  it('withdraws a branch from use and puts it back', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    await openBranch(shop, 'حلب');
    await screen.findByRole('rowheader', { name: 'حلب' });

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['branches.withdraw.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.withdraw'] }));

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'حلب' })).toBeNull();
    });

    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.restore'] }));

    expect(await screen.findByText(catalogue['status.inUse'])).toBeTruthy();
  });
});
