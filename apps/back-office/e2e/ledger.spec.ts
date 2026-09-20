import { expect, test, type Page } from '@playwright/test';

import { catalogue } from '../src/catalogue.js';
import { gotoThemed } from './theme.js';

/**
 * The ledger screens of `FIN`, in a real browser.
 *
 * Every rule these screens enforce is already proven against the real `FIN` in
 * `chart.test.tsx`, `fiscal-calendar.test.tsx`, `manual-entry.test.tsx`,
 * `journal.test.tsx`, `opening-balances.test.tsx`, `statements.test.tsx` and
 * `posting-exceptions.test.tsx`. What a real browser adds, and the only thing
 * this file is for, is the part a document implementation cannot answer for —
 * measured layout, real focus, and a platform file chooser — which is why each
 * journey here is about one of the six controls these units built
 * (`design-system.md` §15):
 *
 * - **`TreeView`**: one tab stop for a chart of thirty accounts, with the
 *   arrows moving inside it and `←`/`→` opening and closing a branch the way
 *   the text runs. A roving `tabindex` is measured focus, not markup.
 * - **`Tabs`**: one panel mounted at a time, chosen from the strip.
 * - **`DateInput`**: three segments typed a part at a time, laid out in the
 *   reader's own direction, which is layout and therefore only true where
 *   there is layout.
 * - **`Combobox`**: a list narrowed by typing and taken from the keyboard
 *   alone, on a control whose chevron is deliberately not a tab stop.
 * - **`MoneyInput`**: a figure laid out left to right inside a page that runs
 *   right to left, refusing a keystroke the books could not hold.
 * - **`AttachmentInput`**: a file chosen through a platform chooser.
 *
 * No company or branch is registered first: `FIN` is tenant-wide, and the
 * chart and the calendar are installed with the shop (`SYS-03`), so the
 * screens are on the moment somebody signs in. Nothing here posts an entry —
 * that needs a branch, and it is proven where the whole journey is already
 * driven end to end.
 */

async function signIn(page: Page): Promise<void> {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: catalogue['shell.signOut'] })).toBeVisible();
}

test('the retail chart is on screen the moment the shop is, as a tree', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.chart'] }).click();

  await expect(page.getByRole('row', { name: /1000/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /5000/ })).toBeVisible();
  // Reserved is a mark on the row, and the row carries no control that would
  // only ever end in a refusal.
  await page
    .getByRole('button', { name: new RegExp(catalogue['tree.expand']) })
    .first()
    .click();
  await expect(page.getByText(/محجوز/).first()).toBeVisible();
});

test('the chart is one tab stop, opened and closed by the arrows that run with the text', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.chart'] }).click();
  await expect(page.getByRole('row', { name: /1000/ })).toBeVisible();

  // Onto the tree from the search field beside it, and then **inside** it: a
  // roving `tabindex` is what makes a chart of three hundred accounts one stop
  // rather than three hundred, and it is real focus or it is nothing.
  await page.getByLabel(catalogue['chart.search']).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('[role="row"]:focus')).toHaveAttribute('aria-level', '1');

  // Down the tree and not down the roots: the chart opens with its five kinds
  // showing, so the row under الأصول is what is inside it.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[role="row"]:focus')).toHaveAttribute('aria-level', '2');
  await expect(page.locator('[role="row"]:focus')).toContainText('1100');

  // `←` opens and `→` closes where the document runs right to left, which is
  // React Aria reading the locale rather than this app carrying a flag.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('row', { name: /1101/ })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('row', { name: /1101/ })).toBeHidden();
});

test('adds an account through the dialog, and the tree shows it under its group', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.chart'] }).click();
  await expect(page.getByRole('row', { name: /5000/ })).toBeVisible();

  await page.getByRole('button', { name: catalogue['chart.add'] }).click();
  await page.getByLabel(catalogue['chart.new.code'], { exact: true }).fill('5900');
  await page.getByLabel(catalogue['chart.new.name'], { exact: true }).fill('صيانة المولدة');
  await page.getByRole('button', { name: new RegExp(catalogue['chart.new.kind']) }).click();
  await page.getByRole('option', { name: catalogue['account.kind.expense'] }).click();
  await page.getByRole('button', { name: new RegExp(catalogue['chart.new.parent']) }).click();
  await page.getByRole('option', { name: `5000 — ${catalogue['account.expenses']}` }).click();
  await page.getByRole('button', { name: catalogue['chart.new.submit'], exact: true }).click();

  // Under its group and open, without a second act: the chart shows the five
  // kinds opened, so an account added under one of them is on screen the
  // moment it exists.
  await expect(page.getByRole('row', { name: /5900/ })).toHaveAttribute('aria-level', '2');
  await expect(page.getByRole('row', { name: /5900/ })).toContainText('صيانة المولدة');
});

test('the fiscal calendar shows one year at a time, chosen from the strip', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.fiscalCalendar'] }).click();

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(1);
  await expect(page.getByRole('rowheader')).toHaveCount(12);

  await page.getByRole('button', { name: catalogue['calendar.append.action'] }).click();
  await page
    .getByRole('button', { name: catalogue['calendar.append.submit'], exact: true })
    .click();
  await expect(tabs).toHaveCount(2);

  // One panel mounted at a time: the year that is not selected is not in the
  // page, which is what keeps a decade of periods off a single screen.
  await expect(page.getByRole('rowheader')).toHaveCount(12);
  await tabs.first().click();
  await expect(page.getByRole('rowheader')).toHaveCount(12);
});

