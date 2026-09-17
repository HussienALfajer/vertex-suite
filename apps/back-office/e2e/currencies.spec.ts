import { expect, test, type Page } from '@playwright/test';

import { gotoThemed } from './theme.js';

/**
 * `FX-01`: the tenant's currencies, each with its own rounding rule. `FX-02`:
 * which one the books are kept in.
 *
 * Every rule this screen enforces is already proven against the real `FX`
 * module in `currencies.test.tsx`'s jsdom harness. What a real browser adds,
 * and the only thing this file is for, is that the rendered page actually
 * works — real form controls, a real dialog, a real click — which is what
 * §13 asks a unit visible on a screen to prove once, here.
 *
 * No company or branch is registered first, unlike `organisation.spec.ts`'s
 * journeys: `FX` is tenant-wide and reads nothing from `SYS`'s structure, so
 * the four seeded currencies are on screen the moment the shop is.
 */

async function signIn(page: Page): Promise<void> {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
}

test('the four seeded currencies are ready, with USD marked as the books’ own', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'إدارة العملات' }).click();

  for (const code of ['SYP', 'USD', 'TRY', 'EUR']) {
    await expect(page.getByRole('rowheader', { name: code })).toBeVisible();
  }
  const usd = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'USD' }) });
  await expect(usd.getByText('عملة الدفاتر')).toBeVisible();
});

test('adds a currency this edition did not ship, and revises its rounding step', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'إدارة العملات' }).click();

  await page.getByRole('button', { name: 'إضافة عملة' }).click();
  await page.getByLabel('رمز العملة', { exact: true }).fill('AED');
  await page.getByLabel('الرمز المطبوع', { exact: true }).fill('د.إ');
  await page.getByLabel('خطوة التقريب', { exact: true }).fill('0.25');
  await page.getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'AED' })).toBeVisible();

  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'AED' }) });
  await row.getByRole('button', { name: 'تعديل قواعد العملة' }).click();
  await page.getByLabel('خطوة التقريب', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();

  await expect(page.getByText('حُدّثت قواعد «AED».')).toBeVisible();
});

test('adopts a different, enabled currency for the books', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'إدارة العملات' }).click();

  const eur = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'EUR' }) });
  await eur.getByRole('button', { name: 'اعتماد عملة للدفاتر' }).click();
  await page.getByRole('button', { name: 'اعتماد', exact: true }).click();

  await expect(page.getByText('صارت «EUR» عملة الدفاتر.')).toBeVisible();
  await expect(eur.getByText('عملة الدفاتر')).toBeVisible();
});
