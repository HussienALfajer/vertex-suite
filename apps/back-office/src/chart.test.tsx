import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue, createTranslator } from './catalogue.js';
import {
  chooseOption,
  enterTheShop,
  firstButton,
  goTo,
  optionsOf,
  startAt,
  type OpenShop,
} from './screens.fixture.js';

/**
 * `FIN-01`: the retail chart of accounts, seeded with the shop and edited as a
 * tree, with the accounts the system posts to marked and undeletable.
 *
 * Signs into the real `dev-system.ts`, which now hosts the real `FIN` beside
 * the real `SYS`, `SEC` and `FX` — so a test that says a reserved account
 * cannot be withdrawn is a test of the module that will refuse it in a shop,
 * and a test that says the chart is already there is a test of the seed that
 * puts it there.
 *
 * What this file is about is the screen: that the tree drawn from `FIN`'s own
 * arrangement is the one an accountant can read and operate, and that every
 * refusal reaches them as the sentence this product writes rather than as a
 * code. `chart.test.ts` in the module proves the rules themselves.
 */

const say = createTranslator();

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function aShopOnTheChart(): Promise<OpenShop> {
  const shop = await enterTheShop();
  await goTo(shop, catalogue['nav.chart']);
  // The chart is seeded on the first read, so nothing is on screen until it
  // has arrived — every test here starts from the shop's own accounts.
  await screen.findByRole('row', { name: /1000/ });
  return shop;
}

/**
 * The row an account's code is on.
 *
 * By the code rather than by the name, because a code is unique in a chart and
 * a name need not be: `FIN-01` keeps one cash account per currency and they all
 * share the one seeded word until a tenant renames them.
 */
function rowFor(code: string): HTMLElement {
  const row = screen.getAllByRole('row').find((candidate) => {
    const text = candidate.textContent;
    return text.startsWith(code) || text.includes(` ${code} `);
  });
  if (row === undefined) throw new Error(`No row for account "${code}".`);
  return row;
}

/** Whether an account is on screen at all, which the withdrawn switch decides. */
function isShown(code: string): boolean {
  return screen.getAllByRole('row').some((row) => row.textContent.startsWith(code));
}

/** Opens a group, so that what is under it is in the page at all. */
async function open(shop: OpenShop, code: string): Promise<void> {
  const chevron = within(rowFor(code)).queryByRole('button', {
    name: new RegExp(`^${catalogue['tree.expand']}`),
  });
  if (chevron !== null) await shop.person.click(chevron);
}

/** Adds an account through the dialog, the way an accountant would. */
async function addAccount(
  shop: OpenShop,
  fields: { readonly code: string; readonly name: string; readonly kind: string; parent?: string },
): Promise<void> {
  await shop.person.click(firstButton(catalogue['chart.add']));
  await shop.person.type(screen.getByLabelText(catalogue['chart.new.code']), fields.code);
  await shop.person.type(screen.getByLabelText(catalogue['chart.new.name']), fields.name);
  await chooseOption(shop, catalogue['chart.new.kind'], fields.kind);
  if (fields.parent !== undefined) {
    await chooseOption(shop, catalogue['chart.new.parent'], fields.parent);
  }
  await shop.person.click(screen.getByRole('button', { name: catalogue['chart.new.submit'] }));
}

/**
 * Answers a confirmation, scoped to the dialog it is in.
 *
 * The confirming control carries the same verb as the row control that opened
 * it — on purpose, since a person should read the same words twice — so the
 * page holds two of them and only one is inside the `alertdialog`.
 */
async function confirm(shop: OpenShop, label: string): Promise<void> {
  const dialog = await screen.findByRole('alertdialog');
  await shop.person.click(within(dialog).getByRole('button', { name: label }));
}

/** What a parent reads as in the chooser: the code, then the name. */
const asOption = (code: string, name: string): string => `${code} — ${name}`;

