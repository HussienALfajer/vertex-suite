import { screen, within } from '@testing-library/react';

import { fixedClock, instantFrom } from '@vertex/kernel';

import { catalogue, createTranslator } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import {
  chooseOption,
  enterTheShop,
  firstButton,
  goTo,
  PEOPLE,
  type OpenShop,
} from './screens.fixture.js';
import type { SystemOfRecord } from './system.js';

/**
 * A shop with books in it, for the five screens of `U06.7`.
 *
 * `screens.fixture.tsx` opens a shop; this one puts something in its ledger.
 * Kept apart because what is here knows about the books — a day that has to
 * fall in an open period, a chart whose codes the seed installs, an entry
 * recorded through the screen that records one — and none of it is anything
 * the organisation or security screens need.
 *
 * **The clock is stopped**, and it has to be: `FIN` seeds the calendar year it
 * is now, and every entry has to be dated inside an open period of it. A test
 * that read the machine's clock would post into a different year every January
 * and assert a different set of periods every month.
 *
 * **Nothing here is a word a person reads.** The names of the shop, its branch
 * and whatever an entry says are the tests' own, passed in — this file is
 * shipped source like every other `.tsx` (`check:policy`), and §12 allows no
 * label in it.
 */

const say = createTranslator();

/** 15 June 2026, 09:30 UTC — half past noon in `Asia/Damascus`, mid-year in any zone. */
export const NOON = instantFrom(new Date(Date.UTC(2026, 5, 15, 9, 30)));

/** A day inside the seeded fiscal year, which is the year `NOON` falls in. */
export const TRADING_DAY = { year: 2026, month: 6, day: 15 } as const;

/**
 * Two accounts a manual entry may be written onto: the rent a shop owes for
 * the month, and the accrual it owes it against.
 *
 * Both are leaves the retail chart seeds, and neither is a control account —
 * which is what makes this the ordinary adjusting entry `FIN-04` exists for.
 * The cash account is here for the tests about what a manual entry may **not**
 * touch.
 */
export const RENT = '5400';
export const ACCRUED = '2200';
export const CASH = '1101';
/** An asset and the equity that funds it, for the statement that has two sides. */
export const EQUIPMENT = '1400';
export const CAPITAL = '3100';

/** What a shop is called, which is the test's to choose and never this file's. */
export interface ShopNames {
  readonly company: string;
  readonly branch: string;
}

/**
 * A shop signed into, with a company registered and a branch open.
 *
 * Both are needed before anything can be posted at all: every journal entry
 * carries a branch (`EntryFacts`), it is numbered in that branch's series
 * (`SYS-02`), and a branch that is absent or withdrawn issues no documents.
 */
export async function aTradingShop(names: ShopNames, system?: SystemOfRecord): Promise<OpenShop> {
  const shop = await enterTheShop(
    system ?? developmentSystem({ people: PEOPLE, clock: fixedClock(NOON) }),
  );

  await shop.person.click(firstButton(catalogue['companies.register']));
  await shop.person.type(screen.getByLabelText(catalogue['companies.new.name']), names.company);
  await shop.person.click(screen.getByRole('button', { name: catalogue['companies.new.submit'] }));
  await screen.findByRole('rowheader', { name: names.company });

  await goTo(shop, catalogue['nav.branches']);
  await shop.person.click(firstButton(catalogue['branches.open']));
  await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), names.branch);
  await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
  await screen.findByRole('rowheader', { name: names.branch });

  return shop;
}

/** A calendar day as the three segments of a `DateInput` hold it. */
export interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Types a day into a date field, a part at a time.
 *
 * `data-type` identifies each part across every locale this product is read
 * in — it is what React Aria puts there and what the field's own styling keys
 * off. The order the parts are laid out in is the reader's, so a test that
 * typed into them in sequence would be testing the locale.
 */
export async function typeDay(
  shop: OpenShop,
  day: Day,
  scope: ParentNode = globalThis.document,
): Promise<void> {
  const part = (kind: string): HTMLElement => {
    const found = scope.querySelector(`[data-type="${kind}"]`);
    if (found === null) throw new Error(`No ${kind} segment on screen.`);
    return found as HTMLElement;
  };
  await shop.person.click(part('year'));
  await shop.person.keyboard(String(day.year));
  await shop.person.click(part('month'));
  await shop.person.keyboard(String(day.month).padStart(2, '0'));
  await shop.person.click(part('day'));
  await shop.person.keyboard(String(day.day).padStart(2, '0'));
}

/** The block of fields for one line of a manual entry, found by its own heading. */
export function lineAt(ordinal: number): HTMLElement {
  const heading = screen.getByRole('heading', {
    name: say.format('manualEntry.line.ordinal', { ordinal }),
  });
  const block = heading.closest('li');
  if (block === null) throw new Error(`No block for line ${String(ordinal)}.`);
  return block;
}

/**
 * Chooses an account by its code, the way an accountant does: types it, and
 * takes what the list is narrowed to.
 */
export async function chooseAccount(
  shop: OpenShop,
  scope: HTMLElement,
  code: string,
): Promise<void> {
  const [field] = within(scope).getAllByRole('combobox');
  if (field === undefined) throw new Error('No account chooser here.');
  await shop.person.click(field);
  await shop.person.type(field, code);
  await shop.person.click(await screen.findByRole('option', { name: new RegExp(code) }));
}

export interface EntryLine {
  readonly account: string;
  readonly side: 'debit' | 'credit';
  readonly amount: string;
}

export interface EntryDraft {
  readonly description: string;
  readonly day?: Day;
  readonly lines: readonly EntryLine[];
}

/**
 * Records a manual entry through the screen that records one, and waits for
 * the books to say so.
 *
 * Through the screen rather than through the port, because what these tests
 * are about is a person keeping a shop's books: the entry that comes out is
 * the one `FIN` posted, numbered by `SYS` and admitted by the calendar — and
 * every other ledger screen then reads exactly that.
 */
export async function recordManualEntry(shop: OpenShop, draft: EntryDraft): Promise<void> {
  await goTo(shop, catalogue['nav.manualEntry']);
  await screen.findByRole('heading', {
    name: say.format('manualEntry.line.ordinal', { ordinal: 1 }),
  });

  await shop.person.type(screen.getByLabelText(catalogue['manualEntry.words']), draft.description);
  await typeDay(shop, draft.day ?? TRADING_DAY);

  // Two lines are on screen from the start, because an entry has two sides; a
  // draft with more asks for them.
  for (let ordinal = 3; ordinal <= draft.lines.length; ordinal += 1) {
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['manualEntry.line.add'] }),
    );
  }

  for (const [index, line] of draft.lines.entries()) {
    const block = lineAt(index + 1);
    await chooseAccount(shop, block, line.account);
    await chooseOption(
      shop,
      catalogue['manualEntry.line.side'],
      catalogue[`entry.side.${line.side}`],
      block,
    );
    await shop.person.type(
      within(block).getByLabelText(catalogue['manualEntry.line.amount']),
      line.amount,
    );
  }

  await shop.person.click(screen.getByRole('button', { name: catalogue['manualEntry.submit'] }));
  await screen.findByText(catalogue['manualEntry.posted.title']);
}
