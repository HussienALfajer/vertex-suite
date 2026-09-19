import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import {
  chooseOption,
  enterTheShop,
  goTo,
  PEOPLE,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';
import type { SystemOfRecord } from './system.js';

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

async function aShopOnItsProfile(...companies: readonly string[]): Promise<OpenShop> {
  const shop = await enterTheShop();
  for (const name of companies) await registerCompany(shop, name);
  await goTo(shop, catalogue['nav.businessProfile']);
  await screen.findByLabelText(catalogue['profile.name']);
  return shop;
}

async function retype(shop: OpenShop, label: string, value: string): Promise<void> {
  const field = screen.getByLabelText(label);
  await shop.person.clear(field);
  await shop.person.type(field, value);
}

async function save(shop: OpenShop): Promise<void> {
  await shop.person.click(screen.getByRole('button', { name: catalogue['profile.save'] }));
}

describe('The business profile — SYS-05', () => {
  it('starts from the name the company was registered under', async () => {
    await aShopOnItsProfile('مؤسسة الشام');

    // A receipt printed on the shop's first afternoon has to print something,
    // so the profile exists from the moment the company does and is not a blank
    // form somebody has to find before the first sale.
    expect(screen.getByLabelText<HTMLInputElement>(catalogue['profile.name']).value).toBe(
      'مؤسسة الشام',
    );
  });

  it('stores the name, address, phone, identifiers and receipt lines a document carries', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');

    await retype(shop, catalogue['profile.name'], 'مؤسسة الشام للتجارة العامة');
    await retype(shop, catalogue['profile.address'], 'حلب — الجميلية');
    await retype(shop, catalogue['profile.phone'], '021-2345678');
    await retype(shop, catalogue['profile.receiptFooter'], 'شكرًا لزيارتكم');

    await shop.person.click(screen.getByRole('button', { name: catalogue['profile.tax.add'] }));
    await shop.person.type(screen.getByLabelText(catalogue['profile.tax.key']), 'الرقم الضريبي');
    await shop.person.type(screen.getByLabelText(catalogue['profile.tax.value']), '12345');

    await save(shop);

    const [company] = await shop.system.organisation.companies.list();
    await waitFor(async () => {
      const stored = await shop.system.organisation.profile.read(company!.id);
      expect(stored?.name).toBe('مؤسسة الشام للتجارة العامة');
      expect(stored?.address).toBe('حلب — الجميلية');
      expect(stored?.phone).toBe('021-2345678');
      expect(stored?.receiptFooter).toBe('شكرًا لزيارتكم');
      // Keyed by the name somebody gave it, because which identifiers exist is
      // a question about a country rather than about this system.
      expect(stored?.taxIdentifiers).toEqual({ 'الرقم الضريبي': '12345' });
    });
  });

  it('will not store an identifier that has a value and no name', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');

    await shop.person.click(screen.getByRole('button', { name: catalogue['profile.tax.add'] }));
    await shop.person.type(screen.getByLabelText(catalogue['profile.tax.value']), '12345');
    await save(shop);

    // Storing it under an empty name would lose it silently, which on a tax
    // number is the kind of loss nobody notices until an inspector does.
    expect(await screen.findByText(catalogue['profile.tax.key.required'])).toBeTruthy();

    const [company] = await shop.system.organisation.companies.list();
    const stored = await shop.system.organisation.profile.read(company!.id);
    expect(stored?.taxIdentifiers).toEqual({});
  });

  it('refuses two identifiers under one name', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');

    for (const value of ['1', '2']) {
      await shop.person.click(screen.getByRole('button', { name: catalogue['profile.tax.add'] }));
      const keys = screen.getAllByLabelText(catalogue['profile.tax.key']);
      const values = screen.getAllByLabelText(catalogue['profile.tax.value']);
      await shop.person.type(keys[keys.length - 1]!, 'الرقم الضريبي');
      await shop.person.type(values[values.length - 1]!, value);
    }
    await save(shop);

    expect(await screen.findByText(catalogue['profile.tax.key.duplicate'])).toBeTruthy();
  });

  it('says there are unsaved changes, asks before discarding them, and puts them back on confirmation', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');

    await retype(shop, catalogue['profile.phone'], '021-2345678');
    expect(screen.getByText(catalogue['profile.unsaved'])).toBeTruthy();

    // Nothing here takes effect as it is typed: somebody is copying from a
    // commercial register, and half-copied values reaching a receipt in the
    // meantime is the failure this form exists to prevent.
    await shop.person.click(screen.getByRole('button', { name: catalogue['profile.discard'] }));

    // A confirmation stands between the click and the loss, the same rule
    // every destructive action in this product follows — the typed value is
    // still there until it is actually confirmed.
    expect(screen.getByLabelText<HTMLInputElement>(catalogue['profile.phone']).value).toBe(
      '021-2345678',
    );
    await shop.person.click(screen.getByRole('button', { name: catalogue['action.cancel'] }));
    expect(screen.getByLabelText<HTMLInputElement>(catalogue['profile.phone']).value).toBe(
      '021-2345678',
    );

    await shop.person.click(screen.getByRole('button', { name: catalogue['profile.discard'] }));
    await shop.person.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: catalogue['profile.discard'],
      }),
    );

    expect(screen.getByLabelText<HTMLInputElement>(catalogue['profile.phone']).value).toBe('');
    expect(screen.queryByText(catalogue['profile.unsaved'])).toBeNull();
  });

  it('asks which company only when the tenant trades as more than one', async () => {
    await aShopOnItsProfile('مؤسسة الشام');

    // A chooser with one option is a control that teaches somebody to ignore
    // controls, and the answer is not in doubt.
    expect(screen.queryByText(catalogue['profile.company'])).toBeNull();
  });

  it('keeps each company its own profile, because a document is issued by one of them', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام', 'مخازن حلب');

    await retype(shop, catalogue['profile.name'], 'الاسم الأول');
    await save(shop);

    await chooseOption(shop, catalogue['profile.company'], 'مخازن حلب');
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(catalogue['profile.name']).value).toBe(
        'مخازن حلب',
      );
    });

    // A receipt that printed the wrong legal name and tax number is a document
    // that does not stand up, so the profile belongs to the company and never
    // to the tenant.
    const companies = await shop.system.organisation.companies.list();
    const first = companies.find((one) => one.name === 'مؤسسة الشام');
    expect((await shop.system.organisation.profile.read(first!.id))?.name).toBe('الاسم الأول');
  });

  it('renames the shop in the frame when the legal name is revised', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');

    await retype(shop, catalogue['profile.name'], 'مؤسسة الشام للتجارة العامة');
    await save(shop);

    // `SYS-05` is what a receipt prints and what somebody signed in looks at all
    // day; a frame still showing the old name would be the one place in the
    // product where the shop's name is out of date.
    expect(await screen.findAllByText('مؤسسة الشام للتجارة العامة')).toBeTruthy();
  });
});

