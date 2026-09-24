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
  await expect(
    page.getByRole('listitem').filter({ hasText: 'ماء — مشروبات — قطعة' }),
  ).toBeVisible();
});

test('CAT-02 CAT-12 creates tracking types and changes lifecycle by keyboard in Arabic RTL', async ({
  page,
}) => {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await page.getByRole('link', { name: 'الأصناف والفئات' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await enter(page, 'الاسم', 'فاكهة');
  await page.getByRole('button', { name: 'إنشاء فئة' }).focus();
  await page.keyboard.press('Enter');
  for (const [name, kind, unit] of [
    ['تفاح', 'موزون', 'كيلوغرام'],
    ['موز', 'متتبع بالدفعات', 'قطعة'],
    ['برتقال', 'ذو متغيرات', 'قطعة'],
    ['ليمون', 'قياسي', 'قطعة'],
  ] as const) {
    await enter(page, 'الاسم', name, 1);
    await choose(page, 'فئة الصنف', 'فاكهة');
    await choose(page, 'وحدة الأساس', unit);
    await choose(page, 'نوع التتبع', kind);
    await page.getByRole('button', { name: 'إنشاء صنف' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('listitem').filter({ hasText: name }).filter({ hasText: kind }),
    ).toBeVisible();
  }
  const apples = page.getByRole('listitem').filter({ hasText: 'تفاح' });
  await apples.getByRole('button', { name: 'عرض الحالة والسجل' }).focus();
  await page.keyboard.press('Enter');
  await enter(page, 'سبب تغيير الحالة', 'فحص المخزون');
  await page.getByRole('button', { name: 'تغيير الحالة' }).focus();
  await page.keyboard.press('Enter');
  await expect(apples.getByText('معلّق')).toBeVisible();
  await expect(page.getByText('السبب الحالي: فحص المخزون')).toBeVisible();
});
