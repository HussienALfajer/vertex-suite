import { expect, test, type Page } from '@playwright/test';
import { gotoThemed } from './theme.js';

async function enter(page: Page, label: string, text: string, index = 0): Promise<void> {
  await page.getByLabel(label, { exact: true }).nth(index).focus();
  await page.keyboard.type(text);
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: option }).focus();
  await page.keyboard.press('Enter');
}

test('CAT-01 creates a category and a standard item using the Arabic RTL keyboard flow', async ({
  page,
}) => {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
  await page.getByRole('link', { name: 'الأصناف والفئات' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await enter(page, 'الاسم', 'مشروبات');
  await page.getByRole('button', { name: 'إنشاء فئة' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('row', { name: 'مشروبات' })).toBeVisible();

  await enter(page, 'الاسم', 'ماء', 1);
  await choose(page, 'فئة الصنف', 'مشروبات');
  await choose(page, 'وحدة الأساس', 'قطعة');
  await page.getByRole('button', { name: 'إنشاء صنف' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('ماء — مشروبات — قطعة')).toBeVisible();
});
