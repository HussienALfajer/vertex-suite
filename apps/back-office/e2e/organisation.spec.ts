import { expect, test, type Page } from '@playwright/test';

import { gotoThemed } from './theme.js';

/**
 * Setting a shop up, in a real browser, with no pointing device.
 *
 * §13 extends the keyboard journeys per unit, and this unit is the four screens
 * a tenant's own administrator runs their organisation from. `SYS-09`'s
 * acceptance criterion is a journey rather than an assertion — *adding a branch
 * or a location requires no vendor involvement and no code change* — so it is
 * tested as one, end to end, from an empty shop.
 *
 * The two theme projects of `playwright.config.ts` run every one of these
 * twice, because a focus ring invisible in the dark theme is a focus ring that
 * does not exist at night.
 */

async function signIn(page: Page): Promise<void> {
  await gotoThemed(page);
  await page.keyboard.type('owner');
  await page.keyboard.press('Tab');
  await page.keyboard.type('till-morning-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
}

test('sets a shop up from an empty one: a company, a branch, a location', async ({ page }) => {
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

  await page.getByRole('link', { name: 'المواقع' }).click();
  await page.getByRole('button', { name: 'فتح موقع' }).first().click();
  await page.getByLabel('اسم الموقع', { exact: true }).fill('صالة البيع');
  await page.getByRole('button', { name: 'فتح', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'صالة البيع' })).toBeVisible();

  // No vendor, no code change, and no page reload anywhere in the journey.
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
});

test('moves between screens without reloading the document', async ({ page }) => {
  await signIn(page);

  // A mark that only survives if the tab never reloads. The session lives in
  // memory and nowhere else (`SEC-09`), so a navigation that reloaded would
  // sign somebody out between two screens — and that is what `RouterProvider`
  // in the design system is there to prevent.
  await page.evaluate(() => {
    (globalThis as unknown as Record<string, unknown>)['vertexMark'] = 'still here';
  });

  await page.getByRole('link', { name: 'الفروع' }).click();
  await expect(page).toHaveURL(/\/branches$/);

  const mark = await page.evaluate(
    () => (globalThis as unknown as Record<string, unknown>)['vertexMark'],
  );
  expect(mark).toBe('still here');
});

test('opens a company from the keyboard alone, and shows focus at every stop', async ({ page }) => {
  await signIn(page);

  // From the top of the document rather than from wherever the screen left the
  // keyboard, so the walk enters the page as the tab order actually begins.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'تخطَّ إلى المحتوى' })).toBeFocused();

  // Every stop from here to the action shows focus, and the walk ends at the
  // action rather than after a number of presses somebody once counted. §7.3
  // asks for focus to be visible, not for one particular way of drawing it, so
  // either the two-layer ring or the browser's own outline counts — and focus
  // on nothing at all is not a stop that passes.
  let reached = false;
  for (let step = 0; step < 30 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;
      const style = globalThis.getComputedStyle(element);
      return {
        name: (element.getAttribute('aria-label') ?? element.textContent).trim(),
        visible: style.boxShadow !== 'none' || style.outlineStyle !== 'none',
      };
    });
    expect(stop, `focus left every control at step ${String(step)}`).not.toBeNull();
    expect(stop?.visible, `"${stop?.name ?? ''}" shows no focus`).toBe(true);
    reached = stop?.name === 'تسجيل شركة';
  }
  expect(reached, 'the register action was never reached by Tab').toBe(true);

  // And it opens, and the company is registered, with no pointer at all.
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('اسم الشركة', { exact: true })).toBeFocused();
  await page.keyboard.type('مؤسسة الشام');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('rowheader', { name: 'مؤسسة الشام' })).toBeVisible();
});

test('revises the business profile and says it was saved', async ({ page }) => {
  await signIn(page);

  await page.getByRole('button', { name: 'تسجيل شركة' }).first().click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('مؤسسة الشام');
  await page.getByRole('button', { name: 'تسجيل', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'مؤسسة الشام' })).toBeVisible();

  await page.getByRole('link', { name: 'ملف العمل التجاري' }).click();
  await page.getByLabel('الهاتف', { exact: true }).fill('021-2345678');

  // Nothing here takes effect as it is typed, and the screen says so before it
  // is saved rather than leaving somebody to wonder.
  await expect(page.getByText('لديك تغييرات لم تُحفظ بعد.')).toBeVisible();

  await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(page.getByText('حُفظ ملف العمل التجاري.')).toBeVisible();
});

