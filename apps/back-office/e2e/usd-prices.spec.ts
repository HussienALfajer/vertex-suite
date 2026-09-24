import { expect, test, type Page } from '@playwright/test';
import { gotoThemed } from './theme.js';

async function enter(page: Page, label: string, value: string, index = 0): Promise<void> {
  await page.getByLabel(label, { exact: true }).nth(index).focus();
  await page.keyboard.type(value);
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: option }).focus();
  await page.keyboard.press('Enter');
}

test('PRC-01 PRC-02 PRC-11 keyboard-only USD pricing for two units and audit in both themes', async ({
  page,
}) => {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await page.getByRole('link', { name: 'الأصناف والفئات' }).focus();
  await page.keyboard.press('Enter');
  await enter(page, 'الاسم', 'مشروبات');
  await page.getByRole('button', { name: 'إنشاء فئة' }).focus();
  await page.keyboard.press('Enter');
  await enter(page, 'الاسم', 'ماء', 1);
  await choose(page, 'فئة الصنف', 'مشروبات');
  await choose(page, 'وحدة الأساس', 'قطعة');
  await page.getByRole('button', { name: 'إنشاء صنف' }).focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'ماء' })
    .getByRole('button', { name: 'عرض الحالة والسجل' })
    .focus();
  await page.keyboard.press('Enter');
  await enter(page, 'رمز الوحدة الجديدة', 'carton');
  await enter(page, 'عدد وحدات الأساس في الوحدة الجديدة', '12');
  await page.getByRole('button', { name: 'إضافة وحدة' }).focus();
  await page.keyboard.press('Enter');

  await page.getByRole('link', { name: 'قوائم الأسعار' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await enter(page, 'ابحث عن صنف', 'ماء');
  await page.getByRole('button', { name: 'بحث' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'ماء', exact: true }).focus();
  await page.keyboard.press('Enter');
  const retailPiece = page.getByRole('group', { name: 'تجزئة pc' });
  const wholesaleCarton = page.getByRole('group', { name: 'جملة carton', exact: true });
  await expect(retailPiece.getByText('غير مسعّر')).toBeVisible();
  await retailPiece.getByRole('button', { name: 'تعديل السعر' }).focus();
  await expect(retailPiece.getByRole('button', { name: 'تعديل السعر' })).toBeFocused();
  await page.keyboard.press('Enter');
  await enter(page, 'السعر بالدولار', '1.25');
  await enter(page, 'سبب التغيير', 'تسعير أولي');
  await page.getByRole('button', { name: 'حفظ', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(retailPiece.getByText('1.25 USD')).toBeVisible();

  await wholesaleCarton.getByRole('button', { name: 'تعديل السعر' }).focus();
  await page.keyboard.press('Enter');
  await enter(page, 'السعر بالدولار', '15.00');
  await enter(page, 'سبب التغيير', 'سعر الكرتون');
  await page.getByRole('button', { name: 'حفظ', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(wholesaleCarton.getByText('15 USD')).toBeVisible();
  await retailPiece.getByRole('button', { name: 'سجل تغييرات السعر' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('row').filter({ hasText: 'تسعير أولي' })).toBeVisible();
  await retailPiece.getByRole('button', { name: 'تعديل السعر' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('السعر بالدولار').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('0');
  await enter(page, 'سبب التغيير', 'تصحيح تجريبي');
  await page.getByRole('button', { name: 'حفظ', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/أدخل سعرًا بالدولار أكبر من الصفر/u)).toBeVisible();
  await expect(retailPiece.getByText('1.25 USD')).toBeVisible();
});
