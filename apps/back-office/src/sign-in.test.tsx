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

/**
 * A system of record that answers sign-in however a test needs and holds an
 * ordinary organisation behind it.
 *
 * The organisation is the real one, because what these tests are about is what
 * happens **before** anybody reaches it — and a port that threw would make a
 * failure to sign in indistinguishable from a shop that could not be read.
 */
function systemThatAnswers(signIn: SystemOfRecord['signIn']): SystemOfRecord {
  const real = developmentSystem({ people: PEOPLE });
  return {
    signIn,
    changeOwnPassword: real.changeOwnPassword.bind(real),
    organisation: real.organisation,
    users: real.users,
  };
}

/** The frame, which is the one thing on screen that says somebody is signed in. */
function isInsideTheShop(): boolean {
  return screen.queryByRole('button', { name: catalogue['shell.signOut'] }) !== null;
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

    expect(isInsideTheShop()).toBe(true);
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
    expect(isInsideTheShop()).toBe(false);
  });

  it('renders a refusal the catalogue has no words for rather than a raw code', async () => {
    // A refusal `SEC` added after this catalogue was written — the ordinary
    // way the two drift, since the domain grows and a catalogue lags. A screen
    // that printed the code at somebody would be showing them a symbol from a
    // program they cannot read. Named here by cast, because every refusal the
    // contract knows today has its sentence.
    const unworded = 'sec.added-after-this-catalogue' as 'sec.identity-not-found';
    open(systemThatAnswers(() => Promise.resolve(refuse(unworded))));
    await signIn('owner', 'till-morning-1');

    expect(screen.getByRole('alert').textContent).toContain(catalogue['refusal.unknown']);
    expect(screen.getByRole('alert').textContent).not.toContain(unworded);
  });

  it('says so rather than failing silently when the store node cannot be reached', async () => {
    open(systemThatAnswers(() => Promise.reject(new Error('no route to the store node'))));
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

    expect(isInsideTheShop()).toBe(true);
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

  it('says an empty field is empty in Arabic, and never lets the browser say it', async () => {
    open();
    const person = userEvent.setup();
    await person.click(screen.getByRole('button', { name: catalogue['signIn.submit'] }));

    expect(screen.getByText(catalogue['signIn.handle.required'])).toBeTruthy();
    expect(screen.getByText(catalogue['signIn.password.required'])).toBeTruthy();
    // The browser's own words, in the browser's own language, under an Arabic
    // label. `TextInput` makes them unreachable; this is the screen holding the
    // other half of the bargain by supplying its own.
    expect(document.body.textContent).not.toContain('Please fill out this field');

    // And it never asked the store node, because there was nothing to ask about.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the empty-field message as soon as there is something in it', async () => {
    open();
    const person = userEvent.setup();
    await person.click(screen.getByRole('button', { name: catalogue['signIn.submit'] }));
    expect(screen.getByText(catalogue['signIn.handle.required'])).toBeTruthy();

    await person.type(screen.getByLabelText(catalogue['signIn.handle']), 'o');
    expect(screen.queryByText(catalogue['signIn.handle.required'])).toBeNull();
  });

  it('never writes a session anywhere it could outlive the tab', () => {
    // `SEC-09` can force a sign-out and `U23` owns sessions. Anything stored
    // here would be a session nobody upstream can take back.
    open();
    expect(globalThis.localStorage.length).toBe(0);
    expect(globalThis.sessionStorage.length).toBe(0);
  });
});
