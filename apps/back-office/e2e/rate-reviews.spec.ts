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

/**
 * Reaches a control in a grid row as the keyboard does: the row, then across
 * its cells — which run leftward in Arabic — until the control has focus.
 */
async function inRow(page: Page, row: ReturnType<Page['getByRole']>, name: string): Promise<void> {
  await row.focus();
  const control = row.getByRole('button', { name });
  for (let step = 0; step < 8; step += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('ArrowLeft');
  }
  await expect(control).toBeFocused();
  await page.keyboard.press('Enter');
}

async function open(page: Page, link: string): Promise<void> {
  await page.getByRole('link', { name: link }).focus();
  await page.keyboard.press('Enter');
}

/**
 * Records today's pound rate at the only branch, or corrects it.
 *
 * Setup, and by pointer as `rates.spec.ts` records one: that screen's own
 * keyboard journey is its own, and this one's claim is the review.
 */
async function poundRate(page: Page, buy: string, action: string): Promise<void> {
  await open(page, 'الأسعار اليومية');
  const pound = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'SYP' }) });
  await pound.getByRole('button', { name: action }).click();
  const field = page.getByLabel('سعر الشراء', { exact: true });
  await field.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(buy);
  const sell = page.getByLabel('سعر البيع', { exact: true });
  await sell.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('9000');
  await press(page, action === 'تسجيل سعر اليوم' ? 'تسجيل' : 'حفظ');
  await expect(
    page.getByText(/سُجِّل سعر «SYP» لليوم|صُحِّح سعر «SYP» لليوم/u).first(),
  ).toBeVisible();
}

/**
 * `PRC-03` `PRC-11`: the owner's threshold and a reviewed batch, by keyboard alone.
 *
 * The rules — the comparison, the stale approval, the batch that publishes
 * whole or not at all — are proven against the modules and over PostgreSQL.
 * What a browser adds is that the review is usable: the threshold is set and
 * read back in words, a task says which rate crossed and how every figure was
 * reached, a price is excluded with the keyboard, and a decision says who
 * made it and why.
 */
test.setTimeout(120_000);

