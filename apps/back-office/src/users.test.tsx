import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { refuse } from '@vertex/kernel';

import { catalogue, createTranslator } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import {
  chooseOption,
  enrolUser,
  enterTheShop,
  firstButton,
  goTo,
  PEOPLE,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';
import type { SystemOfRecord } from './system.js';

/**
 * `SEC-09`: the people who work in a shop, added and staffed from the screen
 * alone — and `SEC-01` / `SEC-04`, the role each of them holds and where it
 * reaches.
 *
 * The whole application is rendered and signed into, over `dev-system.ts`'s
 * development stand-in for `SEC` (real `SEC` cannot run in a browser at all —
 * see that file). What these tests are about is the shape a screen actually
 * has to answer to: a handle taken twice, a password that does not match its
 * own confirmation, the shop's last owner standing down, and a person who did
 * not exist an assertion ago signing in and finding themselves inside.
 */

const say = createTranslator();

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function aShopOnUsers(): Promise<OpenShop> {
  const shop = await enterTheShop();
  await goTo(shop, catalogue['nav.users']);
  return shop;
}

/** Answers the confirmation a withdrawal is asked through. */
async function confirmWithdrawal(shop: OpenShop): Promise<void> {
  const question = await screen.findByRole('alertdialog');
  await shop.person.click(
    within(question).getByRole('button', { name: catalogue['users.scope.withdraw'] }),
  );
}

/** Ticks a role in the scope dialog's list of roles to assign. */
async function tick(shop: OpenShop, role: string): Promise<void> {
  await shop.person.click(screen.getByRole('checkbox', { name: role }));
}

/** The row a person's name is on, found through the cell §11 makes a row header. */
function rowFor(name: string): HTMLElement {
  const cell = screen.getByRole('rowheader', { name });
  const row = cell.closest('[role="row"]');
  if (row === null) throw new Error(`No row for "${name}".`);
  return row as HTMLElement;
}

describe('Users — SEC-09', () => {
  it('adds a user with no vendor involvement, present the moment they are added', async () => {
    const shop = await aShopOnUsers();
    // The owner who signed in is already a user of this shop — `SYS-13`'s first
    // run would have made them one — so the empty state is never seen once
    // signed in, and the list itself is what this asserts against.
    expect(screen.getByRole('rowheader', { name: 'owner' })).toBeTruthy();

    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });

    expect(screen.getByRole('rowheader', { name: 'أحمد' })).toBeTruthy();
    expect(screen.getByText('ahmad')).toBeTruthy();
  });

  it('refuses a handle another user already carries', async () => {
    const shop = await aShopOnUsers();
    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });

    await shop.person.click(firstButton(catalogue['users.enrol']));
    await shop.person.type(screen.getByLabelText(catalogue['users.new.name']), 'أحمد الثاني');
    await shop.person.type(screen.getByLabelText(catalogue['users.new.handle']), 'ahmad');
    await shop.person.type(
      screen.getByLabelText(catalogue['users.new.password']),
      'till-morning-1',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['users.new.password.confirm']),
      'till-morning-1',
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.new.submit'] }));

    expect(
      await screen.findByText(say.format('refusal.sec.handle-taken', { handle: 'ahmad' })),
    ).toBeTruthy();
    // Refused, not accepted twice: one row still carries this handle.
    expect(screen.getAllByRole('rowheader', { name: 'أحمد' })).toHaveLength(1);
  });

  it('refuses to submit a password that does not match its own confirmation', async () => {
    const shop = await aShopOnUsers();

    await shop.person.click(firstButton(catalogue['users.enrol']));
    await shop.person.type(screen.getByLabelText(catalogue['users.new.name']), 'أحمد');
    await shop.person.type(screen.getByLabelText(catalogue['users.new.handle']), 'ahmad');
    await shop.person.type(
      screen.getByLabelText(catalogue['users.new.password']),
      'till-morning-1',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['users.new.password.confirm']),
      'a-different-one',
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.new.submit'] }));

    expect(screen.getByText(catalogue['users.new.password.mismatch'])).toBeTruthy();
    // Never asked: a mismatch is caught before the dialog reaches the port at all.
    expect(screen.queryByRole('rowheader', { name: 'أحمد' })).toBeNull();
  });

  it('renames a user and withdraws them from the shop, then puts them back', async () => {
    const shop = await aShopOnUsers();
    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });

    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.rename.title'] }),
    );
    const nameField = screen.getByLabelText(catalogue['users.new.name']);
    await shop.person.clear(nameField);
    await shop.person.type(nameField, 'أحمد سامي');
    await shop.person.click(screen.getByRole('button', { name: catalogue['action.rename'] }));
    expect(await screen.findByRole('rowheader', { name: 'أحمد سامي' })).toBeTruthy();

    await shop.person.click(
      within(rowFor('أحمد سامي')).getByRole('button', {
        name: catalogue['users.withdraw.title'],
      }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.withdraw'] }));

    // Withdrawn drops out of the ordinary listing, the same way every
    // structural entity's row does (`SYS-09`) — gone from the working list,
    // never gone from the shop's record.
    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'أحمد سامي' })).toBeNull();
    });
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    expect(await screen.findByRole('rowheader', { name: 'أحمد سامي' })).toBeTruthy();
    expect(rowFor('أحمد سامي').textContent).toContain(catalogue['status.withdrawn']);

    await shop.person.click(
      within(rowFor('أحمد سامي')).getByRole('button', {
        name: catalogue['users.restore.title'],
      }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.restore'] }));
    await waitFor(() => {
      expect(rowFor('أحمد سامي').textContent).toContain(catalogue['status.inUse']);
    });
  });

  it('refuses to withdraw the shop’s last owner', async () => {
    const shop = await aShopOnUsers();

    await shop.person.click(
      within(rowFor('owner')).getByRole('button', { name: catalogue['users.withdraw.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.withdraw'] }));

    expect(await screen.findByText(say.format('refusal.sec.last-owner', {}))).toBeTruthy();
    expect(rowFor('owner').textContent).toContain(catalogue['status.inUse']);
  });
});

