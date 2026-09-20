import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue, createTranslator } from './catalogue.js';
import {
  aTradingShop,
  recordManualEntry,
  typeDay,
  ACCRUED,
  RENT,
  type EntryDraft,
} from './ledger.fixture.js';
import { hrefOf, redirect } from './routing.js';
import { firstButton, goTo, startAt, type OpenShop } from './screens.fixture.js';

/**
 * `FIN-02` and `FIN-03`: every business event produces a balanced journal
 * entry, and nothing ever edits or deletes one — a correction is a reversing
 * entry that references the original.
 *
 * Signs into `dev-system.ts`, which hosts the real `FIN`, so the entries read
 * here are the ones the engine actually wrote: balanced in the functional
 * currency, numbered by `SYS` in the branch's own series, and admitted into
 * the accounting period the calendar says the day falls in. `journal.test.ts`
 * proves the engine; this file is about the screen an accountant reads the
 * books on, and the one act it offers against them.
 *
 * The events themselves are `U07`'s and later: no register exists in this
 * codebase yet, so the entries these tests read are the ones a person can make
 * today — the accountant's own (`FIN-04`), through the screen that makes them.
 * What is being asserted is the journal, not how the entry got into it.
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

/** A shop with one entry in its books, looking at the journal. */
async function aShopWithBooks(draft: EntryDraft = RENT_ACCRUAL): Promise<OpenShop> {
  const shop = await aTradingShop(SHOP);
  await recordManualEntry(shop, draft);
  await goTo(shop, catalogue['nav.journal']);
  await waitFor(() => {
    expect(journalRows()).toHaveLength(draft.lines.length > 0 ? 1 : 0);
  });
  return shop;
}

/**
 * The rows of the journal itself.
 *
 * Scoped to the listing, because the entry opened below it is a table too and
 * its lines are numbered: a count taken over the page would be counting both.
 */
function journalRows(): readonly HTMLElement[] {
  const table = screen.getByRole('grid', { name: catalogue['journal.table'] });
  // Named by a figure, because a table with nothing in it still has one row —
  // the one `DataTable` puts its empty message on — and that row is not an
  // entry.
  return within(table).queryAllByRole('rowheader', { name: /\d/ });
}

/** The first entry in the listing, and the number the books gave it. */
function theEntry(): HTMLElement {
  const [row] = journalRows();
  if (row === undefined) throw new Error('No entry in the journal.');
  return row;
}

/** Opens the entry on the row and waits for its lines. */
async function openTheEntry(shop: OpenShop): Promise<void> {
  const row = theEntry().closest('[role="row"]');
  if (row === null) throw new Error('The entry is on no row.');
  await shop.person.click(
    within(row as HTMLElement).getByRole('button', { name: catalogue['journal.open.action'] }),
  );
  await screen.findByRole('grid', { name: catalogue['journal.lines'] });
}

/** The lines table of the entry that is open. */
function lines(): HTMLElement {
  return screen.getByRole('grid', { name: catalogue['journal.lines'] });
}

