import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue, createTranslator } from './catalogue.js';
import { enterTheShop, startAt } from './screens.fixture.js';

/**
 * `Credentials.changeOwnPassword`, as `SEC-09` states it: available to
 * whoever is signed in, over their own record, with the password they already
 * have — reached from the frame itself rather than from any screen of the
 * shop's structure, since it names nobody but the caller.
 */

const say = createTranslator();

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

describe('Changing one’s own password — SEC-09', () => {
  it('refuses a current password that is wrong, without changing anything', async () => {
    const shop = await enterTheShop();
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['shell.account.action'] }),
    );

    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.current']),
      'not-the-password',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.next']),
      'a-fresh-morning-2',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.confirm']),
      'a-fresh-morning-2',
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['account.changePassword.submit'] }),
    );

    expect(await screen.findByText(say.format('refusal.sec.password-wrong'))).toBeTruthy();
  });

  it('refuses a new password that does not match its own confirmation, asking nothing of the shop', async () => {
    const shop = await enterTheShop();
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['shell.account.action'] }),
    );

    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.current']),
      'till-morning-1',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.next']),
      'a-fresh-morning-2',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.confirm']),
      'a-different-one-3',
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['account.changePassword.submit'] }),
    );

    expect(screen.getByText(catalogue['account.changePassword.mismatch'])).toBeTruthy();
  });

  it('changes the password, and only the new one signs in afterwards', async () => {
    const shop = await enterTheShop();
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['shell.account.action'] }),
    );

    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.current']),
      'till-morning-1',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.next']),
      'a-fresh-morning-2',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['account.changePassword.confirm']),
      'a-fresh-morning-2',
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['account.changePassword.submit'] }),
    );

    await screen.findByText(catalogue['account.changePassword.done']);

    await shop.person.click(screen.getByRole('button', { name: catalogue['shell.signOut'] }));
    await screen.findByRole('button', { name: catalogue['signIn.submit'] });

    await shop.person.type(screen.getByLabelText(catalogue['signIn.handle']), 'owner');
    await shop.person.type(screen.getByLabelText(catalogue['signIn.password']), 'till-morning-1');
    await shop.person.click(screen.getByRole('button', { name: catalogue['signIn.submit'] }));
    expect(await screen.findByText(say.format('refusal.sec.password-wrong'))).toBeTruthy();

    await shop.person.clear(screen.getByLabelText(catalogue['signIn.password']));
    await shop.person.type(
      screen.getByLabelText(catalogue['signIn.password']),
      'a-fresh-morning-2',
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['signIn.submit'] }));

    await screen.findByRole('button', { name: catalogue['shell.signOut'] });
  });
});
