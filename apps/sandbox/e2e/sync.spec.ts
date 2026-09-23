import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The register's sync status, driven through its states in a browser.
 *
 * The till on this page is the platform's own courier over an in-memory store,
 * delivering to a stand-in store node whose line and whose answer the journey
 * controls. What is proven here is the part only a browser can prove — that
 * the indicator is always on screen, says each state in words, and that the
 * detail, the retry and the escalation are reached with **no pointer at all**
 * (§11, `POS-02`). That the same courier survives a real network, a real
 * store node and a restart is proven over the real wire in `apps/store-node`.
 */

/** The indicator, whatever it currently says: it always leads with the connection. */
function indicator(page: Page): Locator {
  return page.getByRole('button', {
    name: /^(متصل|غير متصل|الجلسة منتهية|بانتظار عقدة المتجر)/,
  });
}

async function press(control: Locator, key: 'Enter' | 'Space'): Promise<void> {
  await control.focus();
  await control.press(key);
}

async function openDetail(page: Page): Promise<Locator> {
  await press(indicator(page), 'Enter');
  const detail = page.getByRole('dialog', { name: 'المزامنة مع عقدة المتجر' });
  await expect(detail).toBeVisible();
  return detail;
}

async function closeDetail(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // §11.1: focus goes back to what opened it, so the next key lands where it did.
  await expect(indicator(page)).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('POS-18 SYN-06 connected, offline, pending, failed and recovered — from the keyboard alone', async ({
  page,
}) => {
  const line = page.getByRole('switch', { name: 'خطّ عقدة المتجر' });
  const refusing = page.getByRole('switch', { name: 'العقدة ترفض هذا الصندوق' });
  const sell = page.getByRole('button', { name: 'سجّل بيعًا' });

  // Connected: said in words, and nothing is counted as waiting.
  await expect(indicator(page)).toHaveText(/^متصل$/);

  // Offline. The till keeps selling, and says how much is waiting.
  await press(line, 'Space');
  await expect(indicator(page)).toHaveText(/^غير متصل/);
  await press(sell, 'Enter');
  await press(sell, 'Enter');
  await expect(indicator(page)).toContainText('2 بانتظار المزامنة');

  // Pending, in detail: both sales listed in order, neither of them failed.
  let detail = await openDetail(page);
  await expect(detail).toContainText('لا اتصال بعقدة المتجر');
  const queued = detail.getByRole('listitem');
  await expect(queued).toHaveCount(2);
  await expect(queued.nth(0)).toContainText('رقم 1');
  await expect(queued.nth(1)).toContainText('رقم 2');
  await expect(detail.getByRole('alert')).toHaveCount(0);
  await closeDetail(page);

  // Recovered: the line returns, and the courier finds it on its own.
  await press(line, 'Space');
  await expect(indicator(page)).toHaveText(/^متصل$/, { timeout: 10_000 });

  // Failed: the store node answers, and refuses this register.
  await press(refusing, 'Space');
  await press(sell, 'Enter');
  await expect(indicator(page)).toContainText('عملية لم تُطبَّق');
  detail = await openDetail(page);
  const notice = detail.getByRole('alert');
  await expect(notice).toContainText('عقدة المتجر ترفض هذا الصندوق');
  await expect(notice).toContainText('المرجع');

  // Escalated, from the keyboard, and said so.
  await press(notice.getByRole('button', { name: 'صعّدها إلى المشرف' }), 'Enter');
  await expect(notice).toContainText('صُعِّدت إلى المشرف في');
  await expect(notice.getByRole('button')).toHaveCount(0);

  // Recovered from the failure: the supervisor puts it right at the store
  // node, and a person asks for the retry rather than wait for the next one.
  await closeDetail(page);
  await press(refusing, 'Space');
  detail = await openDetail(page);
  await press(detail.getByRole('button', { name: 'أعد المحاولة الآن' }), 'Enter');
  await expect(detail).toContainText('لا شيء بانتظار المزامنة');
  await closeDetail(page);
  await expect(indicator(page)).toHaveText(/^متصل$/);
});

test('POS-18 the indicator is announced when its condition changes', async ({ page }) => {
  const announced = page.getByRole('status').filter({ hasText: /متصل/ });
  await expect(announced).toHaveText(/^متصل\s*$/);
  await press(page.getByRole('switch', { name: 'خطّ عقدة المتجر' }), 'Space');
  await expect(announced).toHaveText(/^غير متصل/);
});
