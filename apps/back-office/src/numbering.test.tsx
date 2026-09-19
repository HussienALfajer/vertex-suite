import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@vertex/kernel';

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

async function openRegister(
  shop: OpenShop,
  name: string,
  prefix: string,
  branch?: string,
): Promise<void> {
  await shop.person.click(firstButton(catalogue['registers.open']));
  if (branch !== undefined) {
    const dialog = await screen.findByRole('dialog');
    await chooseOption(shop, catalogue['registers.new.branch'], branch, dialog);
  }
  await shop.person.type(screen.getByLabelText(catalogue['registers.new.name']), name);
  await shop.person.type(screen.getByLabelText(catalogue['registers.new.prefix']), prefix);
  await shop.person.click(screen.getByRole('button', { name: catalogue['registers.new.submit'] }));
  // All of them: two branches may well each have a till by the door.
  await screen.findAllByRole('rowheader', { name });
}

async function nameTheMachine(shop: OpenShop, till = 'صندوق المدخل'): Promise<void> {
  const [pair] = screen.getAllByRole('button', { name: catalogue['registers.device.action'] });
  if (pair === undefined) throw new Error('No till is waiting for a machine.');
  await shop.person.click(pair);
  await shop.person.type(
    screen.getByLabelText(catalogue['registers.device.label']),
    newId<'device'>(),
  );
  await shop.person.click(
    screen.getByRole('button', { name: catalogue['registers.device.submit'] }),
  );
  await screen.findByRole('rowheader', { name: till });
}

interface Series {
  readonly documentType: string;
  /** Chosen in the dialog where more than one branch could be meant; left alone where not. */
  readonly branch?: string;
  /** The till's name, or nothing for a document no till issues. */
  readonly till?: string;
  readonly fiscalYear: string;
}

/** Which mark each card is, by the words the screen gives it. */
const MARKS: Readonly<Record<string, string>> = {
  [catalogue['numbering.mark.prefix']]: 'prefix',
  [catalogue['numbering.mark.generation']]: 'generation',
  [catalogue['numbering.mark.year']]: 'year',
  [catalogue['numbering.mark.sequence']]: 'sequence',
};

/** A card's own field, named after the mark it belongs to. */
function field(key: string, mark: string): HTMLInputElement {
  const label = catalogue[key as keyof typeof catalogue].replace('{mark}', mark);
  return screen.getByLabelText<HTMLInputElement>(label);
}

/**
 * The format the builder is showing, read off its cards in order — what the
 * person at the screen sees, rather than anything the screen holds.
 */
function formatShown(): string {
  const leading = screen.getByLabelText<HTMLInputElement>(catalogue['formatBuilder.leading']);
  const handles = screen.getAllByRole('button', { name: /اسحب لإعادة ترتيب/u });
  return handles.reduce((format, handle) => {
    const label = (handle.getAttribute('aria-label') ?? '').replace('اسحب لإعادة ترتيب: ', '');
    const id = MARKS[label] ?? label;
    const width = screen.queryByLabelText<HTMLInputElement>(
      catalogue['formatBuilder.mark.width'].replace('{mark}', label),
    );
    const mark = width === null || width.value === '' ? id : `${id}:${width.value}`;
    return `${format}{${mark}}${field('formatBuilder.mark.suffix', label).value}`;
  }, leading.value);
}

/** Moves a card along the format from the keyboard: negative is earlier. */
async function move(shop: OpenShop, mark: string, by: number): Promise<void> {
  screen
    .getByRole('button', {
      name: catalogue['formatBuilder.mark.drag'].replace('{mark}', mark),
    })
    .focus();
  for (let step = 0; step < Math.abs(by); step++) {
    await shop.person.keyboard(by < 0 ? '{ArrowLeft}' : '{ArrowRight}');
  }
}

/** Replaces the text after a card. */
async function separate(shop: OpenShop, mark: string, text: string): Promise<void> {
  const after = field('formatBuilder.mark.suffix', mark);
  await shop.person.clear(after);
  if (text !== '') await shop.person.type(after, text);
}

/** Sets how many digits a card pads to. */
async function pad(shop: OpenShop, mark: string, width: string): Promise<void> {
  const digits = field('formatBuilder.mark.width', mark);
  await shop.person.clear(digits);
  await shop.person.type(digits, width);
}