describe('A cashier added, staffed and working — SEC-01, SEC-04, SEC-09', () => {
  it('assigns a role reaching every branch, and it takes effect immediately', async () => {
    const shop = await aShopOnUsers();
    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });

    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.scope.action'] }),
    );

    expect(await screen.findByText(catalogue['users.scope.none'])).toBeTruthy();

    await tick(shop, catalogue['role.manager']);
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));

    expect(
      await screen.findByText(
        say.format('users.scope.assigned', { name: 'أحمد', role: catalogue['role.manager'] }),
      ),
    ).toBeTruthy();
    // Listed, with where it reaches — both read from the same row this test
    // is about to withdraw, which is what proves it is the assignment and not
    // the role picker still showing what was chosen.
    expect(screen.getByRole('button', { name: catalogue['users.scope.withdraw'] })).toBeTruthy();
    expect(screen.getAllByText(catalogue['role.manager']).length).toBeGreaterThan(0);
    expect(screen.getAllByText(catalogue['users.scope.tenantWide']).length).toBeGreaterThan(0);

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['users.scope.withdraw'] }),
    );
    await confirmWithdrawal(shop);
    expect(await screen.findByText(catalogue['users.scope.none'])).toBeTruthy();
  });

  it('assigns a role confined to one branch, named by that branch', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    await shop.person.click(firstButton(catalogue['branches.open']));
    await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), 'حلب');
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'حلب' });

    await goTo(shop, catalogue['nav.users']);
    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });

    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.scope.action'] }),
    );
    await tick(shop, catalogue['role.cashier']);
    await chooseOption(shop, catalogue['users.scope.reach'], catalogue['users.scope.someBranches']);
    await shop.person.click(screen.getByRole('checkbox', { name: 'حلب' }));
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));

    await screen.findByText(
      say.format('users.scope.assigned', { name: 'أحمد', role: catalogue['role.cashier'] }),
    );
    // The form resets to its blank state on success (its own "reach" picker
    // reverting to "كل فروع المتجر" among the choices), so what is asserted
    // is the assignment line itself: the branch it actually reaches.
    expect(screen.getByText('حلب')).toBeTruthy();
  });

  it('lets a newly added cashier sign in and work, with nobody else involved', async () => {
    const shop = await aShopOnUsers();
    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });

    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.scope.action'] }),
    );
    await tick(shop, catalogue['role.cashier']);
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));
    await screen.findByText(
      say.format('users.scope.assigned', { name: 'أحمد', role: catalogue['role.cashier'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['action.close'] }));

    await shop.person.click(screen.getByRole('button', { name: catalogue['shell.signOut'] }));
    await screen.findByRole('button', { name: catalogue['signIn.submit'] });

    await shop.person.type(screen.getByLabelText(catalogue['signIn.handle']), 'ahmad');
    await shop.person.type(screen.getByLabelText(catalogue['signIn.password']), 'till-morning-1');
    await shop.person.click(screen.getByRole('button', { name: catalogue['signIn.submit'] }));

    await screen.findByRole('button', { name: catalogue['shell.signOut'] });
    expect(screen.getByText(say.format('shell.signedInAs', { handle: 'ahmad' }))).toBeTruthy();
  });

  it('resets a password from the security dialog, and the new one signs in', async () => {
    const shop = await aShopOnUsers();
    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });

    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.security.action'] }),
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['users.security.resetPassword']),
      'a-fresh-morning-2',
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['users.security.resetPassword.submit'] }),
    );
    expect(
      await screen.findByText(say.format('users.security.resetPassword.done', { name: 'أحمد' })),
    ).toBeTruthy();
    await shop.person.click(screen.getByRole('button', { name: catalogue['action.close'] }));

    await shop.person.click(screen.getByRole('button', { name: catalogue['shell.signOut'] }));
    await screen.findByRole('button', { name: catalogue['signIn.submit'] });
    await shop.person.type(screen.getByLabelText(catalogue['signIn.handle']), 'ahmad');
    await shop.person.type(
      screen.getByLabelText(catalogue['signIn.password']),
      'a-fresh-morning-2',
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['signIn.submit'] }));

    await screen.findByRole('button', { name: catalogue['shell.signOut'] });
  });

  it('ends a user’s sessions from the security dialog', async () => {
    const shop = await aShopOnUsers();
    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });

    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.security.action'] }),
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['users.security.forceSignOut'] }),
    );

    expect(
      await screen.findByText(say.format('users.security.forceSignOut.done', { name: 'أحمد' })),
    ).toBeTruthy();
  });
});

