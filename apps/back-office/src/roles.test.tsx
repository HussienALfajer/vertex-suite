import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SYS_PERMISSIONS } from '@vertex/sys/contract';

import { catalogue, createTranslator, nameOfPermission } from './catalogue.js';
import {
  chooseOption,
  enrolUser,
  enterTheShop,
  firstButton,
  goTo,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';

/**
 * `SEC-01`: the roles themselves, defined and withdrawn from the screen alone.
 * `SEC-02`: what each one holds, a right at a time. `SEC-04` from the role's
 * own side: who holds it, and where it reaches — `users.test.tsx` proves the
 * identical assignments from the user's side, and this file never repeats a
 * command it already covers, only the screen that reaches it differently.
 */

const say = createTranslator();

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function aShopOnRoles(): Promise<OpenShop> {
  const shop = await enterTheShop();
  await goTo(shop, catalogue['nav.roles']);
  return shop;
}

/** The row a role's name is on, found through the cell §11 makes a row header. */
function rowFor(name: string): HTMLElement {
  const cell = screen.getByRole('rowheader', { name });
  const row = cell.closest('[role="row"]');
  if (row === null) throw new Error(`No row for "${name}".`);
  return row as HTMLElement;
}

async function defineRole(shop: OpenShop, name: string): Promise<void> {
  await shop.person.click(firstButton(catalogue['roles.define']));
  await shop.person.type(screen.getByLabelText(catalogue['roles.new.name']), name);
  await shop.person.click(screen.getByRole('button', { name: catalogue['roles.new.submit'] }));
  await screen.findByRole('rowheader', { name });
}

/** Opens a role's own permissions and holders, from its row. */
async function openRole(shop: OpenShop, name: string): Promise<void> {
  await shop.person.click(
    within(rowFor(name)).getByRole('button', { name: catalogue['roles.open.action'] }),
  );
}

describe('Roles — SEC-01', () => {
  it('shows the seven seeded roles, present the moment the shop is', async () => {
    await aShopOnRoles();
    expect(screen.getByRole('rowheader', { name: say.format('role.owner') })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: say.format('role.cashier') })).toBeTruthy();
  });

  it('defines a role, present the moment it is defined', async () => {
    const shop = await aShopOnRoles();
    await defineRole(shop, 'مشرف المستودع الليلي');

    expect(screen.getByRole('rowheader', { name: 'مشرف المستودع الليلي' })).toBeTruthy();
  });

  it('renames a role, withdraws it and puts it back', async () => {
    const shop = await aShopOnRoles();
    await defineRole(shop, 'دور تجريبي');

    await shop.person.click(
      within(rowFor('دور تجريبي')).getByRole('button', { name: catalogue['roles.rename.title'] }),
    );
    const field = screen.getByLabelText(catalogue['roles.new.name']);
    await shop.person.clear(field);
    await shop.person.type(field, 'دور مُعاد تسميته');
    await shop.person.click(screen.getByRole('button', { name: catalogue['action.rename'] }));
    await screen.findByRole('rowheader', { name: 'دور مُعاد تسميته' });

    await shop.person.click(
      within(rowFor('دور مُعاد تسميته')).getByRole('button', {
        name: catalogue['roles.withdraw.title'],
      }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['roles.withdraw'] }));

    // Withdrawn drops out of the ordinary listing, the same way every
    // structural row does (`SYS-09`) — gone from the working list, never gone
    // from the shop's record.
    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: 'دور مُعاد تسميته' })).toBeNull();
    });
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    expect(await screen.findByRole('rowheader', { name: 'دور مُعاد تسميته' })).toBeTruthy();
    expect(rowFor('دور مُعاد تسميته').textContent).toContain(catalogue['status.withdrawn']);

    await shop.person.click(
      within(rowFor('دور مُعاد تسميته')).getByRole('button', {
        name: catalogue['roles.restore.title'],
      }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['roles.restore'] }));
    await waitFor(() => {
      expect(rowFor('دور مُعاد تسميته').textContent).toContain(catalogue['status.inUse']);
    });
  });

  it('refuses to strip the last role able to edit roles of that right', async () => {
    const shop = await aShopOnRoles();
    await openRole(shop, say.format('role.owner'));

    // The owner is seeded with every right the edition declares, `sec.role.edit`
    // among them, and is the only role assigned to anybody in a fresh shop — so
    // taking it away here would leave nobody who could ever put it back.
    const editRoles = () =>
      screen.getByRole<HTMLInputElement>('switch', {
        name: catalogue['permission.sec.role.edit'],
      });
    await shop.person.click(editRoles());

    expect(await screen.findByText(say.format('refusal.sec.last-owner', {}))).toBeTruthy();
    expect(editRoles().checked).toBe(true);
  });
});