const PREFIX = catalogue['numbering.mark.prefix'];
const GENERATION = catalogue['numbering.mark.generation'];
const YEAR = catalogue['numbering.mark.year'];
const SEQUENCE = catalogue['numbering.mark.sequence'];

/**
 * Fills the dialog in the order somebody would.
 *
 * The till is chosen before the year on purpose: the screen suggests a format
 * once the scope is complete, and a series with a till takes a different one
 * from a series without. Waits for that suggestion, which is where every
 * format anybody shapes starts from.
 */
async function fillSeries(shop: OpenShop, series: Series): Promise<void> {
  await shop.person.click(firstButton(catalogue['numbering.define']));
  const dialog = await screen.findByRole('dialog');
  if (series.branch !== undefined) {
    await chooseOption(shop, catalogue['numbering.branch'], series.branch, dialog);
  }
  await shop.person.type(
    screen.getByLabelText(catalogue['numbering.documentType']),
    series.documentType,
  );
  if (series.till !== undefined) {
    await chooseOption(shop, catalogue['numbering.register'], series.till, dialog);
  }
  await shop.person.type(
    screen.getByLabelText(catalogue['numbering.fiscalYear']),
    series.fiscalYear,
  );
  await screen.findByText(catalogue['numbering.specimen.default']);
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
    expect(await screen.findByText(catalogue['numbering.empty.allBranches'])).toBeTruthy();
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

    // The builder starts from what is printing here today — the default,
    // since nobody has defined anything — and the specimen beside it is
    // rendered by `SYS` rather than by this screen.
    await waitFor(() => {
      expect(formatShown()).toBe('{prefix}-{generation}-{year}-{sequence:6}');
    });
    expect(await screen.findByText('AL1-1-2026-000001')).toBeTruthy();
    expect(screen.getByText(catalogue['numbering.specimen.default'])).toBeTruthy();

    await save(shop);
    // And the list shows the same thing, so the column an accountant reads is
    // what the till will actually print.
    expect(await screen.findByRole('rowheader', { name: 'pos.sale' })).toBeTruthy();
    expect(screen.getByText('AL1-1-2026-000001')).toBeTruthy();
  });

  it('keeps a till’s two marks in its format, wherever they are put', async () => {
    const shop = await aShopWithATill();

    await fillSeries(shop, {
      documentType: 'pos.sale',
      till: 'صندوق المدخل',
      fiscalYear: '2026',
    });

    // Without the mark and the generation, a replacement machine could reissue
    // a number the machine it replaced had printed and not yet sent. So the
    // two are never a choice: the builder places them, and a person can only
    // move them.
    await move(shop, SEQUENCE, -3);
    await waitFor(() => {
      expect(formatShown()).toBe('{sequence:6}-{prefix}-{generation}-{year}');
    });
    expect(await screen.findByText('000001-AL1-1-2026')).toBeTruthy();
  });

  it('refuses two marks run together, under the builder where they can be parted', async () => {
    const shop = await aShopWithATill();
    await fillSeries(shop, {
      documentType: 'pos.sale',
      till: 'صندوق المدخل',
      fiscalYear: '2026',
    });

    // Nothing between the year and the count, and "202612" could be the year
    // 202 and the twelfth document or 2026 and the second.
    await separate(shop, YEAR, '');

    const said = createTranslator().format('refusal.sys.series-format-fields-adjacent', {
      format: '{prefix}-{generation}-{year}{sequence:6}',
    });
    expect(await screen.findByText(said)).toBeTruthy();
  });

  it('honours a format an accountant did choose, and shows what it prints', async () => {
    const shop = await aShopWithATill();

    await fillSeries(shop, {
      documentType: 'pos.sale',
      till: 'صندوق المدخل',
      fiscalYear: '2026',
    });
    await shop.person.type(screen.getByLabelText(catalogue['formatBuilder.leading']), 'INV/');
    await move(shop, YEAR, -2);
    await separate(shop, YEAR, '/');
    await separate(shop, PREFIX, 'g');
    await separate(shop, GENERATION, '/');
    await pad(shop, SEQUENCE, '4');

    expect(formatShown()).toBe('INV/{year}/{prefix}g{generation}/{sequence:4}');
    expect(await screen.findByText('INV/2026/AL1g1/0001')).toBeTruthy();

    await save(shop);
    expect(await screen.findByRole('rowheader', { name: 'pos.sale' })).toBeTruthy();
    expect(screen.getByText('INV/2026/AL1g1/0001')).toBeTruthy();
  });

  it('numbers a document that no till issues, with no till’s marks to place', async () => {
    const shop = await aShopWithATill();

    await fillSeries(shop, { documentType: 'pur.invoice', fiscalYear: '2026' });
    await waitFor(() => {
      expect(formatShown()).toBe('{year}-{sequence:6}');
    });
    expect(await screen.findByText('2026-000001')).toBeTruthy();

    // Nothing would fill a till's marks here, so the builder has no card for
    // them — the refusal `SYS` would give is never one a person can reach.
    expect(
      screen.queryByRole('button', {
        name: catalogue['formatBuilder.mark.drag'].replace('{mark}', PREFIX),
      }),
    ).toBeNull();
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
    await waitFor(() => {
      expect(formatShown()).toBe('{prefix}-{generation}-{year}-{sequence:6}');
    });

    await separate(shop, PREFIX, '.');
    await separate(shop, GENERATION, '/');
    await separate(shop, YEAR, '/');
    await pad(shop, SEQUENCE, '3');
    await save(shop);

    expect(await screen.findByText('AL1.1/2026/001')).toBeTruthy();
  });

  it('shows the series of the branch chosen and not of the one next door', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');
    await chooseOption(shop, catalogue['numbering.branch'], 'حلب');
    await fillSeries(shop, { documentType: 'pur.invoice', fiscalYear: '2026' });
    await save(shop);
    await screen.findByRole('rowheader', { name: 'pur.invoice' });

    await chooseOption(shop, catalogue['numbering.branch'], 'حمص');

    // A series belongs to a branch, and Homs numbers its own purchase invoices
    // under its own count.
    expect(await screen.findByText(catalogue['numbering.empty'])).toBeTruthy();
  });
});