describe('A person’s roles, when the read has not answered — SEC-09', () => {
  it('says the read failed rather than that the person holds no role', async () => {
    // Told a person held nothing when the question had never been answered,
    // an administrator granted a role on that basis.
    const base = developmentSystem({ people: PEOPLE });
    const system: SystemOfRecord = {
      ...base,
      users: {
        ...base.users,
        assignments: {
          ...base.users.assignments,
          of: () => Promise.reject(new Error('the store node is unreachable')),
        },
      },
    };
    const shop = await enterTheShop(system);
    await goTo(shop, catalogue['nav.users']);
    await shop.person.click(
      within(rowFor('owner')).getByRole('button', { name: catalogue['users.scope.action'] }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(catalogue['data.unreachable'])).toBeTruthy();
    expect(within(dialog).queryByText(catalogue['users.scope.none'])).toBeNull();
  });
});

describe('Adding a person and giving them a role in one go — SEC-09, SEC-01', () => {
  async function addAhmad(shop: OpenShop): Promise<void> {
    await shop.person.click(firstButton(catalogue['users.enrol']));
    await shop.person.type(screen.getByLabelText(catalogue['users.new.name']), 'أحمد');
    await shop.person.type(screen.getByLabelText(catalogue['users.new.handle']), 'ahmad');
    await shop.person.type(
      screen.getByLabelText(catalogue['users.new.password']),
      'till-morning-1',
    );
    await shop.person.type(
      screen.getByLabelText(catalogue['users.new.password.confirm']),
      'till-morning-1',
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.new.submit'] }));
  }

  it('asks for the new person’s role straight after adding them, and gives it', async () => {
    const shop = await aShopOnUsers();
    await addAhmad(shop);

    // `enrol` has already happened; the second step names who it is about.
    expect(
      await screen.findByRole('dialog', {
        name: say.format('users.new.role.title', { name: 'أحمد' }),
      }),
    ).toBeTruthy();
    await tick(shop, catalogue['role.cashier']);
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));

    expect(
      await screen.findByText(
        say.format('users.scope.assigned', { name: 'أحمد', role: catalogue['role.cashier'] }),
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.scope.action'] }),
    );
    expect(
      await screen.findByRole('button', { name: catalogue['users.scope.withdraw'] }),
    ).toBeTruthy();
  });

  it('leaves the person added and holding nothing when their role is put off', async () => {
    const shop = await aShopOnUsers();
    await addAhmad(shop);

    await shop.person.click(
      await screen.findByRole('button', { name: catalogue['users.new.role.skip'] }),
    );

    // Two commands, two outcomes: the enrolment stands, and nothing was assigned.
    expect(await screen.findByRole('rowheader', { name: 'أحمد' })).toBeTruthy();
    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.scope.action'] }),
    );
    expect(await screen.findByText(catalogue['users.scope.none'])).toBeTruthy();
  });

  it('asks for at least one role rather than assigning none', async () => {
    const shop = await aShopOnUsers();
    await addAhmad(shop);
    await screen.findByRole('button', { name: catalogue['users.new.role.skip'] });

    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));

    expect(await screen.findByText(catalogue['users.scope.role.required'])).toBeTruthy();
    // And the person is put where the answer goes, as every refused field does.
    const [firstRole] = screen.getAllByRole('checkbox');
    await waitFor(() => {
      expect(document.activeElement).toBe(firstRole);
    });
  });
});

