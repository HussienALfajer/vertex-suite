import { expect, test, type Page } from '@playwright/test';

import { catalogue } from '../src/catalogue.js';
import { gotoThemed } from './theme.js';

/**
 * `FIN-01`'s chart of accounts and `FIN-05`'s fiscal calendar, in a real
 * browser.
 *
 * Every rule these two screens enforce is already proven against the real
 * `FIN` in `chart.test.tsx` and `fiscal-calendar.test.tsx`. What a real browser
 * adds, and the only thing this file is for, is the part a document
 * implementation cannot answer for — the three controls this pull request
 * built (`design-system.md` §15):
 *
 * - **`TreeView`**: one tab stop for a chart of thirty accounts, with the
 *   arrows moving inside it and `←`/`→` opening and closing a branch the way
 *   the text runs. A roving `tabindex` is measured focus, not markup.
 * - **`Tabs`**: one panel mounted at a time, chosen from the strip.
 * - **`DateInput`**: three segments typed a part at a time, laid out in the
 *   reader's own direction, which is layout and therefore only true where
 *   there is layout.
 *
 * No company or branch is registered first: `FIN` is tenant-wide, and the
 * chart and the calendar are installed with the shop (`SYS-03`), so both are
 * on screen the moment somebody signs in.
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
