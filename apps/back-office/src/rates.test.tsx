import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue, createTranslator } from './catalogue.js';
import {
  chooseOption,
  enterTheShop,
  firstButton,
  goTo,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';

/**
 * `FX-04`: a branch's own daily rates, corrected the same day, and the
 * tenant's own suggestion beside them for a branch to adopt in one action.
 *
 * Signs into the real `dev-system.ts`, which hosts the real `FX` — the same
 * arrangement `currencies.test.tsx` uses, and for the same reason: what this
 * file proves is that the screen built on `FX` says what `FX` actually
 * decided, in the same words a refusal from the module itself would use.
 */

const say = createTranslator();

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

/** A shop with one company and one open branch, standing on the rates board. */
async function aShopOnRates(): Promise<OpenShop> {
  const shop = await enterTheShop();
  await registerCompany(shop, 'مؤسسة الشام');
  await goTo(shop, catalogue['nav.branches']);
  await openBranch(shop, 'حلب');
  await goTo(shop, catalogue['nav.rates']);
  await screen.findByRole('rowheader', { name: 'SYP' });
  return shop;
}

/** The row a currency's code is on, found through the cell §11 makes a row header. */
function rowFor(code: string): HTMLElement {
  const cell = screen.getByRole('rowheader', { name: code });
  const row = cell.closest('[role="row"]');
  if (row === null) throw new Error(`No row for "${code}".`);
  return row as HTMLElement;
}

async function recordRate(
  shop: OpenShop,
  code: string,
  action: string,
  buy: string,
  sell: string,
  submit: string,
): Promise<void> {
  await shop.person.click(within(rowFor(code)).getByRole('button', { name: action }));
  const buyField = screen.getByLabelText(catalogue['rates.field.buy']);
  await shop.person.clear(buyField);
  await shop.person.type(buyField, buy);
  const sellField = screen.getByLabelText(catalogue['rates.field.sell']);
  await shop.person.clear(sellField);
  await shop.person.type(sellField, sell);
  await shop.person.click(screen.getByRole('button', { name: submit }));
}

describe('A branch’s daily rates — FX-04', () => {
  it('shows a currency with no rate today as missing, and records its first rate', async () => {
    const shop = await aShopOnRates();

    expect(rowFor('SYP').textContent).toContain(catalogue['rates.missing']);

    await recordRate(
      shop,
      'SYP',
      catalogue['rates.record.action'],
      '13100',
      '12900',
      catalogue['rates.record.submit'],
    );

    await screen.findByText(say.format('rates.recorded', { code: 'SYP' }));
    expect(rowFor('SYP').textContent).not.toContain(catalogue['rates.missing']);
    // The row's own action switched from recording to correcting — the board's
    // own signal that this currency now has today's rate.
    expect(
      within(rowFor('SYP')).getByRole('button', { name: catalogue['rates.correct.action'] }),
    ).toBeTruthy();
  });

  it('corrects a mistyped rate with a new revision the same day, replacing the one it superseded', async () => {
    const shop = await aShopOnRates();
    await recordRate(
      shop,
      'SYP',
      catalogue['rates.record.action'],
      '13100',
      '12900',
      catalogue['rates.record.submit'],
    );
    await screen.findByText(say.format('rates.recorded', { code: 'SYP' }));

    await recordRate(
      shop,
      'SYP',
      catalogue['rates.correct.action'],
      '13200',
      '13000',
      catalogue['rates.correct.submit'],
    );
    await screen.findByText(say.format('rates.corrected', { code: 'SYP' }));

    // Reopening shows the corrected figures, not the ones it replaced.
    await shop.person.click(
      within(rowFor('SYP')).getByRole('button', { name: catalogue['rates.correct.action'] }),
    );
    expect(screen.getByLabelText<HTMLInputElement>(catalogue['rates.field.buy']).value).toBe(
      '13200',
    );
    expect(screen.getByLabelText<HTMLInputElement>(catalogue['rates.field.sell']).value).toBe(
      '13000',
    );
  });

  it('refuses a rate typed on the wrong side of the spread, and keeps the dialog open over the field', async () => {
    const shop = await aShopOnRates();

    await recordRate(
      shop,
      'SYP',
      catalogue['rates.record.action'],
      '12900',
      '13100',
      catalogue['rates.record.submit'],
    );

    await screen.findByText(
      say.format('refusal.fx.rate-spread-inverted', { buy: '12900', sell: '13100' }),
    );
    expect(screen.getByLabelText(catalogue['rates.field.buy'])).toBeTruthy();
    expect(rowFor('SYP').textContent).toContain(catalogue['rates.missing']);
  });

  it('refuses a rate for a currency taken out of use since the board was read, in words rather than by throwing', async () => {
    const shop = await aShopOnRates();
    // The one race this board can be caught in: an owner disables a currency,
    // in another tab, between this board's own read and a manager's submit.
    await shop.system.currencies.disable('TRY');

    await recordRate(
      shop,
      'TRY',
      catalogue['rates.record.action'],
      '35',
      '34',
      catalogue['rates.record.submit'],
    );

    expect(
      await screen.findByText(say.format('refusal.fx.currency-disabled', { code: 'TRY' })),
    ).toBeTruthy();
    expect(screen.getByLabelText(catalogue['rates.field.buy'])).toBeTruthy();
  });
});

describe('The tenant’s suggested rate — FX-04', () => {
  it('publishes a rate for every branch, and adopts it as a branch’s own in one action', async () => {
    const shop = await aShopOnRates();

    await shop.person.click(firstButton(catalogue['rates.suggest.action']));
    await chooseOption(shop, catalogue['rates.suggest.field.currency'], 'SYP');
    await shop.person.type(screen.getByLabelText(catalogue['rates.field.buy']), '13150');
    await shop.person.type(screen.getByLabelText(catalogue['rates.field.sell']), '12950');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['rates.suggest.submit'] }),
    );
    await screen.findByText(say.format('rates.suggested', { code: 'SYP' }));

    expect(await screen.findByText(catalogue['rates.adopt.banner.title'])).toBeTruthy();
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['rates.adopt.banner.action'] }),
    );

    await screen.findByText(say.format('rates.adopted'));
    expect(rowFor('SYP').textContent).not.toContain(catalogue['rates.missing']);
    // Adopting recorded the branch's own rate, so it is corrected from here —
    // never adopted a second time by the same action.
    expect(
      within(rowFor('SYP')).getByRole('button', { name: catalogue['rates.correct.action'] }),
    ).toBeTruthy();
    // The banner offered one action, already taken — it does not go on asking
    // for it on every visit until the owner publishes a newer suggestion.
    expect(screen.queryByText(catalogue['rates.adopt.banner.title'])).toBeNull();
  });
});

