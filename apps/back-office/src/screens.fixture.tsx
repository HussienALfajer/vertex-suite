import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { App } from './App.js';
import { catalogue } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import { hrefOf, type RouteName } from './routing.js';
import type { SystemOfRecord } from './system.js';

/**
 * A shop, signed into, for the screens behind the sign-in to be tested at all.
 *
 * It renders the **whole application** rather than a screen in isolation, and
 * that is the point: what these tests are about is a person opening the back
 * office and setting up their shop, which runs through the session, the frame,
 * the router and the port. A screen rendered with its props handed to it would
 * pass while the four of them disagreed.
 *
 * The system of record is `dev-system.ts`, which hosts the **real `SYS`** — so a
 * test that says a second branch cannot take the first one's name is a test of
 * the module that will refuse it in a shop, not of a fake written to agree.
 */

export const PEOPLE = [{ handle: 'owner', password: 'till-morning-1' }];

/** Where the browser is pointed before the application is mounted. */
export function startAt(route: RouteName, subject?: string): void {
  globalThis.history.replaceState(null, '', hrefOf(route, subject ?? null));
}

export interface OpenShop {
  readonly person: ReturnType<typeof userEvent.setup>;
  readonly system: SystemOfRecord;
}

/**
 * Signs in and waits until the frame is up.
 *
 * Every test starts here because every screen behind sign-in does: there is no
 * way into the back office that skips it, and a fixture that mounted a screen
 * without a session would be exercising a state the application cannot be in.
 */
export async function enterTheShop(
  system: SystemOfRecord = developmentSystem({ people: PEOPLE }),
): Promise<OpenShop> {
  const person = userEvent.setup();
  render(<App system={system} />);

  await person.type(screen.getByLabelText(catalogue['signIn.handle']), 'owner');
  await person.type(screen.getByLabelText(catalogue['signIn.password']), 'till-morning-1');
  await person.click(screen.getByRole('button', { name: catalogue['signIn.submit'] }));
  await screen.findByRole('button', { name: catalogue['shell.signOut'] });

  return { person, system };
}

/** The first control with this name, for an action a screen offers in two places. */
export function firstButton(name: string): HTMLElement {
  const [control] = screen.getAllByRole('button', { name });
  if (control === undefined) throw new Error(`No control named "${name}".`);
  return control;
}

/** Registers a company through the screens, the way a shopkeeper would. */
export async function registerCompany(shop: OpenShop, name: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['companies.register']));
  await shop.person.type(screen.getByLabelText(catalogue['companies.new.name']), name);
  await shop.person.click(screen.getByRole('button', { name: catalogue['companies.new.submit'] }));
  await screen.findByRole('rowheader', { name });
}

export interface NewPerson {
  readonly handle: string;
  readonly name: string;
  readonly password: string;
}

/**
 * Adds a user through the screen, the way a shop's own administrator would —
 * and answers the wizard's second question, which role, with "later": the
 * person is left holding nothing, as every caller of this expects.
 */
export async function enrolUser(shop: OpenShop, person: NewPerson): Promise<void> {
  await shop.person.click(firstButton(catalogue['users.enrol']));
  await shop.person.type(screen.getByLabelText(catalogue['users.new.name']), person.name);
  await shop.person.type(screen.getByLabelText(catalogue['users.new.handle']), person.handle);
  await shop.person.type(screen.getByLabelText(catalogue['users.new.password']), person.password);
  await shop.person.type(
    screen.getByLabelText(catalogue['users.new.password.confirm']),
    person.password,
  );
  await shop.person.click(screen.getByRole('button', { name: catalogue['users.new.submit'] }));
  await shop.person.click(
    await screen.findByRole('button', { name: catalogue['users.new.role.skip'] }),
  );
  await screen.findByRole('rowheader', { name: person.name });
}

/**
 * The control that opens a `Select`.
 *
 * Found through the trigger's **label element** rather than through its
 * accessible name, because React Aria composes that name as the current value
 * followed by the label — so two selects on one screen cannot be told apart by
 * matching either end of it. The label carries an id and the trigger points at
 * it, which is the association the browser itself uses.
 *
 * `within` narrows the search to one part of the page — a dialog, whose
 * branch field shares its label with the chooser on the screen behind it.
 */
export function selectNamed(label: string, within: ParentNode = globalThis.document): HTMLElement {
  const trigger = [...within.querySelectorAll('button[aria-labelledby]')].find((candidate) =>
    (candidate.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .some((id) => globalThis.document.getElementById(id)?.textContent.trim() === label),
  );
  if (trigger === undefined) throw new Error(`No select is labelled "${label}".`);
  return trigger as HTMLElement;
}

/** Picks an option out of a `Select`. */
export async function chooseOption(
  shop: OpenShop,
  label: string,
  option: string,
  within: ParentNode = globalThis.document,
): Promise<void> {
  await shop.person.click(selectNamed(label, within));
  await shop.person.click(await screen.findByRole('option', { name: option }));
}

/**
 * Opens a `Select` and reads what it offers.
 *
 * For the tests about a chooser that has been **narrowed** — where what is not
 * on the list is the claim, and a refusal made unreachable is worth more than a
 * refusal explained.
 */
export async function optionsOf(
  shop: OpenShop,
  label: string,
  within: ParentNode = globalThis.document,
): Promise<readonly string[]> {
  await shop.person.click(selectNamed(label, within));
  const listbox = await screen.findByRole('listbox');
  return [...listbox.querySelectorAll('[role="option"]')].map((option) =>
    option.textContent.trim(),
  );
}

/** Moves to another screen from the frame's own navigation. */
export async function goTo(shop: OpenShop, label: string): Promise<void> {
  await shop.person.click(screen.getByRole('link', { name: label }));
}
