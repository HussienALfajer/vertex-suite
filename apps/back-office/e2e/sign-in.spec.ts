import { expect, test } from '@playwright/test';

import { gotoThemed } from './theme.js';

/**
 * The sign-in screen, operated with no pointing device at all.
 *
 * §13 extends the keyboard journeys per unit, and this is the first screen the
 * product has. §11 makes a control that can be reached by pointer but not by
 * keyboard a defect rather than a preference — and the two theme projects of
 * `playwright.config.ts` run every one of these twice, because a focus ring
 * invisible in the dark theme is a focus ring that does not exist at night.
 */

test('signs in from the keyboard alone, and lands on the shell', async ({ page }) => {
  await gotoThemed(page);

  // No click anywhere in this test. The field that takes the first keystroke is
  // already focused, which is what makes that possible.
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('button', { name: /تسجيل الخروج/ })).toBeVisible();
});

test('shows the refusal, and keeps the keyboard where it can be corrected', async ({ page }) => {
  await gotoThemed(page);

  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('not-the-password');
  await page.keyboard.press('Enter');

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();

  // The form is still there and still usable: a refusal is an ordinary answer,
  // not a dead end somebody has to reload out of.
  // `exact`, because the field is no longer the only control named after it:
  // the reveal control inside it is named for what it does to the password,
  // and a substring match now finds both.
  await expect(page.getByLabel('كلمة المرور', { exact: true })).toBeVisible();
});

test('every control on the screen is reachable by Tab, and shows focus when it is', async ({
  page,
}) => {
  await gotoThemed(page);

  // From the top of the document rather than from wherever the screen put the
  // keyboard. The sign-in screen focuses the field that takes the first
  // keystroke — worth a saved Tab on a screen somebody uses twice a day — which
  // means a forward walk from there would never pass the skip link that sits
  // above it. The walk below enters the page as the tab order actually begins.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  // One pass, five stops: the skip link, the theme control, the two fields and
  // the submit.
  const reachable = new Set<string>();
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;
      const style = globalThis.getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        // §7.3 asks for focus to be **visible**, not for one particular way of
        // drawing it. The controls carry the two-layer ring as a box-shadow; the
        // skip link is drawn by coming out of `sr-only` and keeps the browser's
        // own outline, which is why this asks for either rather than naming a
        // tag as an exception — an exception by tag stops catching the control
        // that loses its ring and happens to be an anchor.
        ring: style.boxShadow,
        outline: style.outlineStyle,
      };
    });
    if (focused !== null) {
      const visible = focused.ring !== 'none' || focused.outline !== 'none';
      expect(visible, `focus on <${focused.tag}> is not visible at all`).toBe(true);
      reachable.add(focused.tag);
    }
  }

  // Every kind of control on the screen is on the path: the skip link, the
  // fields and the submit. A control reachable by pointer and not by keyboard
  // is a defect rather than a preference (§11.1).
  expect([...reachable].sort()).toEqual(['a', 'button', 'input']);
});

test('the skip link reaches the main region', async ({ page }) => {
  await gotoThemed(page);

  // It is the first tab stop on every screen (§11.1), and it is the one control
  // that is invisible until it has focus.
  await page.keyboard.press('Shift+Tab');
  const skip = page.getByRole('link', { name: 'تخطَّ إلى المحتوى' });
  await expect(skip).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeVisible();
});

test('the document is right-to-left and in Arabic, from the first paint', async ({ page }) => {
  await gotoThemed(page);

  // `SYS-01`: the interface is Arabic-first and direction follows the locale.
  // The served HTML carries it so the first paint is not backwards, and the
  // provider owns it from there.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});