describe('Every branch’s board at once — FX-04', () => {
  /** A shop trading from two branches, standing on the rates board. */
  async function aShopOfTwoBranches(): Promise<OpenShop> {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    await openBranch(shop, 'حلب');
    await openBranch(shop, 'حمص');
    await goTo(shop, catalogue['nav.rates']);
    await screen.findAllByRole('rowheader', { name: 'SYP' });
    return shop;
  }

  /** The row for a currency at one branch, in a board that holds several. */
  function rowAt(code: string, branch: string): HTMLElement {
    const row = screen
      .getAllByRole('rowheader', { name: code })
      .map((cell) => cell.closest<HTMLElement>('[role="row"]'))
      .find((one) => one !== null && within(one).queryByText(branch) !== null);
    if (row === undefined || row === null) throw new Error(`No ${code} row at ${branch}.`);
    return row;
  }

  it('lays every branch’s board in one table, and records a rate at the row’s own branch', async () => {
    const shop = await aShopOfTwoBranches();

    await shop.person.click(
      within(rowAt('SYP', 'حمص')).getByRole('button', { name: catalogue['rates.record.action'] }),
    );
    // Nothing else on screen says where this rate goes, so the dialog does.
    expect(screen.getByText(say.format('rates.record.branch', { name: 'حمص' }))).toBeTruthy();
    await shop.person.type(screen.getByLabelText(catalogue['rates.field.buy']), '13100');
    await shop.person.type(screen.getByLabelText(catalogue['rates.field.sell']), '12900');
    await shop.person.click(screen.getByRole('button', { name: catalogue['rates.record.submit'] }));
    await screen.findByText(say.format('rates.recorded', { code: 'SYP' }));

    // A rate is one branch's: Homs has today's, Aleppo still has none.
    expect(rowAt('SYP', 'حمص').textContent).not.toContain(catalogue['rates.missing']);
    expect(rowAt('SYP', 'حلب').textContent).toContain(catalogue['rates.missing']);
  });

  it('offers to adopt a suggestion only on a board that is one branch’s', async () => {
    const shop = await aShopOfTwoBranches();
    await shop.person.click(firstButton(catalogue['rates.suggest.action']));
    await chooseOption(shop, catalogue['rates.suggest.field.currency'], 'SYP');
    await shop.person.type(screen.getByLabelText(catalogue['rates.field.buy']), '13150');
    await shop.person.type(screen.getByLabelText(catalogue['rates.field.sell']), '12950');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['rates.suggest.submit'] }),
    );
    await screen.findByText(say.format('rates.suggested', { code: 'SYP' }));

    // Adopting records a branch's own rate. One action over both boards would
    // decide it for a manager who has not seen the suggestion.
    expect(screen.queryByText(catalogue['rates.adopt.banner.title'])).toBeNull();

    await chooseOption(shop, catalogue['rates.branch'], 'حمص');
    expect(await screen.findByText(catalogue['rates.adopt.banner.title'])).toBeTruthy();
  });
});
