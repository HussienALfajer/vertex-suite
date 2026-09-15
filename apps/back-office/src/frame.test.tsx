import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue } from './catalogue.js';
import { enterTheShop, goTo, registerCompany, startAt } from './screens.fixture.js';

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

describe('The frame the screens hang in — SYS-01', () => {
  it('moves between screens from its own navigation, and keeps the session', async () => {
    const shop = await enterTheShop();
    await goTo(shop, catalogue['nav.branches']);

    expect(await screen.findByRole('heading', { name: catalogue['branches.title'] })).toBeTruthy();
    expect(globalThis.location.pathname).toBe('/branches');

    // The session is held in memory and nowhere a revocation could not reach
    // it (`SEC-09`), so a link that reloaded the document would sign somebody
    // out on their way to the next screen. It is still here, so it did not.
    expect(screen.getByRole('button', { name: catalogue['shell.signOut'] })).toBeTruthy();
  });

  it('says where you are rather than only tinting it', async () => {
    const shop = await enterTheShop();
    await goTo(shop, catalogue['nav.locations']);

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: catalogue['nav.locations'] }).getAttribute('aria-current'),
      ).toBe('page');
    });
    expect(
      screen.getByRole('link', { name: catalogue['nav.companies'] }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('opens the screen the address names, so a link reaches the same place', async () => {
    startAt('business-profile');
    await enterTheShop();

    expect(await screen.findByRole('heading', { name: catalogue['profile.title'] })).toBeTruthy();
  });

  it('falls back to the first screen rather than refusing an address it does not know', async () => {
    globalThis.history.replaceState(null, '', '/something-that-is-not-a-screen');
    await enterTheShop();

    expect(await screen.findByRole('heading', { name: catalogue['companies.title'] })).toBeTruthy();
  });

  it('begins with the skip link, ahead of the frame it exists to skip', async () => {
    const shop = await enterTheShop();
    (globalThis.document.activeElement as HTMLElement | null)?.blur();

    // §11.1: the first tab stop on every screen. It is worth nothing if the
    // banner's own controls come before it, which is why the page owns the
    // chrome slots rather than each app assembling a frame around the page.
    await shop.person.tab();
    expect(globalThis.document.activeElement?.textContent).toBe(catalogue['a11y.skipToContent']);
    expect(globalThis.document.activeElement?.getAttribute('href')).toBe('#main');
  });

  it('carries exactly one page title, and it belongs to the screen — §5.2', async () => {
    const shop = await enterTheShop();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    await goTo(shop, catalogue['nav.branches']);
    const [title] = screen.getAllByRole('heading', { level: 1 });
    expect(title?.textContent).toBe(catalogue['branches.title']);
  });

  it('is Arabic and right-to-left, because that is what it is and not a mode', async () => {
    await enterTheShop();

    expect(globalThis.document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(globalThis.document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('shows the product name until the shop has one of its own', async () => {
    const shop = await enterTheShop();
    expect(screen.getByText(catalogue['app.name'])).toBeTruthy();

    await registerCompany(shop, 'مؤسسة الشام');
    await waitFor(() => {
      expect(screen.queryByText(catalogue['app.name'])).toBeNull();
    });
  });
});