describe('Every branch’s series at once — SYS-02', () => {
  /** The row a document type heads in a branch, for what else it says. */
  function rowsOf(documentType: string): readonly HTMLElement[] {
    return screen
      .getAllByRole('rowheader', { name: documentType })
      .map((header) => header.closest<HTMLElement>('[role="row"]'))
      .filter((row): row is HTMLElement => row !== null);
  }

  it('lays every branch’s series in one table, each row naming its branch', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');
    for (const branch of ['حلب', 'حمص']) {
      await fillSeries(shop, { documentType: 'pur.invoice', branch, fiscalYear: '2026' });
      await save(shop);
    }

    // The same document type, till and year in two branches is two series —
    // each numbers under its own count — and a row that did not say whose it
    // was would be two identical rows.
    await waitFor(() => {
      expect(rowsOf('pur.invoice')).toHaveLength(2);
    });
    const [first, second] = rowsOf('pur.invoice');
    if (first === undefined || second === undefined) throw new Error('Two rows were expected.');
    const named = [first, second].map((row) =>
      within(row).queryByText('حلب') === null ? 'حمص' : 'حلب',
    );
    expect([...named].sort()).toEqual(['حلب', 'حمص']);
  });

  it('asks which branch a new series belongs to, when more than one could be meant', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');

    await shop.person.click(firstButton(catalogue['numbering.define']));
    await save(shop);

    expect(await screen.findByText(catalogue['numbering.new.branch.required'])).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('tells two branches’ tills apart in the till filter, where they may share a name', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    await openBranch(shop, 'حلب');
    await openBranch(shop, 'حمص');
    await goTo(shop, catalogue['nav.registers']);
    await openRegister(shop, 'صندوق المدخل', 'AL1', 'حلب');
    await openRegister(shop, 'صندوق المدخل', 'HS1', 'حمص');
    await goTo(shop, catalogue['nav.numbering']);

    await chooseOption(
      shop,
      catalogue['numbering.filter.register'],
      catalogue['numbering.register.inBranch']
        .replace('{register}', 'صندوق المدخل')
        .replace('{branch}', 'حمص'),
    );
  });
});