describe('Roles — SEC-02', () => {
  it('grants and revokes a single right immediately, with no save step', async () => {
    const shop = await aShopOnRoles();
    await defineRole(shop, 'دور فارغ');
    await openRole(shop, 'دور فارغ');

    const view = () =>
      screen.getByRole<HTMLInputElement>('switch', {
        name: catalogue['permission.sec.user.view'],
      });
    expect(view().checked).toBe(false);

    await shop.person.click(view());
    await waitFor(() => {
      expect(view().checked).toBe(true);
    });

    await shop.person.click(view());
    await waitFor(() => {
      expect(view().checked).toBe(false);
    });
  });

  it('offers no control for an action a resource never declared', async () => {
    const shop = await aShopOnRoles();
    await openRole(shop, say.format('role.owner'));

    // A company's business profile is revised, never removed, so `SYS`
    // declares only `view` and `edit` for it — two switches, not five.
    const row = screen
      .getByRole('rowheader', { name: catalogue['permission.resource.sys.business-profile'] })
      .closest('[role="row"]');
    if (row === null) throw new Error('No row for the business profile resource.');
    expect(within(row as HTMLElement).getAllByRole('switch')).toHaveLength(2);
  });

  it('offers the rights outside the five as their own switches', async () => {
    const shop = await aShopOnRoles();
    await openRole(shop, say.format('role.owner'));

    const control = screen.getByRole<HTMLInputElement>('switch', {
      name: catalogue['permission.sec.user.reset-password'],
    });
    expect(control.checked).toBe(true);
  });
});

describe('Roles — SEC-04', () => {
  it('shows the signed-in owner already holding the owner role tenant-wide', async () => {
    const shop = await aShopOnRoles();
    await openRole(shop, say.format('role.owner'));

    expect(screen.getAllByText('owner').length).toBeGreaterThan(0);
    expect(screen.getAllByText(catalogue['users.scope.tenantWide']).length).toBeGreaterThan(0);
  });

  it('assigns a role to a user with a branch-scoped reach, from the role’s own side', async () => {
    const shop = await enterTheShop();
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.branches']);
    await shop.person.click(firstButton(catalogue['branches.open']));
    await shop.person.type(screen.getByLabelText(catalogue['branches.new.name']), 'حلب');
    await shop.person.click(screen.getByRole('button', { name: catalogue['branches.new.submit'] }));
    await screen.findByRole('rowheader', { name: 'حلب' });

    await goTo(shop, catalogue['nav.users']);
    await enrolUser(shop, { handle: 'huda', name: 'هدى', password: 'till-morning-1' });

    await goTo(shop, catalogue['nav.roles']);
    await openRole(shop, say.format('role.cashier'));

    expect(await screen.findByText(catalogue['roles.holders.none'])).toBeTruthy();

    await chooseOption(shop, catalogue['roles.holders.user'], 'هدى');
    await chooseOption(shop, catalogue['users.scope.reach'], catalogue['users.scope.someBranches']);
    await shop.person.click(screen.getByRole('checkbox', { name: 'حلب' }));
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));

    await screen.findByText(
      say.format('users.scope.assigned', { name: 'هدى', role: say.format('role.cashier') }),
    );
    expect(screen.getAllByText('هدى').length).toBeGreaterThan(0);
    expect(screen.getAllByText('حلب').length).toBeGreaterThan(0);

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['users.scope.withdraw'] }),
    );
    expect(await screen.findByText(catalogue['roles.holders.none'])).toBeTruthy();
  });

  it('refuses to leave the tenant with nobody who can edit roles, standing the last owner down from here', async () => {
    const shop = await aShopOnRoles();
    await openRole(shop, say.format('role.owner'));

    await shop.person.click(
      screen.getByRole('button', { name: catalogue['users.scope.withdraw'] }),
    );

    expect(await screen.findByText(say.format('refusal.sec.last-owner', {}))).toBeTruthy();
    expect(screen.queryByText(catalogue['roles.holders.none'])).toBeNull();
  });
});