describe('Chart of accounts — FIN-01', () => {
  it('is already there on the shop’s first morning, as a tree of the five kinds', async () => {
    await aShopOnTheChart();

    // The roots, and the fact that they are roots. `aria-level` is what says
    // the depth to a reader who cannot see the indent, and it is the tree's
    // own claim rather than this screen's — so asserting it here is asserting
    // that the arrangement `FIN-01` seeded survived the journey to the page.
    for (const code of ['1000', '2000', '3000', '4000', '5000']) {
      expect(rowFor(code).getAttribute('aria-level')).toBe('1');
    }
    expect(rowFor('1000').textContent).toContain(catalogue['account.assets']);
    expect(rowFor('5000').textContent).toContain(catalogue['account.expenses']);
  });

  it('opens one cash account per currency the shop keeps, under one seeded word', async () => {
    // `FIN-01` keeps cash per currency and `FX` says which currencies there
    // are, so the four seeded currencies are four accounts under النقد والبنوك
    // — sharing the seeded name, told apart by the code beside them. Which
    // code falls to which currency is `FX`'s listing order, which is not a
    // fact this screen has any business in, so what is asserted is the set.
    const shop = await aShopOnTheChart();
    await open(shop, '1100');

    const cash = ['1101', '1102', '1103', '1104'].map((code) => rowFor(code));
    for (const row of cash) {
      expect(row.textContent).toContain(catalogue['account.cash']);
      expect(row.getAttribute('aria-level')).toBe('3');
    }
    const currencies = ['SYP', 'USD', 'TRY', 'EUR'];
    expect(currencies.filter((code) => cash.some((row) => row.textContent.includes(code)))).toEqual(
      currencies,
    );
  });

  it('marks an account the system posts to, and offers no way to take it out of use', async () => {
    // `FIN-01`'s own words: the reserved accounts are marked and cannot be
    // deleted. The screen keeps both halves — the mark on the row, and no
    // control beside it that could only ever end in a refusal.
    const shop = await aShopOnTheChart();
    await open(shop, '1300');

    const inventory = rowFor('1310');
    expect(inventory.textContent).toContain(
      say.format('chart.reserved', { purpose: catalogue['account.reserved.inventory'] }),
    );
    expect(
      within(inventory).queryByRole('button', { name: catalogue['chart.withdraw.action'] }),
    ).toBeNull();
    // Renaming one is allowed and still offered: a tenant calls its stock
    // whatever its trade calls it, and the account keeps posting to the same
    // place under the new word.
    expect(
      within(inventory).getByRole('button', { name: catalogue['chart.rename.action'] }),
    ).toBeTruthy();
  });

  it('adds an account of the tenant’s own, under the group they chose', async () => {
    const shop = await aShopOnTheChart();

    await addAccount(shop, {
      code: '5900',
      name: 'صيانة المولدة',
      kind: catalogue['account.kind.expense'],
      parent: asOption('5000', catalogue['account.expenses']),
    });

    await screen.findByText(say.format('chart.added', { name: 'صيانة المولدة' }));
    await open(shop, '5000');
    const added = rowFor('5900');
    expect(added.textContent).toContain('صيانة المولدة');
    expect(added.getAttribute('aria-level')).toBe('2');
  });

  it('refuses a code another account already carries, in FIN’s own words', async () => {
    const shop = await aShopOnTheChart();

    await addAccount(shop, {
      code: '5100',
      name: 'تكلفة أخرى',
      kind: catalogue['account.kind.expense'],
    });

    expect(
      await screen.findByText(say.format('refusal.fin.account-code-taken', { code: '5100' })),
    ).toBeTruthy();
    // The dialog stays open over the field that caused it, the rule every
    // other revision on this product follows.
    expect(screen.getByLabelText(catalogue['chart.new.code'])).toBeTruthy();
  });

  it('offers no destination of another kind, because no statement could place the balance', async () => {
    // `fin.account-kind-mismatch` is a refusal an accountant should never meet
    // here: the parent chooser is filtered to the kind being added, so the
    // choice that ends in it cannot be made. The module still judges what
    // arrives — this is the screen not offering a dead end, not the rule.
    const shop = await aShopOnTheChart();

    await shop.person.click(firstButton(catalogue['chart.add']));
    await chooseOption(shop, catalogue['chart.new.kind'], catalogue['account.kind.income']);

    const offered = await optionsOf(shop, catalogue['chart.new.parent']);
    expect(offered).toContain(asOption('4000', catalogue['account.income']));
    expect(offered).not.toContain(asOption('5000', catalogue['account.expenses']));
    // The reserved accounts are absent for the other half of the same rule:
    // the system posts to them as leaves, so nothing is put underneath one.
    expect(offered).not.toContain(asOption('4400', catalogue['account.fx-gain-loss']));
  });

  it('renames a seeded account, and the tenant’s word replaces the product’s', async () => {
    // A seeded account carries no name of its own until this happens: what was
    // on the row came from the terminology layer, and what is on it now is the
    // tenant's. The code beside it never moves.
    const shop = await aShopOnTheChart();
    await open(shop, '5000');

    await shop.person.click(
      within(rowFor('5400')).getByRole('button', { name: catalogue['chart.rename.action'] }),
    );
    const field = screen.getByLabelText(catalogue['chart.new.name']);
    await shop.person.clear(field);
    await shop.person.type(field, 'أجرة المحل');
    await shop.person.click(screen.getByRole('button', { name: catalogue['chart.rename.submit'] }));

    await screen.findByText(say.format('chart.renamed', { name: 'أجرة المحل' }));
    expect(rowFor('5400').textContent).toContain('أجرة المحل');
    expect(rowFor('5400').textContent).not.toContain(catalogue['account.rent']);
  });

  it('moves an account under another group of its kind, with everything under it', async () => {
    const shop = await aShopOnTheChart();
    await addAccount(shop, {
      code: '5910',
      name: 'وقود المولدة',
      kind: catalogue['account.kind.expense'],
    });
    await screen.findByText(say.format('chart.added', { name: 'وقود المولدة' }));

    // Added as a root of its kind, then moved under the expenses group: what
    // proves the move is the level it now sits at, which is the tree's own
    // reading of the `parent` link and not this screen's.
    expect(rowFor('5910').getAttribute('aria-level')).toBe('1');
    await shop.person.click(
      within(rowFor('5910')).getByRole('button', { name: catalogue['chart.move.action'] }),
    );
    await chooseOption(
      shop,
      catalogue['chart.new.parent'],
      asOption('5000', catalogue['account.expenses']),
      screen.getByRole('dialog'),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['chart.move.submit'] }));

    await screen.findByText(say.format('chart.moved', { name: 'وقود المولدة' }));
    await open(shop, '5000');
    expect(rowFor('5910').getAttribute('aria-level')).toBe('2');
  });

  it('never offers an account itself, or anything under it, as its own destination', async () => {
    // `fin.account-cycle`, made unreachable rather than explained: a chart with
    // a group inside itself has no roots and no statement.
    const shop = await aShopOnTheChart();
    await open(shop, '1000');

    await shop.person.click(
      within(rowFor('1100')).getByRole('button', { name: catalogue['chart.move.action'] }),
    );
    await shop.person.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: new RegExp(catalogue['chart.new.parent']),
      }),
    );

    expect(
      screen.queryByRole('option', { name: asOption('1100', catalogue['account.cash-and-bank']) }),
    ).toBeNull();
    expect(
      screen.getByRole('option', { name: asOption('1000', catalogue['account.assets']) }),
    ).toBeTruthy();
  });

  it('takes an account out of use rather than deleting it, and puts it back', async () => {
    const shop = await aShopOnTheChart();
    await addAccount(shop, {
      code: '5920',
      name: 'ضيافة',
      kind: catalogue['account.kind.expense'],
    });
    await screen.findByText(say.format('chart.added', { name: 'ضيافة' }));

    await shop.person.click(
      within(rowFor('5920')).getByRole('button', { name: catalogue['chart.withdraw.action'] }),
    );
    await confirm(shop, catalogue['chart.withdraw.action']);

    await screen.findByText(say.format('chart.withdrawn', { name: 'ضيافة' }));
    // Out of the default view, not out of the chart: every line ever posted to
    // it still names it.
    await waitFor(() => {
      expect(isShown('5920')).toBe(false);
    });

    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    await waitFor(() => {
      expect(isShown('5920')).toBe(true);
    });

    await shop.person.click(
      within(rowFor('5920')).getByRole('button', { name: catalogue['chart.restore.action'] }),
    );
    await confirm(shop, catalogue['chart.restore.action']);
    await screen.findByText(say.format('chart.restored', { name: 'ضيافة' }));
  });

  it('refuses to withdraw a group while accounts under it are still in use', async () => {
    const shop = await aShopOnTheChart();
    await open(shop, '1000');

    await shop.person.click(
      within(rowFor('1100')).getByRole('button', { name: catalogue['chart.withdraw.action'] }),
    );
    await confirm(shop, catalogue['chart.withdraw.action']);

    expect(await screen.findByText(catalogue['refusal.fin.account-has-children'])).toBeTruthy();
  });

  it('finds an account by its code or its name, and keeps the groups above it', async () => {
    // A search that dropped the groups above a hit would answer "nothing" with
    // the account sitting one level down, so the ancestors stay and are
    // opened. The chart is a tree and a tree is reached from its root.
    const shop = await aShopOnTheChart();

    await shop.person.type(
      screen.getByLabelText(catalogue['chart.search']),
      catalogue['account.rent'],
    );

    await waitFor(() => {
      expect(isShown('5400')).toBe(true);
    });
    expect(isShown('5000')).toBe(true);
    expect(isShown('1000')).toBe(false);

    const field = screen.getByLabelText(catalogue['chart.search']);
    await shop.person.clear(field);
    await shop.person.type(field, '2110');

    await waitFor(() => {
      expect(isShown('2110')).toBe(true);
    });
    expect(isShown('2100')).toBe(true);
    expect(isShown('2000')).toBe(true);
    expect(isShown('5400')).toBe(false);
  });

  it('starts a new search from the tree rather than from the last search’s shape', async () => {
    // What somebody opened or closed belongs to the search they did it under.
    // Carried across, a group collapsed while looking for one account would
    // still be collapsed over the hit for the next — a search that answers
    // "nothing" with the account sitting one level down, which is the very
    // thing the forced expansion exists to prevent.
    const shop = await aShopOnTheChart();
    const field = screen.getByLabelText(catalogue['chart.search']);

    // Looking for a till account, then closing the group it is in.
    await shop.person.type(field, '1101');
    await waitFor(() => {
      expect(isShown('1101')).toBe(true);
    });
    await shop.person.click(
      within(rowFor('1100')).getByRole('button', {
        name: new RegExp(`^${catalogue['tree.collapse']}`),
      }),
    );
    await waitFor(() => {
      expect(isShown('1101')).toBe(false);
    });

    // Now looking for a customer account, which is under a different group of
    // the same root. Carried across, the expansion left from the last search
    // would leave that group shut over the hit.
    await shop.person.clear(field);
    await shop.person.type(field, '1210');

    await waitFor(() => {
      expect(isShown('1210')).toBe(true);
    });
    expect(isShown('1200')).toBe(true);
  });

  it('lets a person close a group they have searched into, and keeps it closed', async () => {
    // The expansion a search forces is a starting point and not a cage: it
    // once reopened, on the very next render, whatever had just been collapsed.
    const shop = await aShopOnTheChart();

    await shop.person.type(screen.getByLabelText(catalogue['chart.search']), '2110');
    await waitFor(() => {
      expect(isShown('2110')).toBe(true);
    });

    await shop.person.click(
      within(rowFor('2100')).getByRole('button', {
        name: new RegExp(`^${catalogue['tree.collapse']}`),
      }),
    );

    await waitFor(() => {
      expect(isShown('2110')).toBe(false);
    });
    expect(isShown('2100')).toBe(true);
  });
});