describe('Journal — FIN-02, FIN-03', () => {
  it('shows the entry a posting produced, balanced, under the number the books gave it', async () => {
    await aShopWithBooks();

    const number = theEntry().textContent.trim();
    expect(number).not.toBe('');

    const row = theEntry().closest('[role="row"]');
    expect(row?.textContent).toContain(RENT_ACCRUAL.description);
    // `EntryFacts.total` is what the debit side comes to, which is what the
    // credit side comes to: one figure, because the entry balanced or it was
    // never written.
    expect(row?.textContent).toContain('1,200');
  });

  it('opens one entry, with both its sides and the accounts they landed on', async () => {
    const shop = await aShopWithBooks();

    await openTheEntry(shop);

    const written = lines().textContent;
    expect(written).toContain(RENT);
    expect(written).toContain(ACCRUED);
    expect(written).toContain(catalogue['entry.side.debit']);
    expect(written).toContain(catalogue['entry.side.credit']);
  });

  it('names the entry it is showing in the address, so it can be sent to somebody', async () => {
    // A journal is printed, filed and quoted. `routing.ts` puts the record on
    // screen into the address for exactly this.
    const shop = await aShopWithBooks();
    await openTheEntry(shop);

    expect(globalThis.location.pathname).toBe('/journal');
    expect(new URLSearchParams(globalThis.location.search).get('id')).toMatch(/[0-9a-f-]{36}/);
  });

  it('offers no way to change a posted entry, and one way to correct it', async () => {
    // `FIN-03` leaves nothing beneath this screen that could edit or delete a
    // line: `JournalOfRecord` has no such command, and the screen offers no
    // control that would need one. What it offers is a reversal.
    const shop = await aShopWithBooks();
    await openTheEntry(shop);

    expect(screen.getByRole('button', { name: catalogue['journal.reverse.action'] })).toBeTruthy();
    for (const absent of [catalogue['chart.rename.action'], catalogue['chart.withdraw.action']]) {
      expect(screen.queryAllByRole('button', { name: absent })).toHaveLength(0);
    }
  });

  it('corrects an entry by reversing it, and both stand in the journal afterwards', async () => {
    const shop = await aShopWithBooks();
    await openTheEntry(shop);
    const original = theEntry().textContent.trim();

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['journal.reverse.action'] }),
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['journal.reverse.reason']),
      'أُدخل مرتين',
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['journal.reverse.submit'] }),
    );

    // The original is untouched and says what became of it; the reversal is a
    // second entry, with its own number, marked as what it is.
    expect(await screen.findByText(catalogue['journal.reversed.title'])).toBeTruthy();
    await waitFor(() => {
      expect(journalRows()).toHaveLength(2);
    });
    expect(screen.getAllByText(catalogue['journal.badge.reversing'])).toHaveLength(1);
    expect(theEntry().textContent.trim()).toBe(original);
  });

  it('will not reverse the same entry twice', async () => {
    // An entry is reversed once (`fin.entry-already-reversed`): a second
    // correction of the same fact is a correction of the reversal. The screen
    // reads `reversalOf` and takes the control away rather than offering one
    // that would only ever be refused.
    const shop = await aShopWithBooks();
    await openTheEntry(shop);
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['journal.reverse.action'] }),
    );
    await shop.person.type(screen.getByLabelText(catalogue['journal.reverse.reason']), 'خطأ');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['journal.reverse.submit'] }),
    );
    await screen.findByText(catalogue['journal.reversed.title']);

    expect(screen.queryByRole('button', { name: catalogue['journal.reverse.action'] })).toBeNull();
  });

  it('refuses a correction dated before the thing it corrects', async () => {
    // A book that showed the cure before the illness. The day is the one field
    // on the dialog whose value the screen cannot judge for itself — the
    // original's day is on the entry, but so is a calendar that may have closed
    // since — so it is asked of `FIN` and the answer is shown where it was typed.
    const shop = await aShopWithBooks();
    await openTheEntry(shop);
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['journal.reverse.action'] }),
    );

    const dialog = screen.getByRole('dialog');
    await typeDay(shop, { year: 2026, month: 6, day: 14 }, dialog);
    await shop.person.type(screen.getByLabelText(catalogue['journal.reverse.reason']), 'خطأ');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['journal.reverse.submit'] }),
    );

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('2026');
    expect(screen.queryByText(catalogue['journal.reversed.title'])).toBeNull();
  });

  it('shows nothing outside the span it was asked for', async () => {
    const shop = await aShopWithBooks();
    expect(journalRows()).toHaveLength(1);

    // The span opens on the fiscal year the calendar defines; narrowed past the
    // entry's own day, the journal says so rather than showing it anyway.
    await typeDay(shop, { year: 2026, month: 7, day: 1 });

    await waitFor(() => {
      expect(screen.getByText(catalogue['journal.empty'])).toBeTruthy();
    });
  });

  it('keeps the evidence with the entry it was attached to', async () => {
    // `FIN-04`'s attachment is what the journal records about it — the name,
    // and the hash of exactly the bytes — and the bytes themselves are fetched
    // one at a time, only when somebody asks.
    const shop = await aTradingShop(SHOP);
    await goTo(shop, catalogue['nav.manualEntry']);
    await screen.findByRole('heading', {
      name: say.format('manualEntry.line.ordinal', { ordinal: 1 }),
    });
    const chooser = globalThis.document.querySelector('input[type="file"]');
    if (chooser === null) throw new Error('The entry screen attaches nothing.');
    await shop.person.upload(
      chooser as HTMLInputElement,
      new File([new TextEncoder().encode('%PDF-1.7 1 0 obj')], 'invoice.pdf', {
        type: 'application/pdf',
      }),
    );
    await screen.findByText('invoice.pdf');

    await recordManualEntry(shop, RENT_ACCRUAL);
    await goTo(shop, catalogue['nav.journal']);
    await waitFor(() => {
      expect(journalRows()).toHaveLength(1);
    });
    await openTheEntry(shop);

    expect(screen.getByText('invoice.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: catalogue['journal.attachment.open'] })).toBeTruthy();
  });

  it('says so, rather than showing nothing, when the address names no entry', async () => {
    // The address is text and an identifier in it may name nothing — a link
    // somebody kept, a record from another shop. `Journal.entry` answers null
    // and the screen says which, because a blank panel reads as a screen that
    // failed to load.
    await aShopWithBooks();

    redirect(hrefOf('journal', '018f0000-0000-7000-8000-000000000000'));

    expect(await screen.findByText(catalogue['journal.notFound'])).toBeTruthy();
    expect(firstButton(catalogue['journal.close'])).toBeTruthy();
  });
});