test('asks before discarding an unsaved business-profile edit, and keeps it on cancel', async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole('button', { name: 'تسجيل شركة' }).first().click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('مؤسسة الشام');
  await page.getByRole('button', { name: 'تسجيل', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'مؤسسة الشام' })).toBeVisible();

  await page.getByRole('link', { name: 'ملف العمل التجاري' }).click();
  const phone = page.getByLabel('الهاتف', { exact: true });
  await phone.fill('021-2345678');

  await page.getByRole('button', { name: 'تراجع عن التغييرات' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  // Cancel changes nothing: the typed value survives the dialog it opened.
  await page.getByRole('button', { name: 'إلغاء' }).click();
  await expect(dialog).toBeHidden();
  await expect(phone).toHaveValue('021-2345678');

  await page.getByRole('button', { name: 'تراجع عن التغييرات' }).click();
  await dialog.getByRole('button', { name: 'تراجع عن التغييرات' }).click();
  await expect(phone).toHaveValue('');
});

test('a withdrawn branch is still there to be put back', async ({ page }) => {
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

  await page.getByRole('button', { name: 'سحب الفرع من الخدمة' }).click();
  await page.getByRole('button', { name: 'سحب من الخدمة', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'حلب' })).toBeHidden();

  // `SYS-09` deactivates and never deletes, and an administrator who cannot see
  // what was withdrawn cannot put it back — which is the one thing the feature
  // says must never require calling the vendor.
  // Clicked by its words rather than by its role, because the element carrying
  // the role is the visually hidden input and the words are the label around
  // it — which is exactly what a person clicks, and what the design system had
  // to be corrected to provide.
  await page.getByText('إظهار المسحوب من الخدمة').click();
  await expect(page.getByRole('switch', { name: 'إظهار المسحوب من الخدمة' })).toBeChecked();
  await expect(page.getByRole('rowheader', { name: 'حلب' })).toBeVisible();
  // Putting it back is confirmed the same way taking it out was: the two rows
  // differ by one icon, and reopening a branch resumes its numbering series.
  await page.getByRole('button', { name: 'إعادة الفرع إلى الخدمة' }).click();
  await page.getByRole('button', { name: 'إعادة إلى الخدمة', exact: true }).click();
  await expect(page.getByText('قيد الاستخدام')).toBeVisible();
});

/** What an alert dialog showed at one moment, and whether it was already on its way out. */
interface Glimpse {
  readonly text: string;
  readonly isExiting: boolean;
}

/**
 * Records every state the alert dialog passes through from now until it
 * leaves the document, and returns them once it has.
 *
 * Read by an observer in the page rather than by asking after the click: the
 * close takes `dur-slow`, and a question sent after the click lands had to
 * arrive inside that window — which on a slow runner it did not, and the read
 * waited for a dialog that was already gone.
 */
async function watchTheDialogLeave(page: Page): Promise<() => Promise<readonly Glimpse[]>> {
  await page.evaluate(() => {
    const seen: { text: string; isExiting: boolean }[] = [];
    (globalThis as unknown as Record<string, unknown>)['vertexGlimpses'] = seen;
    const observer = new MutationObserver(() => {
      const dialog = document.querySelector('[role="alertdialog"]');
      if (dialog === null) {
        observer.disconnect();
        return;
      }
      seen.push({
        text: dialog.textContent,
        isExiting: dialog.closest('[data-exiting]') !== null,
      });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  return async () => {
    await expect(page.getByRole('alertdialog')).toBeHidden();
    return page.evaluate(
      () => (globalThis as unknown as Record<string, unknown>)['vertexGlimpses'] as Glimpse[],
    );
  };
}

test('names the company throughout its own withdraw confirmation, including the close that follows either answer', async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole('button', { name: 'تسجيل شركة' }).first().click();
  await page.getByLabel('اسم الشركة', { exact: true }).fill('fajer 2');
  await page.getByRole('button', { name: 'تسجيل', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'fajer 2' })).toBeVisible();

  await page.getByRole('button', { name: 'سحب الشركة من الخدمة' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('fajer 2');

  // Cancel closes the dialog over §8's `dur-slow` rather than instantly, and
  // the name interpolated into its message is read from state a screen used
  // to clear the moment the dialog closed — blanking the sentence for exactly
  // that fade. It must still name the company right up to the close, on
  // either answer.
  for (const answer of ['إلغاء', 'سحب من الخدمة']) {
    if (answer !== 'إلغاء') {
      await page.getByRole('button', { name: 'سحب الشركة من الخدمة' }).click();
      await expect(dialog).toContainText('fajer 2');
    }
    const leaving = await watchTheDialogLeave(page);
    await page.getByRole('button', { name: answer, exact: true }).click();

    const glimpses = await leaving();
    // The fade itself was seen, and in every moment of it the company is named.
    expect(
      glimpses.some((one) => one.isExiting),
      answer,
    ).toBe(true);
    for (const glimpse of glimpses) expect(glimpse.text, answer).toContain('fajer 2');
  }
});
