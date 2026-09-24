import { expect, test, type Page } from '@playwright/test';
import { gotoThemed } from './theme.js';

async function press(page: Page, name: string, exact = true): Promise<void> {
  await page.getByRole('button', { name, exact }).first().focus();
  await page.keyboard.press('Enter');
}

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

async function open(page: Page, link: string): Promise<void> {
  await page.getByRole('link', { name: link }).focus();
  await page.keyboard.press('Enter');
}

/**
 * `PRC-02` `PRC-03` `PRC-11`: a frozen SYP display price, by keyboard alone.
 *
 * The rules are proven against the modules; what a browser adds is that the
 * review is usable — the rate day and revision it was derived from are on the
 * screen, a refusal is a sentence, and a dollar edit shows as a price needing
 * review instead of silently moving the shelf price.
 */
test('PRC-02 PRC-03 PRC-11 keyboard-only preview, approval, history and refusal of a frozen SYP price in both themes', async ({
  page,
}) => {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();

  // A company, one branch, and today's pound rate at it.
  await press(page, 'تسجيل شركة');
  await enter(page, 'اسم الشركة', 'مؤسسة الشام');
  await press(page, 'تسجيل');
  await expect(page.getByRole('rowheader', { name: 'مؤسسة الشام' })).toBeVisible();
  await open(page, 'الفروع');
  await press(page, 'فتح فرع');
  await enter(page, 'اسم الفرع', 'حلب');
  await press(page, 'فتح');
  await expect(page.getByRole('rowheader', { name: 'حلب' })).toBeVisible();
  await open(page, 'الأسعار اليومية');
  const pound = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'SYP' }) });
  await pound.getByRole('button', { name: 'تسجيل سعر اليوم' }).focus();
  await page.keyboard.press('Enter');
  await enter(page, 'سعر الشراء', '13100');
  await enter(page, 'سعر البيع', '12900');
  await press(page, 'تسجيل');
  await expect(page.getByText('سُجِّل سعر «SYP» لليوم.')).toBeVisible();

  // An item with a dollar price.
  await open(page, 'الأصناف والفئات');
  await enter(page, 'الاسم', 'مشروبات');
  await press(page, 'إنشاء فئة');
  await enter(page, 'الاسم', 'ماء', 1);
  await choose(page, 'فئة الصنف', 'مشروبات');
  await choose(page, 'وحدة الأساس', 'قطعة');
  await press(page, 'إنشاء صنف');
  await expect(page.getByRole('listitem').filter({ hasText: 'ماء' })).toBeVisible();
  await open(page, 'قوائم الأسعار');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await enter(page, 'ابحث عن صنف', 'ماء');
  await press(page, 'بحث');
  await press(page, 'ماء');
  const dollars = page.getByRole('group', { name: 'تجزئة pc', exact: true });
  await dollars.getByRole('button', { name: 'تعديل السعر' }).focus();
  await page.keyboard.press('Enter');
  await enter(page, 'السعر بالدولار', '1.25');
  await enter(page, 'سبب التغيير', 'تسعير أولي');
  await press(page, 'حفظ');
  await expect(dollars.getByText('1.25 USD')).toBeVisible();

  // The only branch is already chosen; nothing is frozen yet.
  const shelf = page.getByRole('group', { name: 'pc · تجزئة · سعر العرض بالليرة' });
  await expect(shelf.getByText('لم يُعتمد سعر عرض')).toBeVisible();
  await shelf.getByRole('button', { name: 'مراجعة سعر العرض' }).focus();
  await expect(shelf.getByRole('button', { name: 'مراجعة سعر العرض' })).toBeFocused();
  await page.keyboard.press('Enter');
  await press(page, 'معاينة');

  // 1.25 × 13,100 = 16,375 at the buy side, settled onto the ten-pound note —
  // with the rate, its day and its revision on the screen beside it.
  await expect(page.getByText('16,380.00', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/سعر شراء SYP لليوم .* \(المراجعة 1\): 13100 لكل 1 USD/u),
  ).toBeVisible();
  await expect(page.getByText(/قبل التقريب 16375/u)).toBeVisible();
  await expect(page.getByText(/المعاينة لا تغيّر أي سعر/u)).toBeVisible();

  // A refusal is a sentence, and nothing was frozen by it.
  await press(page, 'اعتماد السعر');
  await expect(page.getByText('أدخل سبب تعديل السعر.')).toBeVisible();
  await expect(shelf.getByText('لم يُعتمد سعر عرض')).toBeVisible();

  await enter(page, 'سبب الاعتماد', 'تسعير الرف');
  await press(page, 'اعتماد السعر');
  await expect(page.getByText('اعتُمد سعر العرض بالليرة لهذا الفرع.')).toBeVisible();
  await expect(shelf.getByText('16,380.00')).toBeVisible();
  await expect(shelf.getByText('معتمد', { exact: true })).toBeVisible();

  await shelf.getByRole('button', { name: 'سجل سعر العرض' }).focus();
  await page.keyboard.press('Enter');
  const entry = page.getByRole('row').filter({ hasText: 'تسعير الرف' });
  await expect(entry).toBeVisible();
  await expect(entry.getByText('16,380.00')).toBeVisible();

  // A new dollar price leaves the frozen figure where it was, and says so.
  await dollars.getByRole('button', { name: 'تعديل السعر' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('السعر بالدولار').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('2.00');
  await enter(page, 'سبب التغيير', 'سعر المورد');
  await press(page, 'حفظ');
  await expect(dollars.getByText('2 USD')).toBeVisible();
  await expect(shelf.getByText('يحتاج مراجعة: تغيّر السعر بالدولار')).toBeVisible();
  await expect(shelf.getByText('16,380.00')).toBeVisible();
});
