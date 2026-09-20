import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fixedClock } from '@vertex/kernel';

import { catalogue, createTranslator } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import {
  aTradingShop,
  chooseAccount,
  lineAt,
  recordManualEntry,
  typeDay,
  ACCRUED,
  CASH,
  NOON,
  RENT,
  TRADING_DAY,
  type EntryDraft,
} from './ledger.fixture.js';
import {
  chooseOption,
  enterTheShop,
  goTo,
  optionsOf,
  selectNamed,
  startAt,
  PEOPLE,
  type OpenShop,
} from './screens.fixture.js';

/**
 * `FIN-04`: the accountant's own entry, written by hand — with a mandatory
 * description and support for the evidence behind it.
 *
 * Signs into `dev-system.ts`, which hosts the real `FIN`, so every entry these
 * tests record is posted by the engine that posts a sale, refused by the
 * calendar that refuses one and numbered by the `SYS` series that numbers one.
 * `manual.test.ts` proves the rules; this file is about the screen an
 * accountant writes an entry on — that it takes what the books will take,
 * refuses to offer what they would not, and says what happened.
 */

const say = createTranslator();

const SHOP = { company: 'مؤسسة الشام', branch: 'حلب' };

const RENT_ACCRUAL: EntryDraft = {
  description: 'إيجار حزيران المستحق',
  lines: [
    { account: RENT, side: 'debit', amount: '1200' },
    { account: ACCRUED, side: 'credit', amount: '1200' },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

/** The field for one line's amount, which every line has its own of. */
function amountOf(ordinal: number): HTMLElement {
  return within(lineAt(ordinal)).getByLabelText(catalogue['manualEntry.line.amount']);
}

async function onTheEntryScreen(): Promise<OpenShop> {
  const shop = await aTradingShop(SHOP);
  await goTo(shop, catalogue['nav.manualEntry']);
  await screen.findByRole('heading', {
    name: say.format('manualEntry.line.ordinal', { ordinal: 1 }),
  });
  return shop;
}

describe('Manual journal entry — FIN-04', () => {
  it('records an adjusting entry, and leaves the form ready for the next one', async () => {
    const shop = await aTradingShop(SHOP);

    await recordManualEntry(shop, RENT_ACCRUAL);

    expect(await screen.findByText(catalogue['manualEntry.posted.title'])).toBeTruthy();
    expect(screen.getByRole('button', { name: catalogue['manualEntry.posted.open'] })).toBeTruthy();

    // The draft that was posted is finished with, and the next one is a new
    // draft under a new identifier — which is what makes a second entry a
    // second entry rather than a replay of the first (`ManualEntry.id` is the
    // caller's, and recording the same one twice is answered with the entry it
    // already made).
    const words: HTMLTextAreaElement = screen.getByLabelText(catalogue['manualEntry.words']);
    expect(words.value).toBe('');
    expect((amountOf(1) as HTMLInputElement).value).toBe('');
  });

  it('attaches the evidence for an entry, and keeps it with the entry', async () => {
    // `FIN-04` asks for attachment support, and the ledger records the SHA-256
    // of exactly the bytes attached — so what the field hands over is the bytes
    // and not a handle onto a disk that could answer differently on a second
    // read. The bytes here begin as a PDF actually begins, because `FIN` holds
    // a file to its stated type (`fin.attachment-content-mismatch`).
    const shop = await onTheEntryScreen();
    const chooser = globalThis.document.querySelector('input[type="file"]');
    if (chooser === null) throw new Error('The entry screen attaches nothing.');

    await shop.person.upload(
      chooser as HTMLInputElement,
      new File([new TextEncoder().encode('%PDF-1.7 1 0 obj')], 'invoice.pdf', {
        type: 'application/pdf',
      }),
    );

    expect(await screen.findByText('invoice.pdf')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: say.format('attachment.remove', { name: 'invoice.pdf' }),
      }),
    ).toBeTruthy();
  });

  it('will not record an entry with no words beside it', async () => {
    // `FIN-04` makes the description mandatory, and the screen holds the line
    // before the command does: a figure nobody explained is one an auditor has
    // to assume is wrong.
    const shop = await onTheEntryScreen();
    await typeDay(shop, TRADING_DAY);
    for (const [ordinal, line] of [RENT_ACCRUAL.lines[0], RENT_ACCRUAL.lines[1]].entries()) {
      if (line === undefined) continue;
      await chooseAccount(shop, lineAt(ordinal + 1), line.account);
      await chooseOption(
        shop,
        catalogue['manualEntry.line.side'],
        catalogue[`entry.side.${line.side}`],
        lineAt(ordinal + 1),
      );
      await shop.person.type(amountOf(ordinal + 1), line.amount);
    }

    await shop.person.click(screen.getByRole('button', { name: catalogue['manualEntry.submit'] }));

    expect(await screen.findByText(catalogue['manualEntry.words.required'])).toBeTruthy();
    expect(screen.queryByText(catalogue['manualEntry.posted.title'])).toBeNull();
  });

  it('refuses an entry whose two sides differ, and says by how much', async () => {
    // The ledger balances exactly, with no tolerance (`fin.entry-unbalanced`):
    // the residual of `FX-07` is a line the caller adds, not a rounding this
    // module performs. The screen shows the difference while it is being
    // written, and the refusal names both totals when it is submitted anyway.
    const shop = await aTradingShop(SHOP);

    await expect(
      recordManualEntry(shop, {
        ...RENT_ACCRUAL,
        lines: [
          { account: RENT, side: 'debit', amount: '1200' },
          { account: ACCRUED, side: 'credit', amount: '900' },
        ],
      }),
    ).rejects.toThrow();

    expect(screen.getByText(catalogue['manualEntry.totals.difference'])).toBeTruthy();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1200');
    expect(alert.textContent).toContain('900');
  });

  it('does not offer an account the system keeps from its own documents', async () => {
    // `CONTROL_ACCOUNTS`: inventory, cash, receivables and payables are the sum
    // of the documents that move them, and a line written onto one by hand is a
    // figure the subledger knows nothing about from that moment on. The chooser
    // leaves them out rather than the command refusing them afterwards.
    const shop = await onTheEntryScreen();
    const [field] = within(lineAt(1)).getAllByRole('combobox');
    if (field === undefined) throw new Error('No account chooser on the line.');

    await shop.person.click(field);
    await shop.person.type(field, CASH);

    expect(await screen.findByText(catalogue['manualEntry.line.account.none'])).toBeTruthy();
    expect(screen.queryByRole('option', { name: new RegExp(CASH) })).toBeNull();

    // And the one it does offer is there, so the absence above is a filter and
    // not a chooser that finds nothing at all.
    await shop.person.clear(field);
    await shop.person.type(field, RENT);
    expect(await screen.findByRole('option', { name: new RegExp(RENT) })).toBeTruthy();
  });

  it('states what the two sides come to while the entry is being written', async () => {
    const shop = await onTheEntryScreen();
    await chooseAccount(shop, lineAt(1), RENT);
    await shop.person.type(amountOf(1), '1200');

    // One side entered: the difference is the whole of it, and the screen says
    // so rather than waiting for the command to refuse.
    await waitFor(() => {
      expect(screen.getByText(catalogue['manualEntry.totals.difference'])).toBeTruthy();
    });

    await chooseAccount(shop, lineAt(2), ACCRUED);
    await chooseOption(
      shop,
      catalogue['manualEntry.line.side'],
      catalogue['entry.side.credit'],
      lineAt(2),
    );
    await shop.person.type(amountOf(2), '1200');

    await waitFor(() => {
      expect(screen.getByText(catalogue['manualEntry.totals.balanced'])).toBeTruthy();
    });
  });

  it('takes more lines than two, because an adjusting entry is not always a pair', async () => {
    const shop = await aTradingShop(SHOP);

    await recordManualEntry(shop, {
      description: 'إيجار حزيران، موزّعًا',
      lines: [
        { account: RENT, side: 'debit', amount: '700' },
        { account: RENT, side: 'debit', amount: '500' },
        { account: ACCRUED, side: 'credit', amount: '1200' },
      ],
    });

    expect(await screen.findByText(catalogue['manualEntry.posted.title'])).toBeTruthy();
  });

  it('offers every currency the shop takes, because a line is stated in the one it happened in', async () => {
    const shop = await onTheEntryScreen();

    const offered = await optionsOf(shop, catalogue['manualEntry.line.currency'], lineAt(1));

    // The books are kept in dollars (`FX-02`), and a line may still be written
    // in any currency the shop has — `FIN` values it at the branch's rate for
    // today, on the side the line's own side selects (`FX-06`).
    expect(offered).toContain('USD');
    expect(offered).toContain('SYP');
  });

  it('holds an amount to the places its own currency is kept to', async () => {
    // `MoneyInput` takes a keystroke only where what it would leave behind is
    // still an amount this currency can hold, which is
    // `fin.line-amount-too-precise` made unreachable from the control rather
    // than explained by it. The books are kept in dollars, at four places.
    const shop = await onTheEntryScreen();

    await shop.person.type(amountOf(1), '1.23456');

    expect((amountOf(1) as HTMLInputElement).value).toBe('1.2345');
  });
  it('opens on the currency the books are kept in, even landed on straight from an address', async () => {
    // The screen can be reached by its own address — a bookmark, a reload —
    // and then `FX` has not answered yet when the first draft is made. A line
    // that read its own unresolved currency would be judged **foreign**: an
    // `FX-06` override would be offered on a figure already in the books' own
    // currency, which the ledger refuses outright
    // (`fin.line-override-on-functional`), under a chooser showing nothing.
    startAt('manual-entry');
    await enterTheShop(developmentSystem({ people: PEOPLE, clock: fixedClock(NOON) }));
    await screen.findByRole('heading', {
      name: say.format('manualEntry.line.ordinal', { ordinal: 1 }),
    });

    const line = lineAt(1);
    expect(selectNamed(catalogue['manualEntry.line.currency'], line).textContent.trim()).toBe(
      'USD',
    );
    expect(screen.queryAllByText(catalogue['override.use'])).toHaveLength(0);
  });
});
