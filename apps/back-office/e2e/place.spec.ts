import { expect, test, type Page } from '@playwright/test';

import { gotoThemed } from './theme.js';

/**
 * Putting a shop on the map, in a real browser, with nothing on the wire.
 *
 * `SYS-14`'s acceptance criterion is "with all network interfaces disabled",
 * and the two halves of it only meet in a browser: the geometry has to draw,
 * and drawing it must not ask anybody for anything. So this journey **fails
 * every request the page makes** and then checks the map is there anyway — a
 * claim a component test cannot make, because there is no network under one.
 *
 * The two theme projects of `playwright.config.ts` run it twice, because a map
 * whose land is invisible against its sea in the dark theme is a map that does
 * not work at night.
 */

async function signIn(page: Page): Promise<void> {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
}

test('places a branch and draws it, with every request refused', async ({ page }) => {
  await signIn(page);

  // From here the shop has no line. The store node itself is still reachable —
  // it is the machine in the room, and the application is served from it — but
  // anything beyond it is refused, which is exactly what a shop whose ADSL is
  // down looks like and exactly the condition `SYS-14` was written for. A tile
  // server, a geocoder or a maps API would land in this and never arrive.
  const storeNode = new URL(page.url()).origin;
  const offsite: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(storeNode)) {
      await route.continue();
      return;
    }
    offsite.push(url);
    await route.abort();
  });

  await page.getByRole('button', { name: 'تسجيل شركة' }).first().click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('مؤسسة الشام');
  await page.getByRole('button', { name: 'تسجيل', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'مؤسسة الشام' })).toBeVisible();

  await page.getByRole('link', { name: 'الفروع' }).click();
  await page.getByRole('button', { name: 'فتح فرع' }).first().click();
  await page.getByLabel('اسم الفرع', { exact: true }).fill('حلب');
  await page.getByLabel('العنوان', { exact: true }).fill('شارع التلل');

  // The path a shopkeeper actually takes: the link is already on their phone.
  await page
    .getByLabel('ألصق رابط خرائط أو إحداثيًا')
    .fill('https://www.google.com/maps/@36.1997,37.1637,17z');
  await expect(page.getByRole('button', { name: 'أزل النقطة' })).toBeVisible();

  await page.getByRole('button', { name: 'فتح', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'حلب' })).toBeVisible();

  const map = page.getByRole('application', { name: 'خريطة المواقع' });
  await expect(map).toBeVisible();
  await expect(map.getByRole('button', { name: 'حلب' })).toBeVisible();

  // The land is drawn from geometry that shipped, so there is something under
  // the marker rather than an empty box with a pin floating in it.
  await expect(map.locator('svg path').first()).toBeVisible();

  // Nothing left the machine. Not a tile, not a geocode, not a beacon.
  expect(offsite).toEqual([]);
});

test('opens what a marker is, and closes it with the keyboard', async ({ page }) => {
  await signIn(page);

  await page.getByRole('button', { name: 'تسجيل شركة' }).first().click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('مؤسسة الشام');
  await page.getByRole('button', { name: 'تسجيل', exact: true }).click();

  await page.getByRole('link', { name: 'الفروع' }).click();
  await page.getByRole('button', { name: 'فتح فرع' }).first().click();
  await page.getByLabel('اسم الفرع', { exact: true }).fill('حلب');
  await page.getByLabel('ألصق رابط خرائط أو إحداثيًا').fill('36.1997, 37.1637');
  await page.getByRole('button', { name: 'فتح', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'حلب' })).toBeVisible();

  const map = page.getByRole('application', { name: 'خريطة المواقع' });
  await map.getByRole('button', { name: 'حلب' }).click();

  const panel = page.getByRole('dialog', { name: 'حلب' });
  await expect(panel).toBeVisible();

  // §11 gives the pointer no exception anywhere in this system, and a panel
  // that could only be closed by clicking would be one.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
