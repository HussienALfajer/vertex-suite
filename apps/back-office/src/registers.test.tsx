import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@vertex/kernel';

import { catalogue, createTranslator } from './catalogue.js';
import {
  chooseOption,
  enterTheShop,
  firstButton,
  goTo,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';

/**
 * Setting up the tills a shop sells from, and the machines standing at them.
 *
 * The whole application is rendered and the real `SYS` answers behind it
 * (`screens.fixture.tsx`), so a test that says two tills cannot share a mark is
 * a test of the module that will refuse it in a shop rather than of a fake
 * written to agree.
 */

/** The same translator the application runs with, for the strings that carry a number. */
const say = createTranslator();

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function openBranch(shop: OpenShop, name: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['branches.open']));
  await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), name);
  await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
  await screen.findByRole('rowheader', { name });
}

async function openRegister(shop: OpenShop, name: string, prefix: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['registers.open']));
  await shop.person.type(screen.getByLabelText(catalogue['registers.new.name']), name);
  await shop.person.type(screen.getByLabelText(catalogue['registers.new.prefix']), prefix);
  await shop.person.click(screen.getByRole('button', { name: catalogue['registers.new.submit'] }));
}

/** Names the machine standing at the only till on screen. */
async function nameTheMachine(shop: OpenShop, device: string): Promise<void> {
  await shop.person.click(
    screen.getByRole('button', { name: catalogue['registers.device.action'] }),
  );
  await shop.person.type(screen.getByLabelText(catalogue['registers.device.label']), device);
  await shop.person.click(
    screen.getByRole('button', { name: catalogue['registers.device.submit'] }),
  );
}

/** A shop with one company and the branches named, standing on the registers screen. */
async function aShopTradingFrom(...branches: readonly string[]): Promise<OpenShop> {
  const shop = await enterTheShop();
  await registerCompany(shop, 'مؤسسة الشام');
  await goTo(shop, catalogue['nav.branches']);
  for (const name of branches) await openBranch(shop, name);
  await goTo(shop, catalogue['nav.registers']);
  return shop;
}

describe('Registers and the machines at them — SYS-09', () => {
  it('opens a till carrying the mark every number it issues will carry', async () => {
    const shop = await aShopTradingFrom('حلب');

    expect(await screen.findByText(catalogue['registers.empty'])).toBeTruthy();
    await openRegister(shop, 'صندوق المدخل', 'AL1');

    expect(await screen.findByRole('rowheader', { name: 'صندوق المدخل' })).toBeTruthy();
    // `SYS-02`: the mark is on the till, and on every document it ever issues.
    expect(screen.getByText('AL1')).toBeTruthy();
  });

  it('refuses a mark another till already carries, anywhere in the shop', async () => {
    const shop = await aShopTradingFrom('حلب', 'حمص');
    await openRegister(shop, 'صندوق حلب', 'AL1');
    await screen.findByRole('rowheader', { name: 'صندوق حلب' });

    await chooseOption(shop, catalogue['registers.branch'], 'حمص');
    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'صندوق حلب' })).toBeNull();
    });

    // Unique across the tenant rather than within the branch: the number format
    // need not carry the branch, so two tills sharing a mark in two shops would
    // file two different sales under one number.
    await openRegister(shop, 'صندوق حمص', 'AL1');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('AL1');
  });

  it('sends somebody to open a branch first', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.registers']);

    expect(await screen.findByText(catalogue['registers.noBranches'])).toBeTruthy();
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['registers.noBranches.action'] }),
    );
    expect(await screen.findByText(catalogue['branches.empty'])).toBeTruthy();
  });

  it('withdraws a till from use and keeps it there to be put back', async () => {
    const shop = await aShopTradingFrom('حلب');
    await openRegister(shop, 'صندوق المدخل', 'AL1');
    await screen.findByRole('rowheader', { name: 'صندوق المدخل' });

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['registers.withdraw.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['registers.withdraw'] }));

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'صندوق المدخل' })).toBeNull();
    });

    // `SYS-09` deactivates and never deletes: the documents this till issued
    // still name it, so it is still here to be found and restored.
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    expect(await screen.findByRole('rowheader', { name: 'صندوق المدخل' })).toBeTruthy();
    expect(screen.getByText(catalogue['status.withdrawn'])).toBeTruthy();
  });
});

describe('The machine at a till, and its generation — SYS-02', () => {
  it('raises the generation when a different machine takes over, and not otherwise', async () => {
    const shop = await aShopTradingFrom('حلب');
    await openRegister(shop, 'صندوق المدخل', 'AL1');
    await screen.findByRole('rowheader', { name: 'صندوق المدخل' });

    const first = newId<'device'>();
    await nameTheMachine(shop, first);
    expect(
      await screen.findByText(
        say.format('registers.device.assigned', { name: 'صندوق المدخل', generation: 1 }),
      ),
    ).toBeTruthy();

    // A till that reconnects names the same machine again, and `SYN-02` replays
    // commands that were already applied. Neither may spend a generation — a
    // spent one is not recoverable — and the screen says so rather than
    // reporting a replacement that did not happen.
    await nameTheMachine(shop, first);
    expect(
      await screen.findByText(say.format('registers.device.unchanged', { name: 'صندوق المدخل' })),
    ).toBeTruthy();

    // The machine dies and a replacement is plugged into the same till. Nobody
    // knows which of the dead machine's numbers ever reached the store node, so
    // the replacement counts from one under a generation of its own.
    await nameTheMachine(shop, newId<'device'>());
    expect(
      await screen.findByText(
        say.format('registers.device.assigned', { name: 'صندوق المدخل', generation: 2 }),
      ),
    ).toBeTruthy();
  });

  it('refuses a machine identifier this system could not have issued', async () => {
    const shop = await aShopTradingFrom('حلب');
    await openRegister(shop, 'صندوق المدخل', 'AL1');
    await screen.findByRole('rowheader', { name: 'صندوق المدخل' });

    // The machine names itself; this field copies what the till is showing. An
    // identifier the machine will never report for itself would make it a new
    // machine on every reconnection, and each of those spends a generation.
    await nameTheMachine(shop, 'till-one');

    expect(
      await screen.findByText(catalogue['refusal.sys.device-identifier-invalid']),
    ).toBeTruthy();
  });

  it('says when a till is open and cannot issue a document', async () => {
    const shop = await aShopTradingFrom('حلب');
    await openRegister(shop, 'صندوق المدخل', 'AL1');
    await screen.findByRole('rowheader', { name: 'صندوق المدخل' });

    // A till with no machine looks exactly like the one beside it, and the
    // first anybody would otherwise learn of it is a cashier refused mid-sale.
    expect(await screen.findByText(catalogue['registers.idle'])).toBeTruthy();
    expect(screen.getByText(catalogue['registers.device.none'])).toBeTruthy();

    await nameTheMachine(shop, newId<'device'>());

    await waitFor(() => {
      expect(screen.queryByText(catalogue['registers.idle'])).toBeNull();
    });
  });
});
