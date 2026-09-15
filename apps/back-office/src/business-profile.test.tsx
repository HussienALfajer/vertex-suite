import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogue } from './catalogue.js';
import {
  chooseOption,
  enterTheShop,
  goTo,
  registerCompany,
  startAt,
  type OpenShop,
} from './screens.fixture.js';

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

  it('says there are unsaved changes, and puts them back on request', async () => {
    const shop = await aShopOnItsProfile('مؤسسة الشام');

    await retype(shop, catalogue['profile.phone'], '021-2345678');
    expect(screen.getByText(catalogue['profile.unsaved'])).toBeTruthy();

    // Nothing here takes effect as it is typed: somebody is copying from a
    // commercial register, and half-copied values reaching a receipt in the
    // meantime is the failure this form exists to prevent.
    await shop.person.click(screen.getByRole('button', { name: catalogue['profile.discard'] }));

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
