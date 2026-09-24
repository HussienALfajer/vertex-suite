import { expect, test, type Page } from '@playwright/test';
import { gotoThemed } from './theme.js';

async function enter(page: Page, label: string, text: string, index = 0): Promise<void> {
  await page.getByLabel(label, { exact: true }).nth(index).focus();
  await page.keyboard.type(text);
}

async function retype(page: Page, label: string, text: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+A');
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

test('CAT-08 adds an item unit and previews an exact stock quantity by keyboard', async ({
  page,
}) => {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await page.getByRole('link', { name: 'الأصناف والفئات' }).focus();
  await page.keyboard.press('Enter');
  await enter(page, 'الاسم', 'أدوات');
  await page.getByRole('button', { name: 'إنشاء فئة' }).focus();
  await page.keyboard.press('Enter');
  await enter(page, 'الاسم', 'قلم', 1);
  await choose(page, 'فئة الصنف', 'أدوات');
  await choose(page, 'وحدة الأساس', 'قطعة');
  await page.getByRole('button', { name: 'إنشاء صنف' }).focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'قلم' })
    .getByRole('button', { name: 'عرض الحالة والسجل' })
    .focus();
  await page.keyboard.press('Enter');
  await enter(page, 'رمز الوحدة الجديدة', 'pack');
  await enter(page, 'عدد وحدات الأساس في الوحدة الجديدة', '6');
  await page.getByRole('button', { name: 'إضافة وحدة' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('code').filter({ hasText: 'pack' })).toHaveAttribute('dir', 'ltr');
  await enter(page, 'كمية المعاينة', '2');
  await choose(page, 'من وحدة', 'pack');
  await expect(
    page.getByRole('button', { name: 'pack من وحدة' }).locator('[dir="ltr"]'),
  ).toHaveText('pack');
  await page.getByRole('button', { name: 'معاينة التحويل' }).focus();
  await page.keyboard.press('Enter');
  const result = page
    .locator('p')
    .filter({ has: page.locator('span[dir="ltr"]', { hasText: '12' }) });
  await expect(result).toBeVisible();
  await expect(result.getByText('قطعة')).toBeVisible();
});

test('CAT-04 registers barcodes per unit, finds an item by any of them, and withdraws one by keyboard', async ({
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
  await enter(page, 'الاسم', 'شاي', 1);
  await choose(page, 'فئة الصنف', 'مشروبات');
  await choose(page, 'وحدة الأساس', 'قطعة');
  await page.getByRole('button', { name: 'إنشاء صنف' }).focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'شاي' })
    .getByRole('button', { name: 'عرض الحالة والسجل' })
    .focus();
  await page.keyboard.press('Enter');
  await enter(page, 'رمز الوحدة الجديدة', 'carton');
  await enter(page, 'عدد وحدات الأساس في الوحدة الجديدة', '24');
  await page.getByRole('button', { name: 'إضافة وحدة' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('تمت إضافة الوحدة.')).toBeVisible();

  // The manufacturer's code, for a single piece.
  await enter(page, 'الباركود الجديد', '036000291452');
  await page.getByRole('button', { name: 'إضافة باركود' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('تمت إضافة الباركود.')).toBeVisible();
  // The carton's own code, bound to the carton.
  await enter(page, 'الباركود الجديد', 'CASE-24');
  await choose(page, 'الوحدة التي يمثلها الباركود', 'carton');
  await page.getByRole('button', { name: 'إضافة باركود' }).focus();
  await page.keyboard.press('Enter');
  const carton = page.getByRole('listitem').filter({ hasText: 'CASE-24' });
  await expect(carton.getByText('فعّال')).toBeVisible();
  await expect(carton.locator('code')).toHaveAttribute('dir', 'ltr');

  // A second registration of the same GTIN, in its EAN-13 spelling, is refused and names the holder.
  await enter(page, 'الباركود الجديد', '0036000291452');
  await page.getByRole('button', { name: 'إضافة باركود' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('الباركود «0036000291452» مسجّل بالفعل للصنف «شاي».')).toBeVisible();

  const result = page.getByRole('status', { name: 'نتيجة البحث بالباركود' });
  await enter(page, 'امسح الباركود أو اكتبه', '0036000291452');
  await page.keyboard.press('Enter');
  await expect(result).toContainText('شاي — قطعة');
  await retype(page, 'امسح الباركود أو اكتبه', 'CASE-24');
  await page.keyboard.press('Enter');
  await expect(result).toContainText('شاي — كرتون');

  await choose(page, 'الباركود المراد تغيير حالته', 'CASE-24');
  await enter(page, 'سبب تغيير حالة الباركود', 'تغيّر المورّد');
  await page.getByRole('button', { name: 'سحب الباركود' }).focus();
  await page.keyboard.press('Enter');
  await expect(carton.getByText('مسحوب')).toBeVisible();
  await expect(carton).toContainText('تغيّر المورّد');
  // Withdrawn, and still readable: the lookup names the item, the unit and the state.
  await retype(page, 'امسح الباركود أو اكتبه', 'CASE-24');
  await page.keyboard.press('Enter');
  await expect(result).toContainText('شاي — كرتون');
  await expect(result.getByText('مسحوب')).toBeVisible();
});