test('PRC-03 PRC-11 keyboard-only threshold, review, exclusion, approval and rejection in both themes', async ({
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
  await poundRate(page, '10000', 'تسجيل سعر اليوم');

  // One item, priced at one dollar in two lists, each frozen at 10,000 pounds.
  await open(page, 'الأصناف والفئات');
  await enter(page, 'الاسم', 'مشروبات');
  await press(page, 'إنشاء فئة');
  await enter(page, 'الاسم', 'ماء', 1);
  await choose(page, 'فئة الصنف', 'مشروبات');
  await choose(page, 'وحدة الأساس', 'قطعة');
  await press(page, 'إنشاء صنف');
  await expect(page.getByRole('listitem').filter({ hasText: 'ماء' })).toBeVisible();
  await open(page, 'قوائم الأسعار');
  await enter(page, 'ابحث عن صنف', 'ماء');
  await press(page, 'بحث');
  await press(page, 'ماء');
  for (const list of ['تجزئة', 'جملة']) {
    const dollars = page.getByRole('group', { name: `${list} pc`, exact: true });
    await dollars.getByRole('button', { name: 'تعديل السعر' }).focus();
    await page.keyboard.press('Enter');
    await enter(page, 'السعر بالدولار', '1.00');
    await enter(page, 'سبب التغيير', 'تسعير أولي');
    await press(page, 'حفظ');
    await expect(dollars.getByText('1 USD')).toBeVisible();
    const shelf = page.getByRole('group', { name: `pc · ${list} · سعر العرض بالليرة` });
    await shelf.getByRole('button', { name: 'مراجعة سعر العرض' }).focus();
    await page.keyboard.press('Enter');
    await press(page, 'معاينة');
    await enter(page, 'سبب الاعتماد', 'تسعير الرف');
    await press(page, 'اعتماد السعر');
    await expect(shelf.getByText('10,000.00')).toBeVisible();
  }

  // The owner sets the threshold; a refusal is a sentence.
  await open(page, 'مراجعة الأسعار بعد الصرف');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('المراقبة متوقفة', { exact: false })).toBeVisible();
  await enter(page, 'العتبة (٪)', '75');
  await press(page, 'حفظ العتبة');
  await expect(page.getByText(/العتبة نسبة مئوية من 0.1 إلى 50/u)).toBeVisible();
  const threshold = page.getByLabel('العتبة (٪)', { exact: true });
  await threshold.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('5');
  await press(page, 'حفظ العتبة');
  await expect(page.getByText('حُفظت عتبة المراجعة.')).toBeVisible();
  await expect(page.getByText(/العتبة الحالية 5%/u)).toBeVisible();

  // Six percent: one task, listing both frozen prices, changing neither.
  await poundRate(page, '10600', 'تصحيح سعر اليوم');
  await open(page, 'مراجعة الأسعار بعد الصرف');
  const pending = page.getByRole('row').filter({ hasText: 'بانتظار المراجعة' });
  await expect(pending).toHaveCount(1);
  await expect(pending.getByText(/10600 ليوم .* \(المراجعة 2\)/u)).toBeVisible();
  await inRow(page, pending, 'فتح المهمة');
  await expect(
    page.getByText(/سعر شراء SYP لليوم .* \(المراجعة 2\): 10600 لكل 1 USD، بعتبة 5%/u),
  ).toBeVisible();
  const entries = page.getByRole('grid', { name: 'الأسعار المدرجة' });
  await expect(entries.getByRole('row')).toHaveCount(3);
  await expect(entries.getByText('10,600.00')).toHaveCount(2);

  // The wholesale price is set aside with the keyboard: a row, Space, a button.
  const wholesale = entries.getByRole('row').filter({ hasText: 'جملة' });
  await wholesale.focus();
  await page.keyboard.press('Space');
  await expect(wholesale).toHaveAttribute('aria-selected', 'true');
  await press(page, 'استبعاد المحدد');
  await expect(wholesale.getByText('مستبعد', { exact: true })).toBeVisible();

  // Approved with a reason: one price published, the other left as it was.
  await expect(page.getByText(/يعتمد الأسعار المدرجة فقط \(1 سعرًا\)/u)).toBeVisible();
  await enter(page, 'سبب القرار', 'ارتفاع الصرف');
  await press(page, 'اعتماد الدفعة');
  await expect(page.getByText(/اعتمدها .* ارتفاع الصرف\. نُشرت 1 سعرًا\./u)).toBeVisible();
  await open(page, 'قوائم الأسعار');
  await enter(page, 'ابحث عن صنف', 'ماء');
  await press(page, 'بحث');
  await press(page, 'ماء');
  await expect(
    page.getByRole('group', { name: 'pc · تجزئة · سعر العرض بالليرة' }).getByText('10,600.00'),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'pc · جملة · سعر العرض بالليرة' }).getByText('10,000.00'),
  ).toBeVisible();

  // The rate moves again past the wholesale price's baseline: rejected, with a reason.
  await poundRate(page, '11500', 'تصحيح سعر اليوم');
  await open(page, 'مراجعة الأسعار بعد الصرف');
  const next = page.getByRole('row').filter({ hasText: 'بانتظار المراجعة' });
  await inRow(page, next, 'فتح المهمة');
  await enter(page, 'سبب القرار', 'ارتفاع مؤقت');
  await press(page, 'رفض المهمة');
  await expect(page.getByText('رُفضت المهمة. بقيت أسعار العرض المعتمدة كما هي.')).toBeVisible();
  await expect(page.getByText(/رفضها .* ارتفاع مؤقت\./u)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'مرفوضة' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'معتمدة' })).toHaveCount(1);
});