describe('Several roles, one reach, and changing it in place — SEC-01, SEC-04', () => {
  async function openScopeOfAhmad(shop: OpenShop): Promise<void> {
    await enrolUser(shop, { handle: 'ahmad', name: 'أحمد', password: 'till-morning-1' });
    await shop.person.click(
      within(rowFor('أحمد')).getByRole('button', { name: catalogue['users.scope.action'] }),
    );
    await screen.findByText(catalogue['users.scope.none']);
  }

  it('assigns every role ticked under the one reach chosen for them', async () => {
    const shop = await aShopOnUsers();
    await openScopeOfAhmad(shop);

    await tick(shop, catalogue['role.cashier']);
    await tick(shop, catalogue['role.floor-supervisor']);
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));

    // Named in the order the shop's roles are listed, whatever order they
    // were ticked in.
    const both = new Intl.ListFormat('ar', { style: 'long', type: 'conjunction' }).format([
      catalogue['role.floor-supervisor'],
      catalogue['role.cashier'],
    ]);
    expect(
      await screen.findByText(
        say.format('users.scope.assignedMany', { name: 'أحمد', roles: both }),
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: catalogue['users.scope.withdraw'] })).toHaveLength(
      2,
    );
  });

  it('changes a held role’s reach in place, rather than holding it twice', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    await shop.person.click(firstButton(catalogue['branches.open']));
    await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), 'حلب');
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'حلب' });
    await goTo(shop, catalogue['nav.users']);
    await openScopeOfAhmad(shop);

    await tick(shop, catalogue['role.cashier']);
    await chooseOption(shop, catalogue['users.scope.reach'], catalogue['users.scope.someBranches']);
    await shop.person.click(screen.getByRole('checkbox', { name: 'حلب' }));
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));
    await screen.findByRole('button', { name: catalogue['users.scope.editReach'] });

    // The shortcut fills the form with this assignment as it stands…
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['users.scope.editReach'] }),
    );
    await chooseOption(shop, catalogue['users.scope.reach'], catalogue['users.scope.tenantWide']);
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));

    // …and `assign` replaces a held role's reach rather than adding a second
    // assignment beside it.
    await waitFor(() => {
      expect(screen.getAllByText(catalogue['users.scope.tenantWide']).length).toBeGreaterThan(1);
    });
    expect(screen.getAllByRole('button', { name: catalogue['users.scope.withdraw'] })).toHaveLength(
      1,
    );
  });

  it('asks before withdrawing a role, and keeps it when the answer is no', async () => {
    const shop = await aShopOnUsers();
    await openScopeOfAhmad(shop);
    await tick(shop, catalogue['role.cashier']);
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));
    await shop.person.click(
      await screen.findByRole('button', { name: catalogue['users.scope.withdraw'] }),
    );

    const question = await screen.findByRole('alertdialog');
    await shop.person.click(
      within(question).getByRole('button', { name: catalogue['action.cancel'] }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(screen.getByRole('button', { name: catalogue['users.scope.withdraw'] })).toBeTruthy();
  });

  it('keeps what went through when a later role is refused, and leaves only the rest ticked', async () => {
    // A refusal part-way through: the first role is assigned — one commit of
    // its own — and must be listed as held, not hidden behind the refusal of
    // the second.
    const base = developmentSystem({ people: PEOPLE });
    let refusedRole: string | null = null;
    const system: SystemOfRecord = {
      ...base,
      users: {
        ...base.users,
        assignments: {
          ...base.users.assignments,
          assign: (input) =>
            input.role === refusedRole
              ? Promise.resolve(refuse('sec.role-withdrawn', {}))
              : base.users.assignments.assign(input),
        },
      },
    };
    const shop = await enterTheShop(system);
    await goTo(shop, catalogue['nav.users']);
    await openScopeOfAhmad(shop);
    const roles = await base.users.roles.list();
    refusedRole = roles.find((one) => one.seeded === 'floor-supervisor')?.id ?? null;

    await tick(shop, catalogue['role.cashier']);
    await tick(shop, catalogue['role.floor-supervisor']);
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));

    expect(await screen.findByText(catalogue['refusal.sec.role-withdrawn'])).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: catalogue['users.scope.withdraw'] }),
      ).toHaveLength(1);
    });
    expect(
      screen.getByRole('checkbox', { name: catalogue['role.floor-supervisor'] }),
    ).toHaveProperty('checked', true);
  });
});
