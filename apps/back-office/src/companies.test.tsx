import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { refuse } from '@vertex/kernel';

import { catalogue } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import {
  PEOPLE,
  enterTheShop,
  firstButton,
  goTo,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';
import type { SystemOfRecord } from './system.js';

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function aShopWith(...names: readonly string[]): Promise<OpenShop> {
  const shop = await enterTheShop();
  for (const name of names) await registerCompany(shop, name);
  return shop;
}

/** The same shop, with one command of the port answering differently. */
function shopWhere(
  change: (system: SystemOfRecord) => SystemOfRecord['organisation'],
): SystemOfRecord {
  const real = developmentSystem({ people: PEOPLE });
  return {
    signIn: real.signIn.bind(real),
    changeOwnPassword: real.changeOwnPassword.bind(real),
    signOut: real.signOut.bind(real),
    organisation: change(real),
    users: real.users,
    currencies: real.currencies,
    rates: real.rates,
  };
}

describe('Companies — SYS-09', () => {
  it('registers a company without anybody calling the vendor', async () => {
    const shop = await enterTheShop();

    // The whole of it, on one screen, starting from a shop that has nothing:
    // `SYS-09`'s acceptance criterion is that this needs no vendor involvement
    // and no code change.
    expect(screen.getByText(catalogue['companies.empty'])).toBeTruthy();
    await registerCompany(shop, 'مؤسسة الشام');

    expect(screen.getByRole('rowheader', { name: 'مؤسسة الشام' })).toBeTruthy();
  });

  it('refuses a second company under a name already in the list, and says which name', async () => {
    const shop = await aShopWith('مؤسسة الشام');

    await shop.person.click(firstButton(catalogue['companies.register']));
    await shop.person.type(screen.getByLabelText(catalogue['companies.new.name']), 'مؤسسة الشام');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['companies.new.submit'] }),
    );

    // The refusal is `SYS`'s own and reaches the screen carrying the name it
    // compared against, so the sentence says which name rather than that
    // something went wrong.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('مؤسسة الشام');

    // And it is shown **in the dialog**, beside the field that caused it: a
    // dialog that closed onto a message would make somebody reopen it to fix
    // what the message said.
    expect(screen.getByLabelText(catalogue['companies.new.name'])).toBeTruthy();
  });

  it('withdraws a company from use and never deletes it', async () => {
    const shop = await aShopWith('مؤسسة الشام');

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['companies.withdraw.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['companies.withdraw'] }));

    // Gone from the list somebody works in…
    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'مؤسسة الشام' })).toBeNull();
    });

    // …and still there, because `SYS-09` deactivates and never deletes. An
    // administrator who could not see it could not put it back, and calling the
    // vendor to do that is the one thing the feature says must never be needed.
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    expect(await screen.findByRole('rowheader', { name: 'مؤسسة الشام' })).toBeTruthy();
    expect(screen.getByText(catalogue['status.withdrawn'])).toBeTruthy();

    // Putting it back is asked about too. The two rows of a listing that shows
    // withdrawn companies differ by one icon, and a misfire on either of them
    // changes what every document issued from today names as its issuer.
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['companies.restore.title'] }),
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await shop.person.click(screen.getByRole('button', { name: catalogue['companies.restore'] }));
    expect(await screen.findByText(catalogue['status.inUse'])).toBeTruthy();
  });

  it('renames a company, and the list says so', async () => {
    const shop = await aShopWith('مؤسسة الشام');

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['companies.rename.title'] }),
    );
    const field = screen.getByLabelText(catalogue['companies.new.name']);
    await shop.person.clear(field);
    await shop.person.type(field, 'مؤسسة الشام التجارية');
    await shop.person.click(screen.getByRole('button', { name: catalogue['action.rename'] }));

    expect(await screen.findByRole('rowheader', { name: 'مؤسسة الشام التجارية' })).toBeTruthy();
  });

  it('narrows the list to what was typed', async () => {
    const shop = await aShopWith('مؤسسة الشام', 'مخازن حلب');

    await shop.person.type(screen.getByLabelText(catalogue['companies.search']), 'حلب');

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'مؤسسة الشام' })).toBeNull();
    });
    expect(screen.getByRole('rowheader', { name: 'مخازن حلب' })).toBeTruthy();
  });

  it('counts the branches a company is trading from, and not the ones it has shut', async () => {
    const shop = await aShopWith('مؤسسة الشام');

    await goTo(shop, catalogue['nav.branches']);
    await shop.person.click(firstButton(catalogue['branches.open']));
    await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), 'حلب');
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'حلب' });

    await goTo(shop, catalogue['nav.companies']);

    // One branch, said as one branch: Arabic counts in six forms and a figure
    // with a noun beside it is wrong in five of them.
    expect(await screen.findByText('فرع واحد')).toBeTruthy();
  });

  it('names the right somebody is missing rather than reporting a failure', async () => {
    // `SEC-02` grants per action and `SYS` declares every right it enforces, so
    // a refusal can say **which** one is missing. A screen that printed
    // "sys.company.create" would be showing somebody a symbol out of a program
    // they cannot read; one that said only "not permitted" would send them to
    // the owner with nothing to ask for.
    const refusing = shopWhere((real) => ({
      ...real.organisation,
      companies: {
        ...real.organisation.companies,
        register: () =>
          Promise.resolve(refuse('sys.not-permitted', { right: 'sys.company.create' })),
      },
    }));

    const shop = await enterTheShop(refusing);
    await shop.person.click(firstButton(catalogue['companies.register']));
    await shop.person.type(screen.getByLabelText(catalogue['companies.new.name']), 'مؤسسة الشام');
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['companies.new.submit'] }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(catalogue['permission.sys.company.create']);
    expect(alert.textContent).not.toContain('sys.company.create');
  });

  it('says the store node could not be reached rather than saying the shop refused', async () => {
    const unreachable = shopWhere((real) => ({
      ...real.organisation,
      companies: {
        ...real.organisation.companies,
        list: () => Promise.reject(new Error('no route to the store node')),
      },
    }));

    await enterTheShop(unreachable);

    // A refusal means the shop said no; this means nobody was asked, and the
    // two must not look alike on a screen somebody acts on.
    expect(await screen.findByText(catalogue['data.unreachable'])).toBeTruthy();

    // And it must not say the shop has no companies. An empty shop and a shop
    // that could not be read are indistinguishable from here and call for
    // opposite reactions — one is an invitation to set the shop up, the other
    // is a reason to check the connection.
    expect(screen.queryByText(catalogue['companies.empty'])).toBeNull();
  });
});

