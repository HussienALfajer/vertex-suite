import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@vertex/kernel';

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

/**
 * Configuring what a document number looks like, and seeing what it will print.
 *
 * The real `SYS` answers behind these screens, so the specimen under the field
 * is rendered by the same parser that will print on a receipt — which is the
 * claim this suite is here to keep true. A screen tested against a fake
 * renderer would pass on the day the two disagreed.
 */

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

async function openRegister(shop: OpenShop, name: string, prefix: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['registers.open']));
  await shop.person.type(screen.getByLabelText(catalogue['registers.new.name']), name);
  await shop.person.type(screen.getByLabelText(catalogue['registers.new.prefix']), prefix);
  await shop.person.click(screen.getByRole('button', { name: catalogue['registers.new.submit'] }));
  await screen.findByRole('rowheader', { name });
}

async function nameTheMachine(shop: OpenShop): Promise<void> {
  await shop.person.click(
    screen.getByRole('button', { name: catalogue['registers.device.action'] }),
  );
  await shop.person.type(
    screen.getByLabelText(catalogue['registers.device.label']),
    newId<'device'>(),
  );
  await shop.person.click(
    screen.getByRole('button', { name: catalogue['registers.device.submit'] }),
  );
  await screen.findByRole('rowheader', { name: 'صندوق المدخل' });
}

interface Series {
  readonly documentType: string;
  /** The till's name, or nothing for a document no till issues. */
  readonly till?: string;
  readonly fiscalYear: string;
  /** Left out to keep whatever the screen suggested, which is what is in force. */
  readonly format?: string;
}

function formatField(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(catalogue['numbering.format']);
}

/**
 * Types a format, one character at a time, which is how the specimen under the
 * field is exercised at all.
 *
 * `userEvent` reads a brace as the start of a key descriptor — `{Enter}` — so a
 * literal one is written twice. Pasting would avoid the escaping and would also
 * skip every intermediate state the field passes through, which is the part of
 * this screen worth testing.
 */
async function typeFormat(shop: OpenShop, format: string): Promise<void> {
  await shop.person.clear(formatField());
  await shop.person.type(formatField(), format.replaceAll('{', '{{'));
}

/**
 * Fills the dialog in the order somebody would.
 *
 * The till is chosen before the year on purpose: the screen suggests a format
 * once the scope is complete, and a series with a till takes a different one
 * from a series without.
 */
async function fillSeries(shop: OpenShop, series: Series): Promise<void> {
  await shop.person.click(firstButton(catalogue['numbering.define']));
  await shop.person.type(
    screen.getByLabelText(catalogue['numbering.documentType']),
    series.documentType,
  );
  if (series.till !== undefined) {
    await chooseOption(shop, catalogue['numbering.register'], series.till);
  }
  await shop.person.type(
    screen.getByLabelText(catalogue['numbering.fiscalYear']),
    series.fiscalYear,
  );
  if (series.format !== undefined) await typeFormat(shop, series.format);
}

async function save(shop: OpenShop): Promise<void> {
  await shop.person.click(screen.getByRole('button', { name: catalogue['numbering.save'] }));
}

/** A shop with one branch, standing on the numbering screen. */
async function aShopTradingFrom(...branches: readonly string[]): Promise<OpenShop> {
  const shop = await enterTheShop();
  await registerCompany(shop, 'مؤسسة الشام');
  await goTo(shop, catalogue['nav.branches']);
  for (const name of branches) await openBranch(shop, name);
  await goTo(shop, catalogue['nav.numbering']);
  return shop;
}

/** A shop whose branch has one till with a machine standing at it. */
async function aShopWithATill(): Promise<OpenShop> {
  const shop = await enterTheShop();
  await registerCompany(shop, 'مؤسسة الشام');
  await goTo(shop, catalogue['nav.branches']);
  await openBranch(shop, 'حلب');
  await goTo(shop, catalogue['nav.registers']);
  await openRegister(shop, 'صندوق المدخل', 'AL1');
  await nameTheMachine(shop);
  await goTo(shop, catalogue['nav.numbering']);
  return shop;
}

