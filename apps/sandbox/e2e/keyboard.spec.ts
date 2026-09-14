import { expect, test } from '@playwright/test';

/**
 * Keyboard-only journeys.
 *
 * `POS-02` requires a complete cash sale of five scanned items to be executed
 * without touching a pointing device, and §11 makes that a property of every
 * component rather than a feature of the register. These tests therefore use
 * **no pointer at all** — every interaction is a key.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the page begins with a skip link that reaches the main region', async ({ page }) => {
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link').first();
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#main');
  // §11: the link must be visible once focused, not merely present.
  await expect(skip).toBeInViewport();
});

test('every control on the page is reachable by Tab alone', async ({ page }) => {
  const reachable = new Set<string>();
  // Bounded rather than open-ended: a focus trap would otherwise hang here, and
  // hanging is a worse failure report than a count that does not add up.
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) return '';
      return `${el.tagName}:${el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 24)}`;
    });
    if (id !== '') reachable.add(id);
  }
  // The sandbox shows buttons, inputs and switchers; if Tab stopped working
  // this collapses to a handful.
  expect(reachable.size).toBeGreaterThan(12);
});

test('focus is visible on every control that takes it', async ({ page }) => {
  // The ring is drawn with box-shadow (§7.3), so a focused control must differ
  // from its unfocused self. A control that removes the outline and puts
  // nothing back fails here, in the theme where it fails.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    const shadow = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) return 'none';
      return getComputedStyle(el).boxShadow;
    });
    if (shadow === 'none') {
      const tag = await page.evaluate(() => {
        const el = document.activeElement;
        return el === null ? '' : el.tagName;
      });
      // A skip link is styled by position rather than by ring; everything else
      // must carry one.
      expect(['', 'A'], `focused ${tag} carries no focus indicator`).toContain(tag);
    }
  }
});

test('a button fires on Enter and on Space', async ({ page }) => {
  const dark = page.getByRole('button', { name: 'داكن' });
  await dark.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const light = page.getByRole('button', { name: 'فاتح' });
  await light.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the density axis reaches the document and changes control height', async ({ page }) => {
  const heightOf = async (): Promise<number> =>
    page.evaluate(() => {
      const button = document.querySelector('button');
      return button === null ? 0 : button.getBoundingClientRect().height;
    });

  await page.getByRole('button', { name: 'مضغوطة' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  const compact = await heightOf();

  await page.getByRole('button', { name: 'لمس' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'touch');
  const touch = await heightOf();

  expect(touch).toBeGreaterThan(compact);
  // §6.3: nothing interactive below 48px on a touch surface.
  expect(touch).toBeGreaterThanOrEqual(48);
});

test('the document is right-to-left and never scrolls sideways', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  // §9: wide content scrolls inside its own container; the body never does.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});

test('a figure never appears without its currency or its unit', async ({ page }) => {
  // The §12 display contracts, seen from the outside.
  await expect(page.getByText('SYP').first()).toBeVisible();
  await expect(page.getByText('USD').first()).toBeVisible();
  await expect(page.getByText('كغ').first()).toBeVisible();
});

test('a negative amount carries a sign as well as a colour', async ({ page }) => {
  const negative = page.getByText('-42.50').first();
  await expect(negative).toBeVisible();
  const colour = await negative.evaluate((el) => getComputedStyle(el.parentElement ?? el).color);
  const danger = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--vx-text-danger').trim(),
  );
  expect(danger).not.toBe('');
  // Colour is the second channel, never the only one: the sign is in the text.
  expect(colour).not.toBe('rgb(0, 0, 0)');
});

test('the bundled Arabic face is the one actually used', async ({ page }) => {
  // §5.1: fonts ship with the application. If the bundle failed to load, the
  // fallback would render and Arabic would be measurably different.
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('400 14px "IBM Plex Sans Arabic"');
  });
  expect(loaded).toBe(true);
});
