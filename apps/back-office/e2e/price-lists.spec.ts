import { expect, test } from '@playwright/test';
import { gotoThemed } from './theme.js';

test('PRC-01 keyboard-only Arabic RTL journey creates and renames a fourth price list in both themes', async ({
  page,
}) => {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await page.getByRole('link', { name: 'قوائم الأسعار' }).focus();
  await expect(page.getByRole('link', { name: 'قوائم الأسعار' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'قوائم الأسعار' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'تجزئة' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'نصف جملة' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'جملة', exact: true })).toBeVisible();
  await page.getByLabel('اسم القائمة').focus();
  await page.keyboard.type('شركاء');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('rowheader', { name: 'شركاء' })).toBeVisible();
  const row = page.getByRole('row', { name: /شركاء/u });
  await row.getByRole('button', { name: 'تغيير الاسم' }).focus();
  await expect(row.getByRole('button', { name: 'تغيير الاسم' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('الاسم الجديد').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('شركاء مميزون');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('rowheader', { name: 'شركاء مميزون' })).toBeVisible();
});
