import { expect, test, type Page } from '@playwright/test';

import { gotoThemed } from './theme.js';

/**
 * `FX-04`: a branch's own daily rate board.
 *
 * Every rule this screen enforces is already proven against the real `FX`
 * module in `rates.test.tsx`'s jsdom harness. What a real browser adds, and
 * the only thing this file is for, is that the rendered page actually
 * works — a real dialog, a real click, a real column wide enough for what
 * `CurrencyRate` puts in it — which is what §13 asks a unit visible on a
 * screen to prove once, here.
 *
 * Unlike `currencies.spec.ts`, this board is scoped to a branch, so the
 * journey opens one first — the same setup `organisation.spec.ts` uses.
 */

async function signIn(page: Page): Promise<void> {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
}

async function aShopTradingFromAleppo(page: Page): Promise<void> {
  await signIn(page);

  await page.getByRole('button', { name: 'تسجيل شركة' }).first().click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('مؤسسة الشام');
  await page.getByRole('button', { name: 'تسجيل', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'مؤسسة الشام' })).toBeVisible();

  await page.getByRole('link', { name: 'الفروع' }).click();
  await page.getByRole('button', { name: 'فتح فرع' }).first().click();
  await page.getByLabel('اسم الفرع', { exact: true }).fill('حلب');
  await page.getByRole('button', { name: 'فتح', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'حلب' })).toBeVisible();

  await page.getByRole('link', { name: 'الأسعار اليومية' }).click();
  await expect(page.getByRole('rowheader', { name: 'SYP' })).toBeVisible();
}

test('records today’s rate for a currency, shown on the board with no rate missing', async ({
  page,
}) => {
  await aShopTradingFromAleppo(page);

  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'SYP' }) });
  await expect(row.getByText('لا يوجد سعر اليوم').first()).toBeVisible();

  await row.getByRole('button', { name: 'تسجيل سعر اليوم' }).click();
  await page.getByLabel('سعر الشراء', { exact: true }).fill('13100');
  await page.getByLabel('سعر البيع', { exact: true }).fill('12900');
  await page.getByRole('button', { name: 'تسجيل', exact: true }).click();

  await expect(page.getByText('سُجِّل سعر «SYP» لليوم.')).toBeVisible();
  await expect(row.getByText('لا يوجد سعر اليوم')).toBeHidden();
  // The column is wide enough for `CurrencyRate`'s rate, both currency codes
  // and its date on one line — the defect a narrow column once hid by
  // overlapping this text with the sell column's.
  await expect(row.getByText('13,100.00 SYP / 1 USD')).toBeVisible();
});

test('publishes a suggested rate for every branch, and adopts it in one action', async ({
  page,
}) => {
  await aShopTradingFromAleppo(page);

  await page.getByRole('button', { name: 'اقتراح سعر لكل الفروع' }).click();
  await page.getByLabel('سعر الشراء', { exact: true }).fill('13150');
  await page.getByLabel('سعر البيع', { exact: true }).fill('12950');
  await page.getByRole('button', { name: 'نشر', exact: true }).click();
  await expect(page.getByText('نُشر سعر مقترح لـ')).toBeVisible();

  await expect(page.getByText('يوجد سعر مقترح لهذا اليوم')).toBeVisible();
  await page.getByRole('button', { name: 'تبنّي السعر المقترح' }).click();
  await expect(page.getByText('تبنّى هذا الفرع السعر المقترح.')).toBeVisible();
  // The banner offered one action, already taken — it does not go on asking
  // for it on every visit until the owner publishes a newer suggestion.
  await expect(page.getByText('يوجد سعر مقترح لهذا اليوم')).toBeHidden();
});
