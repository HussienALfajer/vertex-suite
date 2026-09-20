import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fixedClock, instantFrom } from '@vertex/kernel';

import { catalogue, createTranslator } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import {
  chooseOption,
  enterTheShop,
  firstButton,
  goTo,
  optionsOf,
  startAt,
  PEOPLE,
  type OpenShop,
} from './screens.fixture.js';

/**
 * `FIN-05`: the shop's fiscal years and accounting periods, each open or
 * closed, with closing a period blocking every posting dated inside it and
 * reopening one logged against a written reason.
 *
 * Signs into the real `dev-system.ts`, which hosts the real `FIN`, so the
 * calendar on screen is the one the module seeded and every refusal is the
 * module's own. `calendar.test.ts` proves the rules; this file is about the
 * screen an accountant closes a month on — that it says which months there
 * are, what closing one costs, who closed it, and that the one act this
 * product makes expensive is visibly expensive.
 *
 * **The clock is stopped**, and it has to be: the seed installs the calendar
 * year it is now, so a test that read the machine's clock would assert a
 * different year every January and a different set of period spans every
 * month. `NOON` is the middle of a year, well away from either edge of it in
 * any zone.
 */

const say = createTranslator();

/** 15 June 2026, 09:30 UTC — half past noon in `Asia/Damascus`, mid-year in any zone. */
const NOON = instantFrom(new Date(Date.UTC(2026, 5, 15, 9, 30)));

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function aShopOnTheCalendar(): Promise<OpenShop> {
  const shop = await enterTheShop(developmentSystem({ people: PEOPLE, clock: fixedClock(NOON) }));
  await goTo(shop, catalogue['nav.fiscalCalendar']);
  await screen.findByRole('tab', { name: say.format('calendar.year.tab', { year: 2026 }) });
  return shop;
}

/** The row a period's ordinal is on, found through the cell §11 makes a row header. */
function periodRow(ordinal: number): HTMLElement {
  const cell = screen.getByRole('rowheader', {
    name: say.format('calendar.period.ordinal.value', { ordinal }),
  });
  const row = cell.closest('[role="row"]');
  if (row === null) throw new Error(`No row for period ${String(ordinal)}.`);
  return row as HTMLElement;
}

/**
 * Closes a period through the dialog that says what closing one costs.
 *
 * Waits on the **row** rather than on the toast it raises: a period closed
 * twice in one test raises the same sentence twice, and two toasts with one
 * wording is not a second act — the period's own state is. The toast is
 * asserted where it is the thing being tested.
 */
async function closePeriod(shop: OpenShop, ordinal: number): Promise<void> {
  await shop.person.click(
    within(periodRow(ordinal)).getByRole('button', { name: catalogue['calendar.close.action'] }),
  );
  await shop.person.click(screen.getByRole('button', { name: catalogue['calendar.close.submit'] }));
  await waitFor(() => {
    expect(periodRow(ordinal).textContent).toContain(catalogue['calendar.period.state.closed']);
  });
}

/** Opens one again, against the reason `FIN-05` requires. */
async function reopenPeriod(shop: OpenShop, ordinal: number, reason: string): Promise<void> {
  await shop.person.click(
    within(periodRow(ordinal)).getByRole('button', { name: catalogue['calendar.reopen.action'] }),
  );
  await shop.person.type(screen.getByLabelText(catalogue['calendar.reopen.reason']), reason);
  await shop.person.click(
    screen.getByRole('button', { name: catalogue['calendar.reopen.submit'] }),
  );
  await waitFor(() => {
    expect(periodRow(ordinal).textContent).toContain(catalogue['calendar.period.state.open']);
  });
}

/**
 * One part of a date field, by what it holds.
 *
 * React Aria names a segment in the reader's own language, so `data-type` is
 * what identifies the month across every locale this product is read in — and
 * it is the same attribute the field's own styling keys off.
 */
function segmentOf(kind: 'day' | 'month' | 'year'): HTMLElement {
  const segment = globalThis.document.querySelector(`[data-type="${kind}"]`);
  if (segment === null) throw new Error(`No ${kind} segment on screen.`);
  return segment as HTMLElement;
}