describe('A role that is not "owner" can be the tenant’s only way to edit roles — SEC-01, SEC-09', () => {
  it('refuses to withdraw a user from the shop when they are its sole holder of role-editing rights', async () => {
    const shop = await aShopOnRoles();

    // Move `sec.role.edit` onto the manager role, so `owner` is no longer the
    // only role that carries it.
    await openRole(shop, say.format('role.manager'));
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['permission.sec.role.edit'] }),
    );

    await goTo(shop, catalogue['nav.users']);
    await enrolUser(shop, { handle: 'sara', name: 'سارة', password: 'till-morning-1' });
    await shop.person.click(
      within(rowFor('سارة')).getByRole('button', { name: catalogue['users.scope.action'] }),
    );
    await chooseOption(shop, catalogue['users.scope.role'], say.format('role.manager'));
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.scope.assign'] }));
    await screen.findByText(
      say.format('users.scope.assigned', { name: 'سارة', role: say.format('role.manager') }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['action.close'] }));

    // The owner role no longer needs to carry the right itself — the manager
    // role سارة holds now covers the tenant.
    await goTo(shop, catalogue['nav.roles']);
    await openRole(shop, say.format('role.owner'));
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['permission.sec.role.edit'] }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole('switch', { name: catalogue['permission.sec.role.edit'] }),
      ).toHaveProperty('checked', false);
    });

    // سارة is now the tenant's only holder of `sec.role.edit`, through a role
    // named "manager" rather than "owner" — withdrawing her is exactly the
    // lockout `SEC-09` refuses, and the refusal has to notice it by the right
    // she actually holds, not by the name of the role she holds it through.
    await goTo(shop, catalogue['nav.users']);
    await shop.person.click(
      within(rowFor('سارة')).getByRole('button', { name: catalogue['users.withdraw.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['users.withdraw'] }));

    expect(await screen.findByText(say.format('refusal.sec.last-owner', {}))).toBeTruthy();
    expect(rowFor('سارة').textContent).toContain(catalogue['status.inUse']);
  });
});

describe('A withdrawn role — SEC-01', () => {
  it('shows its rights without offering to change them', async () => {
    // `SEC` refuses a grant to a withdrawn role, so a switch there could only
    // ever be refused after somebody pressed it.
    const shop = await aShopOnRoles();
    await defineRole(shop, 'دور مسحوب');
    await shop.person.click(
      within(rowFor('دور مسحوب')).getByRole('button', { name: catalogue['roles.withdraw.title'] }),
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['roles.withdraw'] }));
    await shop.person.click(
      screen.getByRole('switch', { name: catalogue['listing.includeWithdrawn'] }),
    );
    await screen.findByRole('rowheader', { name: 'دور مسحوب' });
    await openRole(shop, 'دور مسحوب');

    const grant = await screen.findByRole('switch', {
      name: nameOfPermission(say, SYS_PERMISSIONS.branch.create),
    });
    expect(grant.hasAttribute('disabled')).toBe(true);
  });
});