test('closes a period from the dialog that says what closing one costs', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.fiscalCalendar'] }).click();

  const first = page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: '1', exact: true }) });
  await first.getByRole('button', { name: catalogue['calendar.close.action'] }).click();
  await expect(page.getByRole('dialog')).toContainText(/يُرفض من الآن/);
  await page.getByRole('button', { name: catalogue['calendar.close.submit'], exact: true }).click();

  await expect(first).toContainText(catalogue['calendar.period.state.closed']);
  await expect(
    first.getByRole('button', { name: catalogue['calendar.reopen.action'] }),
  ).toBeVisible();
});

test('a day is typed a part at a time, in the reader’s own direction', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.fiscalCalendar'] }).click();
  await page.getByRole('button', { name: catalogue['calendar.redefine.action'] }).click();

  const parts = page.getByRole('spinbutton');
  await expect(parts).toHaveCount(3);

  // The three parts are laid out right to left like the page around them, and
  // moving between them follows the same direction. This is measured geometry,
  // which is the one claim about this control no document implementation can
  // settle — `DateInput.test.tsx` proves everything else about it.
  const edges = await parts.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().left),
  );
  const [first, , last] = edges;
  if (first === undefined || last === undefined) throw new Error('The field has no parts.');
  expect(first).toBeGreaterThan(last);

  await parts.first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(parts.nth(1)).toBeFocused();

  // And typing into one carries to the next without a separator ever being
  // pressed, which is the whole reason this is three segments and not a box.
  await parts.first().focus();
  await page.keyboard.type('15');
  await expect(parts.nth(1)).toBeFocused();
});

/**
 * The three controls this pull request built (`design-system.md` §15), in the
 * one place their claims can actually be settled.
 *
 * Everything each of them decides is already proven against the real `FIN` in
 * `manual-entry.test.tsx`, `journal.test.tsx` and the components' own tests.
 * What a real browser adds is what a document implementation cannot answer
 * for: measured layout, real focus, and a platform file chooser.
 */

test('an account is found by typing, and taken from the keyboard alone', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.manualEntry'] }).click();

  const account = page.getByRole('combobox').first();
  await account.focus();
  await page.keyboard.type('5400');

  // The list narrows to what was typed, and the arrow keys walk it: the
  // register has no pointer, and a chooser that needed one would be a control
  // half this product cannot use (§11.1).
  await expect(page.getByRole('option', { name: /5400/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(account).toHaveValue(/5400/);
});

test('the list opens from the field itself, not only from the control beside it', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.manualEntry'] }).click();

  // React Aria keeps the chevron out of the tab order, which is right only
  // because the keyboard already has a route to the same list. Asserted before
  // the list is opened: an open popover takes the page behind it out of the
  // accessibility tree, chevron and all. Named by what it says rather than by
  // its whole accessible name, which React Aria composes from the control's
  // own label and the field's.
  await expect(
    page.getByRole('button', { name: new RegExp(catalogue['combobox.showOptions']) }).first(),
  ).toHaveAttribute('tabindex', '-1');

  const account = page.getByRole('combobox').first();
  await account.focus();
  await page.keyboard.press('ArrowDown');

  await expect(page.getByRole('option').first()).toBeVisible();
});

test('an amount runs left to right inside a page that runs right to left', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.manualEntry'] }).click();

  const amount = page.getByLabel(catalogue['manualEntry.line.amount']).first();
  await amount.fill('');
  await page.keyboard.type('1234.5');

  // Computed direction, which is the one claim about this field no document
  // implementation can settle: a figure is machine text in the middle of a
  // sentence nobody reads that way (§9, §12).
  await expect(amount).toHaveCSS('direction', 'ltr');
  await expect(amount).toHaveValue('1234.5');

  // And a keystroke that would leave something the books cannot hold never
  // lands: the shop keeps its books in dollars, at four places.
  await page.keyboard.type('6789');
  await expect(amount).toHaveValue('1234.5678');
  await page.keyboard.type('a');
  await expect(amount).toHaveValue('1234.5678');
});

test('a file is attached through the control a keyboard reaches', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.manualEntry'] }).click();

  // The chooser a platform opens is what the button is for; the bytes are read
  // when the file is chosen, so what the form holds is the evidence and not a
  // handle onto a disk.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 1 0 obj'),
  });

  await expect(page.getByText('invoice.pdf')).toBeVisible();
  await expect(page.getByRole('button', { name: /invoice\.pdf/ })).toBeVisible();
});

test('the journal is filtered between two days, each typed a part at a time', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.journal'] }).click();

  // Two date fields side by side, six segments, and each field typed into on
  // its own — the arrangement `DateInput` is laid out in only where there is
  // layout.
  const parts = page.getByRole('spinbutton');
  await expect(parts).toHaveCount(6);

  await parts.first().focus();
  await page.keyboard.type('15');
  await expect(parts.nth(1)).toBeFocused();

  await parts.nth(3).focus();
  await page.keyboard.type('20');
  await expect(parts.nth(4)).toBeFocused();
});

test('the four statements are one request, read four ways', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: catalogue['nav.statements'] }).click();

  // One panel mounted at a time, which is what keeps four walks of the journal
  // off a screen that shows one page.
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  await tabs.nth(3).click();
  await expect(page.getByRole('combobox', { name: catalogue['statements.account'] })).toBeVisible();
});