describe('Document numbering series — SYS-02', () => {
  it('says that nothing configured is a shop that is already numbering', async () => {
    const shop = await aShopTradingFrom('حلب');

    // The hardest thing this screen has to say. A shop numbers every document
    // from its first sale with nothing set up at all, so an empty list must not
    // read as setup waiting to be done.
    expect(await screen.findByText(catalogue['numbering.empty'])).toBeTruthy();
    expect(screen.getByText(catalogue['numbering.empty.explanation'])).toBeTruthy();
    expect(shop).toBeTruthy();
  });

  it('shows what a series will print before anything is printed under it', async () => {
    const shop = await aShopWithATill();

    await fillSeries(shop, {
      documentType: 'pos.sale',
      till: 'صندوق المدخل',
      fiscalYear: '2026',
    });

    // The field is filled with what is printing here today — the default,
    // since nobody has defined anything — and the specimen beside it is
    // rendered by `SYS` rather than by this screen.
    await waitFor(() => {
      expect(formatField().value).toBe('{prefix}-{generation}-{year}-{sequence:6}');
    });
    expect(await screen.findByText('AL1-1-2026-000001')).toBeTruthy();
    expect(screen.getByText(catalogue['numbering.specimen.default'])).toBeTruthy();

    await save(shop);
    // And the list shows the same thing, so the column an accountant reads is
    // what the till will actually print.
    expect(await screen.findByRole('rowheader', { name: 'pos.sale' })).toBeTruthy();
    expect(screen.getByText('AL1-1-2026-000001')).toBeTruthy();
  });

  it('refuses a format that drops the guarantee, where it can still be retyped', async () => {
    const shop = await aShopWithATill();

    await fillSeries(shop, {
      documentType: 'pos.sale',
      till: 'صندوق المدخل',
      fiscalYear: '2026',
      format: 'INV-{year}-{sequence:5}',
    });

    // Without the mark and the generation, a replacement machine could reissue
    // a number the machine it replaced had printed and not yet sent. The screen
    // says so under the field rather than on a document nobody can reprint.
    expect(
      await screen.findByText(catalogue['refusal.sys.series-format-must-carry-register']),
    ).toBeTruthy();
  });

  it('honours a format an accountant did choose, and shows what it prints', async () => {
    const shop = await aShopWithATill();

    await fillSeries(shop, {
      documentType: 'pos.sale',
      till: 'صندوق المدخل',
      fiscalYear: '2026',
      format: 'INV/{year}/{prefix}g{generation}/{sequence:4}',
    });
    expect(await screen.findByText('INV/2026/AL1g1/0001')).toBeTruthy();

    await save(shop);
    expect(await screen.findByRole('rowheader', { name: 'pos.sale' })).toBeTruthy();
    expect(screen.getByText('INV/2026/AL1g1/0001')).toBeTruthy();
  });

  it('numbers a document that no till issues, and refuses a till’s marks in its format', async () => {
    const shop = await aShopWithATill();

    await fillSeries(shop, { documentType: 'pur.invoice', fiscalYear: '2026' });
    await waitFor(() => {
      expect(formatField().value).toBe('{year}-{sequence:6}');
    });
    expect(await screen.findByText('2026-000001')).toBeTruthy();

    // Nothing would fill a till's marks here, so they are refused rather than
    // printed blank.
    await typeFormat(shop, '{prefix}-{year}-{sequence:6}');
    expect(
      await screen.findByText(catalogue['refusal.sys.series-format-carries-absent-register']),
    ).toBeTruthy();
  });

  it('says when a till has no machine, so its series has nothing to print under', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    await openBranch(shop, 'حلب');
    await goTo(shop, catalogue['nav.registers']);
    await openRegister(shop, 'صندوق المدخل', 'AL1');
    await goTo(shop, catalogue['nav.numbering']);

    await fillSeries(shop, {
      documentType: 'pos.sale',
      till: 'صندوق المدخل',
      fiscalYear: '2026',
    });

    // A generation of zero is the truth about a till nobody has plugged
    // anything into, and it is what sends somebody to the till rather than to
    // the vendor.
    expect(await screen.findByText(catalogue['numbering.specimen.noDevice'])).toBeTruthy();
    expect(screen.getByText('AL1-0-2026-000001')).toBeTruthy();
  });

  it('revises a format without offering to change which series it belongs to', async () => {
    const shop = await aShopWithATill();
    await fillSeries(shop, {
      documentType: 'pos.sale',
      till: 'صندوق المدخل',
      fiscalYear: '2026',
    });
    await save(shop);
    await screen.findByRole('rowheader', { name: 'pos.sale' });

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['numbering.revise.action'] }),
    );

    // The scope is what the series *is*: changing it here would define a second
    // series and leave this one printing exactly as before, with nothing on
    // screen saying so. So it is shown rather than offered.
    expect(await screen.findByText(catalogue['numbering.revise.note'])).toBeTruthy();
    expect(screen.queryByLabelText(catalogue['numbering.documentType'])).toBeNull();
    expect(formatField().value).toBe('{prefix}-{generation}-{year}-{sequence:6}');

    await typeFormat(shop, '{prefix}{generation}-{sequence:3}');
    await save(shop);

    expect(await screen.findByText('AL11-001')).toBeTruthy();
  });

  it('shows the series of the branch chosen and not of the one next door', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');
    await fillSeries(shop, { documentType: 'pur.invoice', fiscalYear: '2026' });
    await save(shop);
    await screen.findByRole('rowheader', { name: 'pur.invoice' });

    await chooseOption(shop, catalogue['numbering.branch'], 'حمص');

    // A series belongs to a branch, and Homs numbers its own purchase invoices
    // under its own count.
    expect(await screen.findByText(catalogue['numbering.empty'])).toBeTruthy();
  });
});