describe('The business profile, when the read has not answered — SYS-05', () => {
  it('offers nothing to edit over a profile it could not read, and says so', async () => {
    // It once opened a blank form, took whatever was typed, and saved every
    // field of it: the address, phone, tax numbers and receipt lines of a
    // company whose profile had simply not been reached were stored as blanks.
    const base = developmentSystem({ people: PEOPLE });
    const revised: unknown[] = [];
    let lineDown = false;
    const system: SystemOfRecord = {
      ...base,
      organisation: {
        ...base.organisation,
        profile: {
          ...base.organisation.profile,
          read: (company) =>
            lineDown
              ? Promise.reject(new Error('the store node is unreachable'))
              : base.organisation.profile.read(company),
          revise: (company, changes) => {
            revised.push(changes);
            return base.organisation.profile.revise(company, changes);
          },
        },
      },
    };
    const shop = await enterTheShop(system);
    await registerCompany(shop, 'مؤسسة الشام');
    lineDown = true;
    await goTo(shop, catalogue['nav.businessProfile']);

    expect(await screen.findByText(catalogue['data.unreachable'])).toBeTruthy();
    expect(screen.queryByLabelText(catalogue['profile.name'])).toBeNull();
    expect(
      screen.getByRole('button', { name: catalogue['profile.save'] }).hasAttribute('disabled'),
    ).toBe(true);
    expect(revised).toEqual([]);
  });

  it('sends only what was changed, so a field somebody else corrected stays corrected', async () => {
    const base = developmentSystem({ people: PEOPLE });
    const revised: unknown[] = [];
    const system: SystemOfRecord = {
      ...base,
      organisation: {
        ...base.organisation,
        profile: {
          ...base.organisation.profile,
          revise: (company, changes) => {
            revised.push(changes);
            return base.organisation.profile.revise(company, changes);
          },
        },
      },
    };
    const shop = await enterTheShop(system);
    await registerCompany(shop, 'مؤسسة الشام');
    await goTo(shop, catalogue['nav.businessProfile']);
    await screen.findByLabelText(catalogue['profile.name']);

    await retype(shop, catalogue['profile.phone'], '021-2345678');
    await save(shop);

    await waitFor(() => {
      expect(revised).toEqual([{ phone: '021-2345678' }]);
    });
  });

  it('saves on Enter, like every other form', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');
    await retype(shop, catalogue['profile.phone'], '021-2345678');
    await shop.person.keyboard('{Enter}');

    const [company] = await shop.system.organisation.companies.list();
    await waitFor(async () => {
      expect((await shop.system.organisation.profile.read(company!.id))?.phone).toBe('021-2345678');
    });
  });
});

