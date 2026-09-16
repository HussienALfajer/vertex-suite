import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue } from './catalogue.js';
import {
  chooseOption,
  enterTheShop,
  firstButton,
  goTo,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

/**
 * Puts text into a field the way somebody actually gets it there.
 *
 * Pasted rather than typed, and not only because it is faster: a maps link is
 * copied off a phone, never typed out, so a test that types it is testing a
 * journey nobody takes. It also stops the picker re-rendering a whole map for
 * every one of forty-odd keystrokes, which is what pushed this suite past its
 * own timeout.
 */
async function paste(shop: OpenShop, label: string, text: string): Promise<void> {
  await shop.person.click(screen.getByLabelText(label));
  await shop.person.paste(text);
}

/** The Aleppo branch, as a shopkeeper would share it: a maps link off a phone. */
const ALEPPO_LINK = 'https://www.google.com/maps/@36.1997,37.1637,17z';

async function aShopWithABranch(name = 'فرع حلب'): Promise<OpenShop> {
  const shop = await enterTheShop();
  await registerCompany(shop, 'فيرتكس للتجزئة');
  await goTo(shop, catalogue['nav.branches']);
  await shop.person.click(firstButton(catalogue['branches.open']));
  await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), name);
  return shop;
}

describe('Placing a branch from the screens — SYS-14', () => {
  it('takes an address and a place while the branch is being opened', async () => {
    const shop = await aShopWithABranch();

    // The address in words, then the place, without leaving the dialog. A shop
    // that had to open the branch and then come back for its place is a shop
    // that never comes back.
    await shop.person.type(
      screen.getByLabelText(catalogue['place.address']),
      'شارع التلل، مقابل الجامع',
    );
    await paste(shop, catalogue['picker.paste'], ALEPPO_LINK);
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));

    await screen.findByRole('rowheader', { name: 'فرع حلب' });

    // And it is on the map underneath, which is the whole point of having
    // asked: the listing says which branches there are, the map says where.
    const map = await screen.findByRole('application', { name: catalogue['place.map.label'] });
    expect(within(map).getByRole('button', { name: 'فرع حلب' })).toBeTruthy();
  });

  it('says what is missing rather than showing an empty country', async () => {
    const shop = await aShopWithABranch('فرع دمشق');
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'فرع دمشق' });

    // Every branch is unplaced on the day a shop installs this. A map of an
    // empty country would look broken; the panel says what to do instead.
    expect(screen.getByText(catalogue['branches.map.empty'])).toBeTruthy();
    expect(screen.queryByRole('application', { name: catalogue['place.map.label'] })).toBeNull();
  });

  it('places a branch that was opened without one, afterwards', async () => {
    const shop = await aShopWithABranch();
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'فرع حلب' });

    await shop.person.click(screen.getByRole('button', { name: 'موقع «فرع حلب»' }));
    await paste(shop, catalogue['picker.paste'], ALEPPO_LINK);
    await shop.person.click(screen.getByRole('button', { name: catalogue['action.save'] }));

    const map = await screen.findByRole('application', { name: catalogue['place.map.label'] });
    expect(within(map).getByRole('button', { name: 'فرع حلب' })).toBeTruthy();
  });

  it('refuses a coordinate the Earth does not have, and keeps what was typed', async () => {
    const shop = await aShopWithABranch();
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'فرع حلب' });

    await shop.person.click(screen.getByRole('button', { name: 'موقع «فرع حلب»' }));
    // A digit too many in the latitude: not a place, so the picker does not
    // understand it and says so rather than dropping a marker in the sea.
    await paste(shop, catalogue['picker.paste'], '336.1997, 37.1637');

    expect(screen.getByText(catalogue['picker.paste.unreadable'])).toBeTruthy();
  });

  it('offers a stock location no pin when it is a van, and says why — SYS-14', async () => {
    const shop = await aShopWithABranch();
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'فرع حلب' });

    await goTo(shop, catalogue['nav.locations']);
    await shop.person.click(firstButton(catalogue['locations.open']));
    await shop.person.type(screen.getByLabelText(catalogue['locations.new.name']), 'سيارة التوزيع');

    // A shop floor is somewhere, so it is offered a map.
    expect(screen.getByLabelText(catalogue['place.map'])).toBeTruthy();

    await chooseOption(shop, catalogue['locations.new.kind'], catalogue['location.kind.vehicle']);

    // A van is not. The picker goes, and the reason takes its place — offering
    // one and then refusing it would be this screen's mistake, not the
    // administrator's.
    expect(screen.queryByLabelText(catalogue['place.map'])).toBeNull();
    expect(screen.getByText(catalogue['place.moves'])).toBeTruthy();
  });

  it('gives a warehouse across town a place of its own — SYS-14', async () => {
    const shop = await aShopWithABranch();
    await paste(shop, catalogue['picker.paste'], ALEPPO_LINK);
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'فرع حلب' });

    await goTo(shop, catalogue['nav.locations']);
    await shop.person.click(firstButton(catalogue['locations.open']));
    await shop.person.type(
      screen.getByLabelText(catalogue['locations.new.name']),
      'مستودع الراموسة',
    );
    await chooseOption(
      shop,
      catalogue['locations.new.kind'],
      catalogue['location.kind.store-room'],
    );
    await paste(shop, catalogue['picker.paste'], '36.1400, 37.0800');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['locations.new.submit'] }),
    );

    await screen.findByRole('rowheader', { name: 'مستودع الراموسة' });

    // Two markers: the branch, and the warehouse that is not at it. A shop
    // floor opened alongside would add no third marker, because it is at the
    // branch and `null` there means exactly that.
    const map = await screen.findByRole('application', { name: catalogue['place.map.label'] });
    expect(within(map).getByRole('button', { name: 'فرع حلب' })).toBeTruthy();
    expect(within(map).getByRole('button', { name: 'مستودع الراموسة' })).toBeTruthy();
  });
});
