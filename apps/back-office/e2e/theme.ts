import { expect, test, type Page } from '@playwright/test';

import { catalogue } from '../src/catalogue.js';

// The fixed prefix of `theme.switch`'s `'المظهر: {current}. اضغط للتبديل.'` —
// true regardless of which state `{current}` names, which is the point.
const THEME_BUTTON_NAME = catalogue['theme.switch'].split('{')[0]?.trim() ?? '';

/**
 * Opens the app in the theme its Playwright project claims.
 *
 * `playwright.config.ts` runs every journey under two projects, `light` and
 * `dark`, by emulating the browser's `colorScheme` — which worked only as
 * long as the app itself followed that preference. It no longer does
 * (`ThemeSwitch`'s own comment: the app now decides light or dark once at
 * load and stays there until pressed), so without this, the `dark` project's
 * `colorScheme: 'dark'` is inert and both projects silently run the same
 * theme — every "dark" assertion passing for a reason that has nothing to do
 * with the dark theme.
 *
 * The switch is visible on the sign-in screen before anybody has signed in,
 * so pressing it here reaches every journey that calls this instead of
 * `page.goto` directly, signed in or not.
 *
 * `.focus()` and a key press, not `.click()`: this is also the entry point
 * for `sign-in.spec.ts`'s keyboard-only journeys, which assert that nothing
 * on that screen was reached by pointer. Switching the theme here is setup
 * for those journeys, not the thing they exist to prove, and a real click
 * would quietly make that claim false for every one of them under the `dark`
 * project.
 *
 * Focus lands back on the username field afterward, exactly where a fresh
 * load already puts it (`SignIn.tsx`'s own `autoFocus`) — the theme switch
 * sits **last** in tab order by design (§11.1: the keyboard reaches the
 * fields before a control touched once a day), so leaving focus on it after
 * toggling would hand every caller a start state no real visit ever has, and
 * broke the very next journey that pressed Shift+Tab expecting the skip link.
 */
export async function gotoThemed(page: Page): Promise<void> {
  await page.goto('/');
  if (test.info().project.name === 'dark') {
    await page.getByRole('button', { name: THEME_BUTTON_NAME }).focus();
    await page.keyboard.press('Enter');
    await page.getByLabel(catalogue['signIn.handle']).focus();
  }
  // Self-verifying rather than trusted: a project renamed, a button relabelled
  // or a cycle order reversed should fail here, loudly, rather than let every
  // "dark" journey pass while silently running the light theme again — which
  // is exactly the defect this helper exists to not repeat.
  const project = test.info().project.name;
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    project === 'dark' ? 'dark' : 'light',
  );
}