describe('Fiscal calendar — FIN-05', () => {
  it('opens the shop with a year already divided into months, every one of them open', async () => {
    // Installed with the shop rather than asked for (`SYS-03`), which is why
    // there is no control here to create one: a button for an idempotent
    // installation either does nothing or runs an installation again.
    await aShopOnTheCalendar();

    expect(screen.getAllByRole('rowheader')).toHaveLength(12);
    for (const ordinal of [1, 6, 12]) {
      expect(periodRow(ordinal).textContent).toContain(catalogue['calendar.period.state.open']);
    }
    expect(
      within(periodRow(1)).getByRole('button', { name: catalogue['calendar.close.action'] }),
    ).toBeTruthy();
  });

  it('closes a period, and says who closed it and when', async () => {
    // `closed` is a fact with an author rather than a flag, so the badge and
    // the sentence beside it are two readings of one field and cannot
    // disagree. The moment is written in the tenant's own zone — an `Instant`
    // is a count of milliseconds, and a screen that interpolated one would
    // print the count.
    const shop = await aShopOnTheCalendar();
    await closePeriod(shop, 1);
    expect(await screen.findByText(say.format('calendar.closed', { ordinal: 1 }))).toBeTruthy();

    const row = periodRow(1);
    expect(row.textContent).toContain(catalogue['calendar.period.state.closed']);
    expect(row.textContent).toContain('owner');
    expect(row.textContent).toContain('2026');
    expect(row.textContent).not.toContain(String(NOON));
  });

  it('offers no ordinary way back: a closed period is reopened, not un-closed', async () => {
    const shop = await aShopOnTheCalendar();
    await closePeriod(shop, 2);

    const row = periodRow(2);
    expect(
      within(row).queryByRole('button', { name: catalogue['calendar.close.action'] }),
    ).toBeNull();
    expect(
      within(row).getByRole('button', { name: catalogue['calendar.reopen.action'] }),
    ).toBeTruthy();
  });

  it('will not reopen a period with nothing written in the reason', async () => {
    // Asked for here as well as in `FIN`, because a reason typed into a field
    // that then refuses it is a reason somebody has to type twice.
    const shop = await aShopOnTheCalendar();
    await closePeriod(shop, 3);

    await shop.person.click(
      within(periodRow(3)).getByRole('button', { name: catalogue['calendar.reopen.action'] }),
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['calendar.reopen.submit'] }),
    );

    expect(screen.getByText(catalogue['calendar.reopen.reason.required'])).toBeTruthy();
    expect(periodRow(3).textContent).toContain(catalogue['calendar.period.state.closed']);
  });

  it('opens a closed period again and writes the reason where every reader of the books sees it', async () => {
    // The whole argument for allowing it at all: the alternative is dating an
    // entry into a month it does not belong to, which is a distortion nobody
    // can see, where this is one everybody can.
    const shop = await aShopOnTheCalendar();
    await closePeriod(shop, 4);
    await reopenPeriod(shop, 4, 'فاتورة مورّد وصلت بعد الإقفال');
    expect(await screen.findByText(say.format('calendar.reopened', { ordinal: 4 }))).toBeTruthy();

    // The log, under the table: the closure it undid, who undid it, and why.
    const log = screen.getByText('فاتورة مورّد وصلت بعد الإقفال').closest('li');
    if (log === null) throw new Error('The reopening is not in the log.');
    expect(log.textContent).toContain(say.format('calendar.reopening.by', { user: 'owner' }));
    expect(log.textContent).toContain('2026');
  });

  it('keeps every reopening of the same period, not merely the last', async () => {
    // A column on the period row would have kept one. It is its own section
    // for exactly this: what was done to the books is read in full or not at
    // all.
    const shop = await aShopOnTheCalendar();

    await closePeriod(shop, 5);
    await reopenPeriod(shop, 5, 'أول سبب');
    await closePeriod(shop, 5);
    await reopenPeriod(shop, 5, 'ثاني سبب');

    await screen.findByText('ثاني سبب');
    expect(screen.getByText('أول سبب')).toBeTruthy();
  });

  it('adds the next year beginning the day after the last one ends, and never asks where', async () => {
    // "Appended without gaps" is the whole of it: a day between two years
    // belongs to no period, and nothing could say whether it is closed. So the
    // dialog states the day the year starts on rather than offering a field
    // every other answer to which `FIN` would refuse.
    const shop = await aShopOnTheCalendar();

    await shop.person.click(firstButton(catalogue['calendar.append.action']));
    expect(
      screen.getByText(say.format('calendar.append.description', { from: '01/01/2027' })),
    ).toBeTruthy();
    expect(screen.queryByLabelText(catalogue['calendar.redefine.opensOn'])).toBeNull();

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['calendar.append.submit'] }),
    );

    await screen.findByRole('tab', { name: say.format('calendar.year.tab', { year: 2027 }) });
  });

  it('redefines the last year — the shop whose books turn out to run from April', async () => {
    const shop = await aShopOnTheCalendar();

    await shop.person.click(firstButton(catalogue['calendar.redefine.action']));
    // Stepped a part at a time, which is what `DateInput` is for: the year
    // opens on 1 January, and three presses on the month alone make it April.
    // No parser of a typed date has to decide whether `03/04` is March.
    await shop.person.click(segmentOf('month'));
    await shop.person.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    await chooseOption(
      shop,
      catalogue['calendar.shape.monthsPerPeriod'],
      say.format('calendar.shape.monthsPerPeriod.value', { months: 3 }),
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['calendar.redefine.submit'] }),
    );

    await screen.findByText(
      say.format('calendar.redefined', {
        label: say.format('calendar.year.tab.spanning', { from: 2026, to: 2027 }),
      }),
    );
    // Four quarters where there were twelve months, and the year now spans two
    // calendar years, which is what its own name on the tab says.
    await waitFor(() => {
      expect(screen.getAllByRole('rowheader')).toHaveLength(4);
    });
    expect(
      screen.getByRole('tab', {
        name: say.format('calendar.year.tab.spanning', { from: 2026, to: 2027 }),
      }),
    ).toBeTruthy();
  });

  it('starts every dialog from the shape the year actually has, not from twelve months', async () => {
    // The shape is derived from the year's own periods rather than stored, so
    // that a second copy of the division cannot disagree with the spans beside
    // it. A dialog that assumed twelve would offer a shop on an eighteen-month
    // year the wrong divisors, and quietly propose shortening it.
    const shop = await aShopOnTheCalendar();

    await shop.person.click(firstButton(catalogue['calendar.redefine.action']));
    await chooseOption(
      shop,
      catalogue['calendar.shape.months'],
      say.format('calendar.shape.months.value', { months: 18 }),
    );
    await chooseOption(
      shop,
      catalogue['calendar.shape.monthsPerPeriod'],
      say.format('calendar.shape.monthsPerPeriod.value', { months: 6 }),
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['calendar.redefine.submit'] }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole('rowheader')).toHaveLength(3);
    });

    // Opened again, the dialog reads the year as it now is — eighteen months in
    // three — and the next year appended inherits it, which is what keeps a
    // shop that keeps half-years keeping them.
    await shop.person.click(firstButton(catalogue['calendar.redefine.action']));
    const lengths = await optionsOf(shop, catalogue['calendar.shape.monthsPerPeriod']);
    expect(lengths).toContain(say.format('calendar.shape.monthsPerPeriod.value', { months: 9 }));
    expect(lengths).not.toContain(
      say.format('calendar.shape.monthsPerPeriod.value', { months: 4 }),
    );
  });

  it('offers only the period lengths that divide the year exactly', async () => {
    // `fin.months-per-period-invalid` made unreachable rather than explained: a
    // period that does not tile the year leaves days in no period at all.
    const shop = await aShopOnTheCalendar();
    await shop.person.click(firstButton(catalogue['calendar.redefine.action']));

    const offered = await optionsOf(shop, catalogue['calendar.shape.monthsPerPeriod']);
    for (const months of [1, 2, 3, 4, 6, 12]) {
      expect(offered).toContain(say.format('calendar.shape.monthsPerPeriod.value', { months }));
    }
    for (const months of [5, 7, 8, 9, 10, 11]) {
      expect(offered).not.toContain(say.format('calendar.shape.monthsPerPeriod.value', { months }));
    }
  });

  it('refuses to redefine a year once one of its periods has been closed', async () => {
    // Redefining would undo somebody's decision without asking for the right
    // that reopening asks for, so it is refused in `FIN`'s own words.
    const shop = await aShopOnTheCalendar();
    await closePeriod(shop, 6);

    await shop.person.click(firstButton(catalogue['calendar.redefine.action']));
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['calendar.redefine.submit'] }),
    );

    expect(await screen.findByText(catalogue['refusal.fin.period-closed'])).toBeTruthy();
  });

  it('offers redefining on the last year alone, because changing an earlier one moves the rest', async () => {
    const shop = await aShopOnTheCalendar();
    await shop.person.click(firstButton(catalogue['calendar.append.action']));
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['calendar.append.submit'] }),
    );
    await screen.findByRole('tab', { name: say.format('calendar.year.tab', { year: 2027 }) });

    // The new year is the one being worked in, so it is the one on screen —
    // and the one that may still be redefined.
    expect(
      screen.queryByRole('button', { name: catalogue['calendar.redefine.action'] }),
    ).not.toBeNull();

    await shop.person.click(
      screen.getByRole('tab', { name: say.format('calendar.year.tab', { year: 2026 }) }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: catalogue['calendar.redefine.action'] }),
      ).toBeNull();
    });
  });
});
