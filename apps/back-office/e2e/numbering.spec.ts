import { expect, test, type Locator, type Page } from '@playwright/test';

import { gotoThemed } from './theme.js';

/**
 * A till, the machine standing at it, and the number it will print — in a real
 * browser.
 *
 * `SYS-02` is the one feature in this unit whose whole value is invisible until
 * something is printed, and a component test can only assert that a string came
 * back. What this journey adds is the part a person actually does: open a till,
 * copy an identifier off the machine's own screen, and watch the number it will
 * issue appear under the format as it is typed. If the specimen and the format
 * ever stopped agreeing, this is where it would show.
 *
 * The two theme projects of `playwright.config.ts` run it twice, because a
 * warning that a till cannot sell is worth nothing if it is invisible at night.
 */

/**
 * A machine's identifier, in the form the product issues: UUIDv7, version
 * nibble 7, variant bits 10. Written out rather than generated, so that what
 * the journey types is fixed and what it then reads back is checkable.
 */
const MACHINE = '01920a7b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';

/** What the screen shows of it in a column: the tail, which is the random half. */
const MACHINE_SHORT = '2e3f4a5b';

/**
 * The order an element's characters are actually **painted** in, left to right.
 *
 * Measured rather than read, because the difference this exists to catch is
 * invisible to every other kind of test: the characters are all present, in the
 * right node, in the right order in the DOM — and laid out backwards. Only a
 * layout engine can say so, which is why this claim lives in a journey.
 */
async function paintedOrder(target: Locator): Promise<string> {
  return target.evaluate((element) => {
    const text = element.firstChild;
    if (text?.nodeType !== Node.TEXT_NODE) return '';
    const data = (text as Text).data;

    // One code unit at a time rather than one code point: a range is addressed
    // in code units, and everything measured here is machine text — ASCII by
    // the rules that let it be typed at all.
    const placed: { character: string; line: number; left: number }[] = [];
    for (let index = 0; index < data.length; index += 1) {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const box = range.getBoundingClientRect();
      placed.push({ character: data[index] ?? '', line: Math.round(box.top), left: box.left });
    }

    // Down the lines first, then across each one. A narrow column wraps a long
    // format, and sorting by the horizontal alone would interleave two lines
    // into a string nobody is looking at.
    return placed
      .sort((one, two) => one.line - two.line || one.left - two.left)
      .map(({ character }) => character)
      .join('');
  });
}

async function signIn(page: Page): Promise<void> {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
}

/** A company and a branch, which a till has to be opened inside. */
async function aShopTrading(page: Page): Promise<void> {
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
}

async function openTheTill(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'الصناديق والأجهزة' }).click();
  await page.getByRole('button', { name: 'فتح صندوق' }).first().click();
  await page.getByLabel('اسم الصندوق', { exact: true }).fill('صندوق المدخل');
  await page.getByLabel('رمز الصندوق', { exact: true }).fill('AL1');
  await page.getByRole('button', { name: 'فتح', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'صندوق المدخل' })).toBeVisible();
}