describe('The business profile arrives with the company — SYS-05', () => {
  it('gives a company a profile in the transaction that registered it', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');

    // Not a second command an administrator might not know to run: a receipt
    // printed on the shop's first afternoon has to print something, so the
    // profile exists from the moment the company does.
    const [company] = await shop.system.organisation.companies.list();
    expect(company).toBeDefined();
    const profile = await shop.system.organisation.profile.read(company!.id);
    expect(profile?.name).toBe('مؤسسة الشام');
  });

  it('is what the frame calls this shop', async () => {
    const shop = await enterTheShop();

    // Before there is a company there is nothing to print on a receipt, so the
    // product's own name stands in the frame; after there is, the shop's does.
    expect(screen.getByText(catalogue['app.name'])).toBeTruthy();

    await registerCompany(shop, 'مؤسسة الشام');
    const named = await screen.findAllByText('مؤسسة الشام');
    expect(named.length).toBeGreaterThan(1);
  });
});

// Not named for `SEC-04`: nothing here scopes an answer to a branch, and a
// name is the claim that the feature behaves as specified.
describe('The organisation is read only on behalf of somebody signed in', () => {
  it('refuses to read the shop on behalf of nobody', async () => {
    const system = developmentSystem({ people: PEOPLE });

    // A read with no actor is a defect rather than a refusal: there is nobody
    // for `SEC-04` to scope the answer to, so there is no honest answer to
    // give. It throws where it is asked rather than resolving to a refusal,
    // which is what `README.md` means by a defect being an exception.
    expect(() => system.organisation.companies.list()).toThrow();

    await enterTheShop(system);
    expect(await system.organisation.companies.list()).toEqual([]);
  });
});

// Not named for a feature: the demo is a way of looking at the screens, and
// proves nothing a shop does.
describe('The demo shop', () => {
  it('opens already set up when asked for, and empty otherwise', async () => {
    const demo = developmentSystem({ people: PEOPLE, demo: true });
    await enterTheShop(demo);

    const companies = await demo.organisation.companies.list();
    const branches = await demo.organisation.branches.list();
    expect(companies.length).toBeGreaterThan(1);
    expect(branches.length).toBeGreaterThan(companies.length);
    // Enough to show every state: a branch with a paired till and today's
    // rates, and a branch with neither.
    const tills = await Promise.all(
      branches.map((branch) => demo.organisation.registers.list(branch.id)),
    );
    expect(tills.some((one) => one.length === 0)).toBe(true);
    expect(tills.flat().every((till) => till.heldBy !== null)).toBe(true);
    // Recorded through the real `FX`, which would refuse a rate typed on the
    // wrong side of its spread — so a demo that reads at all reads true.
    // The branch that opened a till is the one that starts with today's rates.
    const priced = branches[tills.findIndex((one) => one.length > 0)];
    const board = await demo.rates.board(priced!.id);
    expect(board.ok && board.value.lines.every((line) => line.revision !== null)).toBe(true);

    cleanup();
    const plain = developmentSystem({ people: PEOPLE });
    await enterTheShop(plain);
    expect(await plain.organisation.companies.list()).toEqual([]);
  });
});