describe('Leaving a profile with an edit nobody saved — SYS-05', () => {
  async function anEditedProfile(): Promise<OpenShop> {
    const shop = await aShopOnItsProfile('مؤسسة الشام');
    await retype(shop, catalogue['profile.phone'], '021-2345678');
    await goTo(shop, catalogue['nav.branches']);
    return shop;
  }

  it('asks before a link carries an unsaved edit away, and stays when told to', async () => {
    const shop = await anEditedProfile();

    const question = await screen.findByRole('alertdialog', {
      name: catalogue['navigation.unsaved.title'],
    });
    await shop.person.click(
      within(question).getByRole('button', { name: catalogue['action.cancel'] }),
    );

    // Nowhere else, and nothing lost: the edit is exactly as it was typed.
    expect(globalThis.location.pathname).toBe('/business-profile');
    expect(screen.getByLabelText<HTMLInputElement>(catalogue['profile.phone']).value).toBe(
      '021-2345678',
    );
  });

  it('leaves without the edit when that is the answer', async () => {
    const shop = await anEditedProfile();

    const question = await screen.findByRole('alertdialog');
    await shop.person.click(
      within(question).getByRole('button', { name: catalogue['navigation.unsaved.discard'] }),
    );

    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/branches');
    });
    const [company] = await shop.system.organisation.companies.list();
    const stored = await shop.system.organisation.profile.read(company!.id);
    expect(stored?.phone).toBe('');
  });

  it('saves and then leaves, when that is the answer', async () => {
    const shop = await anEditedProfile();

    const question = await screen.findByRole('alertdialog');
    await shop.person.click(
      within(question).getByRole('button', { name: catalogue['navigation.unsaved.save'] }),
    );

    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/branches');
    });
    const [company] = await shop.system.organisation.companies.list();
    const stored = await shop.system.organisation.profile.read(company!.id);
    expect(stored?.phone).toBe('021-2345678');
  });

  it('stays, with the reason on screen, when the save it was asked for is refused', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');
    // An identifier with a value and no name is refused before it is sent.
    await shop.person.click(screen.getByRole('button', { name: catalogue['profile.tax.add'] }));
    await shop.person.type(screen.getByLabelText(catalogue['profile.tax.value']), '12345');
    await goTo(shop, catalogue['nav.branches']);

    const question = await screen.findByRole('alertdialog');
    await shop.person.click(
      within(question).getByRole('button', { name: catalogue['navigation.unsaved.save'] }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(globalThis.location.pathname).toBe('/business-profile');
  });

  it('lets a profile nobody edited be left without a word', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');

    await goTo(shop, catalogue['nav.branches']);

    await waitFor(() => {
      expect(globalThis.location.pathname).toBe('/branches');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
