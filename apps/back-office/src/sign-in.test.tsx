import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { refuse } from '@vertex/kernel';

import { App } from './App.js';
import { catalogue } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import type { SystemOfRecord } from './system.js';

afterEach(cleanup);

const PEOPLE = [
  { handle: 'owner', password: 'till-morning-1' },
  { handle: 'ahmad', password: 'till-morning-1', active: false },
];

function open(system: SystemOfRecord = developmentSystem({ people: PEOPLE })): void {
  render(<App system={system} />);
}

async function signIn(handle: string, password: string): Promise<void> {
  const person = userEvent.setup();
  await person.type(screen.getByLabelText(catalogue['signIn.handle']), handle);
  await person.type(screen.getByLabelText(catalogue['signIn.password']), password);
  await person.click(screen.getByRole('button', { name: catalogue['signIn.submit'] }));
}

describe('Sign-in — SEC-09', () => {
  it('lets somebody in with the password their shop set', async () => {
    open();
    await signIn('owner', 'till-morning-1');

    expect(screen.getByText(catalogue['shell.nothingYet'])).toBeTruthy();
    expect(screen.queryByLabelText(catalogue['signIn.password'])).toBeNull();
  });

  it('answers a name that does not exist exactly as it answers a wrong password', async () => {
    // The property, not the message: a screen that distinguished them would
    // hand back the list of everybody who works here to anybody who can reach
    // a till. Asserted as an equality so that changing one message without the
    // other cannot quietly reintroduce the difference.
    open();
    await signIn('owner', 'not-the-password');
    const forWrongPassword = screen.getByRole('alert').textContent;

    cleanup();
    open();
    await signIn('nobody-by-that-name', 'not-the-password');
    const forUnknownHandle = screen.getByRole('alert').textContent;

    expect(forWrongPassword).toBe(forUnknownHandle);
    expect(forWrongPassword).toContain(catalogue['refusal.sec.password-wrong']);
  });

  it('tells somebody withdrawn from the shop that they are, once they have proved who they are', async () => {
    // `SEC-09` deactivates and never deletes, so the account still exists and
    // its password still verifies. What it no longer does is open the shop.
    open();
    await signIn('ahmad', 'till-morning-1');

    expect(screen.getByRole('alert').textContent).toContain(catalogue['refusal.sec.user-inactive']);
    expect(screen.queryByText(catalogue['shell.nothingYet'])).toBeNull();
  });

  it('renders a refusal the catalogue has no words for rather than a raw code', async () => {
    // A real refusal `SEC` can return and this screen has never been given a
    // sentence for — which is the ordinary way the two drift, since the domain
    // grows and a catalogue lags. A screen that printed `sec.identity-shared`
    // at somebody would be showing them a symbol from a program they cannot
    // read.
    open({
      signIn: () => Promise.resolve(refuse('sec.identity-shared')),
    });
    await signIn('owner', 'till-morning-1');

    expect(screen.getByRole('alert').textContent).toContain(catalogue['refusal.unknown']);
    expect(screen.getByRole('alert').textContent).not.toContain('sec.identity-shared');
  });

  it('says so rather than failing silently when the store node cannot be reached', async () => {
    open({
      signIn: () => Promise.reject(new Error('no route to the store node')),
    });
    await signIn('owner', 'till-morning-1');

    expect(screen.getByRole('alert').textContent).toContain(catalogue['refusal.unknown']);
  });
});

describe('The sign-in screen is operable and readable — SYS-01', () => {
  it('submits on Enter, because a form that needs the mouse is not keyboard-operable', async () => {
    open();
    const person = userEvent.setup();

    await person.type(screen.getByLabelText(catalogue['signIn.handle']), 'owner');
    await person.type(screen.getByLabelText(catalogue['signIn.password']), 'till-morning-1{Enter}');

    expect(screen.getByText(catalogue['shell.nothingYet'])).toBeTruthy();
  });

  it('puts the keyboard where the first thing to type is', () => {
    open();
    expect(document.activeElement).toBe(screen.getByLabelText(catalogue['signIn.handle']));
  });

  it('begins with a skip link, and is right-to-left because it is Arabic', () => {
    open();

    expect(screen.getByRole('link', { name: catalogue['a11y.skipToContent'] })).toBeTruthy();
    // `SYS-01`: direction is a consequence of the locale, not a flag beside it.
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('announces a refusal instead of only colouring one', async () => {
    open();
    await signIn('owner', 'not-the-password');

    // `role="alert"`: a cashier who is not looking at the form when it fails
    // still has to be told, and colour alone reaches neither them nor anybody
    // who cannot see it (§4.8, §11).
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('never writes a session anywhere it could outlive the tab', () => {
    // `SEC-09` can force a sign-out and `U23` owns sessions. Anything stored
    // here would be a session nobody upstream can take back.
    open();
    expect(globalThis.localStorage.length).toBe(0);
    expect(globalThis.sessionStorage.length).toBe(0);
  });
});
