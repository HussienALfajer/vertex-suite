import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import {
  chooseOption,
  enterTheShop,
  firstButton,
  goTo,
  registerCompany,
  PEOPLE,
  startAt,
  type OpenShop,
} from './screens.fixture.js';
import type { SystemOfRecord } from './system.js';

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function openBranch(shop: OpenShop, name: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['branches.open']));
  await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), name);
  await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
  await screen.findByRole('rowheader', { name });
}

async function openLocation(shop: OpenShop, name: string, kind?: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['locations.open']));
  await shop.person.type(screen.getByLabelText(catalogue['locations.new.name']), name);
  if (kind !== undefined) await chooseOption(shop, catalogue['locations.new.kind'], kind);
  await shop.person.click(screen.getByRole('button', { name: catalogue['locations.new.submit'] }));
}

/** A shop with one company and the branches named, standing on the locations screen. */
async function aShopTradingFrom(...branches: readonly string[]): Promise<OpenShop> {
  const shop = await enterTheShop();
  await registerCompany(shop, 'مؤسسة الشام');
  await goTo(shop, catalogue['nav.branches']);
  for (const name of branches) await openBranch(shop, name);
  await goTo(shop, catalogue['nav.locations']);
  return shop;
}

describe('Stock locations — SYS-09', () => {
  it('opens a location of a chosen kind, without anybody calling the vendor', async () => {
    const shop = await aShopTradingFrom('حلب');

    expect(await screen.findByText(catalogue['locations.empty'])).toBeTruthy();
    await openLocation(shop, 'المستودع الخلفي', catalogue['location.kind.store-room']);

    expect(await screen.findByRole('rowheader', { name: 'المستودع الخلفي' })).toBeTruthy();
    expect(screen.getByText(catalogue['location.kind.store-room'])).toBeTruthy();
  });

  it('lands on a branch rather than on an empty chooser', async () => {
    const shop = await aShopTradingFrom('حلب');

    // The screen cannot be read without a branch, so arriving with none named
    // picks the first one open and says so in the address — which is also what
    // makes the list somebody is looking at a list they can send to a colleague.
    await waitFor(() => {
      expect(globalThis.location.search).not.toBe('');
    });
    await openLocation(shop, 'صالة البيع');
    expect(await screen.findByRole('rowheader', { name: 'صالة البيع' })).toBeTruthy();
  });

  it('shows the locations of the branch chosen and not of the one next door', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');
    await openLocation(shop, 'صالة حلب');
    await screen.findByRole('rowheader', { name: 'صالة حلب' });

    await chooseOption(shop, catalogue['locations.branch'], 'حمص');

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'صالة حلب' })).toBeNull();
    });
    await openLocation(shop, 'صالة حمص');
    expect(await screen.findByRole('rowheader', { name: 'صالة حمص' })).toBeTruthy();
  });

  it('never shows one branch’s locations under the name of another', async () => {
    // The moment between choosing a branch and its answer arriving is the whole
    // of this test. A held read stands in for the transport `U07` puts under
    // the port: over a memory store the gap is a microtask, and over a shop
    // network it is as long as the request takes.
    let release: (() => void) | undefined;
    let held: Promise<void> | null = null;

    const real = developmentSystem({ people: PEOPLE });
    const gated: SystemOfRecord = {
      signIn: real.signIn.bind(real),
      changeOwnPassword: real.changeOwnPassword.bind(real),
      signOut: real.signOut.bind(real),
      organisation: {
        ...real.organisation,
        locations: {
          ...real.organisation.locations,
          list: async (branch, listing) => {
            const answer = await real.organisation.locations.list(branch, listing);
            if (held !== null) await held;
            return answer;
          },
        },
      },
      users: real.users,
      currencies: real.currencies,
    };

    const shop = await enterTheShop(gated);
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    for (const branch of ['حلب', 'حمص']) await openBranch(shop, branch);
    await goTo(shop, catalogue['nav.locations']);
    await openLocation(shop, 'صالة حلب');
    await screen.findByRole('rowheader', { name: 'صالة حلب' });

    held = new Promise<void>((settle) => {
      release = settle;
    });
    await chooseOption(shop, catalogue['locations.branch'], 'حمص');

    // Aleppo's shop floor is not in Homs, and the screen now says Homs.
    expect(screen.queryByRole('rowheader', { name: 'صالة حلب' })).toBeNull();

    held = null;
    release?.();
    expect(await screen.findByText(catalogue['locations.empty'])).toBeTruthy();
  });

  it('sends somebody to open a branch first', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.locations']);

    expect(await screen.findByText(catalogue['locations.noBranches'])).toBeTruthy();
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['locations.noBranches.action'] }),
    );
    expect(await screen.findByText(catalogue['branches.empty'])).toBeTruthy();
  });

  it('withdraws a location from use and keeps its whole history findable', async () => {
    const shop = await aShopTradingFrom('حلب');
    await openLocation(shop, 'المستودع الخلفي');
    await screen.findByRole('rowheader', { name: 'المستودع الخلفي' });

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['locations.withdraw.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['locations.withdraw'] }));

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'المستودع الخلفي' })).toBeNull();
    });

    // `SYS-09`'s acceptance criterion in as many words: a deactivated location
    // retains its full movement history and remains reportable — which starts
    // with it still being there to look at.
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    expect(await screen.findByRole('rowheader', { name: 'المستودع الخلفي' })).toBeTruthy();
    expect(screen.getByText(catalogue['status.withdrawn'])).toBeTruthy();
  });

  it('refuses a second location in one branch under one name', async () => {
    const shop = await aShopTradingFrom('حلب');
    await openLocation(shop, 'صالة البيع');
    await screen.findByRole('rowheader', { name: 'صالة البيع' });

    await openLocation(shop, 'صالة البيع');

    // Two stock locations one name apart, in the one list a warehouse keeper
    // reads before every transfer.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('صالة البيع');
  });
});