test('opens a till, names the machine at it, and shows the number it will print', async ({
  page,
}) => {
  await aShopTrading(page);
  await openTheTill(page);

  // A till with nothing plugged into it looks exactly like one that is selling,
  // and the first anybody would otherwise learn of it is a cashier refused
  // mid-sale. It says so instead.
  await expect(page.getByText('صناديق لا تصدر مستندات')).toBeVisible();
  await expect(page.getByText('لا جهاز', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'الجهاز القائم على الصندوق' }).click();
  await page.getByLabel('معرّف الجهاز', { exact: true }).fill(MACHINE);
  await page.getByRole('button', { name: 'تسجيل الجهاز' }).click();

  await expect(page.getByText(MACHINE_SHORT)).toBeVisible();
  await expect(page.getByText('صناديق لا تصدر مستندات')).toBeHidden();

  // And now the number. The format is unreadable and what it prints is not, so
  // what an accountant is deciding about is the second one.
  await page.getByRole('link', { name: 'سلاسل الترقيم' }).click();
  await page.getByRole('button', { name: 'تعريف سلسلة' }).first().click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('نوع المستند', { exact: true }).fill('pos.sale');
  await dialog.getByRole('button', { name: /الصندوق/ }).click();
  await page.getByRole('option', { name: 'صندوق المدخل' }).click();
  await dialog.getByLabel('السنة المالية', { exact: true }).fill('2026');

  // Nobody has configured anything, so the field is filled with what is
  // printing here today and the screen says that is the default.
  await expect(dialog.getByLabel('الصيغة', { exact: true })).toHaveValue(
    '{prefix}-{generation}-{year}-{sequence:6}',
  );
  await expect(dialog.getByText('AL1-1-2026-000001')).toBeVisible();

  await dialog.getByRole('button', { name: 'حفظ الصيغة' }).click();
  await expect(page.getByRole('rowheader', { name: 'pos.sale' })).toBeVisible();
  // In the table, by name: the dialog that showed the specimen fades out over
  // §8's `dur-slow` and is still in the document for that long.
  await expect(
    page.getByRole('grid', { name: 'سلاسل الترقيم' }).getByText('AL1-1-2026-000001'),
  ).toBeVisible();

  // And it is painted in the order it was written. In an RTL paragraph the
  // bidirectional algorithm resolves a bracket pair to the paragraph's
  // direction (UAX #9, N0) and lays the four parts out backwards — every part
  // still reading correctly on its own, because the braces mirror — so the
  // format an accountant is shown is one the shop does not use. §9 answers it
  // with an `ltr` island, and this is the only kind of test that can see it.
  const format = page
    .locator('code')
    .filter({ hasText: '{prefix}-{generation}-{year}-{sequence:6}' })
    .first();
  expect(await paintedOrder(format)).toBe('{prefix}-{generation}-{year}-{sequence:6}');

  // The same string with nothing done about it, to show this assertion is
  // sensitive rather than vacuous: without the island it comes out reversed.
  const unprotected = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:fixed;top:0;inset-inline-start:0;white-space:pre';
    probe.textContent = '{prefix}-{generation}-{year}-{sequence:6}';
    document.body.append(probe);
    const text = probe.firstChild as Text;
    const leftOf = (index: number): number => {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      return range.getBoundingClientRect().left;
    };
    const placed: { character: string; left: number }[] = [];
    for (let index = 0; index < text.data.length; index += 1) {
      placed.push({ character: text.data[index] ?? '', left: leftOf(index) });
    }
    const order = placed
      .sort((one, two) => one.left - two.left)
      .map(({ character }) => character)
      .join('');
    probe.remove();
    return order;
  });
  expect(unprotected).not.toBe('{prefix}-{generation}-{year}-{sequence:6}');
});

test('refuses a format that drops the guarantee, under the field that typed it', async ({
  page,
}) => {
  await aShopTrading(page);
  await openTheTill(page);

  await page.getByRole('link', { name: 'سلاسل الترقيم' }).click();
  await page.getByRole('button', { name: 'تعريف سلسلة' }).first().click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('نوع المستند', { exact: true }).fill('pos.sale');
  await dialog.getByRole('button', { name: /الصندوق/ }).click();
  await page.getByRole('option', { name: 'صندوق المدخل' }).click();
  await dialog.getByLabel('السنة المالية', { exact: true }).fill('2026');

  await dialog.getByLabel('الصيغة', { exact: true }).fill('INV-{year}-{sequence:5}');

  // A format without the mark and the generation would let a replacement
  // machine reissue a number the machine it replaced had printed and not yet
  // sent. It is refused here, where it can still be retyped, rather than on a
  // document nobody can reprint.
  await expect(dialog.getByText('صيغة سلسلة صندوق لا بدّ أن تحمل')).toBeVisible();
});
