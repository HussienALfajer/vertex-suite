import { cleanup, screen, waitFor, within } from '@testing-library/react';
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

async function openBranch(shop: OpenShop, name: string, company?: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['branches.open']));
  const dialog = await screen.findByRole('dialog');
  if (company !== undefined) {
    await chooseOption(shop, catalogue['branches.new.company'], company, dialog);
  }
  await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), name);
  await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
  await screen.findByRole('rowheader', { name });
}

interface OpeningOptions {
  readonly kind?: string;
  /** Chosen in the dialog; left alone where the dialog already knows. */
  readonly branch?: string;
}

async function openLocation(
  shop: OpenShop,
  name: string,
  { kind, branch }: OpeningOptions = {},
): Promise<void> {
  await shop.person.click(firstButton(catalogue['locations.open']));
  const dialog = await screen.findByRole('dialog');
  if (branch !== undefined) {
    await chooseOption(shop, catalogue['locations.new.branch'], branch, dialog);
  }
  await shop.person.type(screen.getByLabelText(catalogue['locations.new.name']), name);
  if (kind !== undefined) {
    await chooseOption(shop, catalogue['locations.new.kind'], kind, dialog);
  }
  await shop.person.click(screen.getByRole('button', { name: catalogue['locations.new.submit'] }));
}

/** The row a location's name heads, for what else it says about it. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByRole('rowheader', { name }).closest<HTMLElement>('[role="row"]');
  if (row === null) throw new Error(`"${name}" heads no row.`);
  return row;
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

    expect(await screen.findByText(catalogue['locations.empty.allBranches'])).toBeTruthy();
    await openLocation(shop, 'المستودع الخلفي', { kind: catalogue['location.kind.store-room'] });

    expect(await screen.findByRole('rowheader', { name: 'المستودع الخلفي' })).toBeTruthy();
    expect(screen.getByText(catalogue['location.kind.store-room'])).toBeTruthy();
  });

  it('lands on every branch rather than on one picked for somebody', async () => {
    const shop = await aShopTradingFrom('حلب');

    // Said in the address, which is what makes the list somebody is looking at
    // a list they can send to a colleague. A shop with one branch open needs
    // no second answer to "which branch" in the dialog either.
    await waitFor(() => {
      expect(globalThis.location.search).toBe('?id=all');
    });
    await openLocation(shop, 'صالة البيع');
    expect(await screen.findByRole('rowheader', { name: 'صالة البيع' })).toBeTruthy();
  });

  it('shows the locations of the branch chosen and not of the one next door', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');
    await chooseOption(shop, catalogue['locations.branch'], 'حلب');
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
      ...real,
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
    };

    const shop = await enterTheShop(gated);
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    for (const branch of ['حلب', 'حمص']) await openBranch(shop, branch);
    await goTo(shop, catalogue['nav.locations']);
    await chooseOption(shop, catalogue['locations.branch'], 'حلب');
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

describe('Every branch’s locations at once — SYS-09', () => {
  it('lays every branch’s locations in one table, each row naming its branch', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');
    await openLocation(shop, 'صالة حلب', { branch: 'حلب' });
    await screen.findByRole('rowheader', { name: 'صالة حلب' });
    await openLocation(shop, 'صالة حمص', { branch: 'حمص' });
    await screen.findByRole('rowheader', { name: 'صالة حمص' });

    // `SYS` answers per branch; the screen asked each branch and kept every
    // answer, and a row that did not say whose it was would be two rows with
    // no way to tell them apart.
    expect(within(rowOf('صالة حلب')).getByText('حلب')).toBeTruthy();
    expect(within(rowOf('صالة حمص')).getByText('حمص')).toBeTruthy();
  });

  it('asks which branch a new location belongs to, when more than one could be meant', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');

    await shop.person.click(firstButton(catalogue['locations.open']));
    await shop.person.type(screen.getByLabelText(catalogue['locations.new.name']), 'مستودع');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['locations.new.submit'] }),
    );

    // A location belongs to one branch for good; the dialog does not guess.
    expect(await screen.findByText(catalogue['locations.new.branch.required'])).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('offers the branch the listing is narrowed to, so the usual case is one answer', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');
    await chooseOption(shop, catalogue['locations.branch'], 'حمص');

    await openLocation(shop, 'صالة حمص');

    expect(await screen.findByRole('rowheader', { name: 'صالة حمص' })).toBeTruthy();
  });

  it('narrows every branch to one company’s, and says whose they are', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await registerCompany(shop, 'شركة الفرات');
    await goTo(shop, catalogue['nav.branches']);
    await openBranch(shop, 'حلب', 'مؤسسة الشام');
    await openBranch(shop, 'دير الزور', 'شركة الفرات');
    await goTo(shop, catalogue['nav.locations']);
    await openLocation(shop, 'صالة حلب', { branch: 'حلب' });
    await openLocation(shop, 'صالة الدير', { branch: 'دير الزور' });
    await screen.findByRole('rowheader', { name: 'صالة الدير' });

    await chooseOption(shop, catalogue['locations.filter.company'], 'شركة الفرات');

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'صالة حلب' })).toBeNull();
    });
    expect(screen.getByRole('rowheader', { name: 'صالة الدير' })).toBeTruthy();
    // "Every branch" now means this company's, and the chooser says so rather
    // than leaving somebody to wonder whether it still means the whole shop.
    const allOfIt = catalogue['locations.branch.allInCompany'].replace('{company}', 'شركة الفرات');
    expect(screen.getAllByText(allOfIt).length).toBeGreaterThan(0);
  });

  it('returns to every branch of a company chosen, even from one of its own branches', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await registerCompany(shop, 'شركة الفرات');
    await goTo(shop, catalogue['nav.branches']);
    await openBranch(shop, 'حلب', 'مؤسسة الشام');
    await openBranch(shop, 'إدلب', 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.locations']);
    await chooseOption(shop, catalogue['locations.branch'], 'حلب');
    await waitFor(() => {
      expect(globalThis.location.search).not.toBe('?id=all');
    });

    // Choosing a company answers "which branches" one way, always: all of
    // them — never the one somebody happened to be standing on.
    await chooseOption(shop, catalogue['locations.filter.company'], 'مؤسسة الشام');

    await waitFor(() => {
      expect(globalThis.location.search).toBe('?id=all');
    });
  });

  it('says a location in use cannot trade while its branch is withdrawn', async () => {
    const shop = await aShopTradingFrom('حلب');
    await openLocation(shop, 'صالة البيع');
    await screen.findByRole('rowheader', { name: 'صالة البيع' });

    await goTo(shop, catalogue['nav.branches']);
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['branches.withdraw.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.withdraw'] }));
    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'حلب' })).toBeNull();
    });
    await goTo(shop, catalogue['nav.locations']);

    // `SYS` leaves the location itself marked in use — withdrawal does not
    // cascade — so the screen is what says nothing can be sold from it.
    await screen.findByRole('rowheader', { name: 'صالة البيع' });
    expect(
      within(rowOf('صالة البيع')).getByText(catalogue['locations.status.branchWithdrawn']),
    ).toBeTruthy();
  });
});
