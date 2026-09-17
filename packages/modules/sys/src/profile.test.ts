import { orThrow, type Refusal, type Result } from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import type { BusinessProfile, Company } from './contract.js';
import { installSys, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  return orThrow(result, (refusal) => new Error(`refused: ${refusal.code}`));
}

let sys: Installed;

beforeEach(() => {
  sys = installSys();
});

const AL_SHAM = {
  name: 'Al Sham Trading Co.',
  logo: 'asset:logo-al-sham',
  address: 'Aleppo, Syria',
  phone: '+963 21 000 0000',
  taxIdentifiers: { vat: 'SY-VAT-118', commercialRegister: 'CR-2291' },
  receiptHeader: 'Al Sham Trading',
  receiptFooter: 'Goods sold are returnable within 14 days.',
} as const;

async function withProfile(): Promise<{ company: Company; profile: BusinessProfile }> {
  const company = taken(
    await sys.admin.companies.register(sys.by, { name: AL_SHAM.name, profile: AL_SHAM }),
  );
  const profile = await sys.read.profile(sys.by, company.id);
  if (profile === null) throw new Error('A registered company has a profile.');
  return { company, profile };
}

describe('Business profile — SYS-05', () => {
  it('carries every field a screen or a printed document needs', async () => {
    const { company, profile } = await withProfile();

    expect(profile).toEqual({
      tenant: sys.tenant,
      company: company.id,
      name: AL_SHAM.name,
      logo: AL_SHAM.logo,
      address: AL_SHAM.address,
      phone: AL_SHAM.phone,
      taxIdentifiers: { vat: 'SY-VAT-118', commercialRegister: 'CR-2291' },
      receiptHeader: AL_SHAM.receiptHeader,
      receiptFooter: AL_SHAM.receiptFooter,
    });
  });

  it('starts blank rather than absent, so a receipt always has something to print', async () => {
    const company = taken(await sys.admin.companies.register(sys.by, { name: 'Second Co.' }));
    const profile = await sys.read.profile(sys.by, company.id);

    expect(profile?.name).toBe('Second Co.');
    expect(profile?.logo).toBeNull();
    expect(profile?.taxIdentifiers).toEqual({});
  });

  it('belongs to the company, so two companies in one tenant print different receipts', async () => {
    const { company: first } = await withProfile();
    const second = taken(
      await sys.admin.companies.register(sys.by, {
        name: 'Orontes Foods',
        profile: { receiptFooter: 'Thank you.' },
      }),
    );

    expect((await sys.read.profile(sys.by, first.id))?.receiptFooter).toBe(AL_SHAM.receiptFooter);
    expect((await sys.read.profile(sys.by, second.id))?.receiptFooter).toBe('Thank you.');
  });

  it('revises only what the administrator named, and leaves the rest standing', async () => {
    const { company } = await withProfile();

    const revised = taken(
      await sys.admin.profile.revise(sys.by, company.id, { phone: '+963 21 111 1111' }),
    );

    expect(revised.phone).toBe('+963 21 111 1111');
    expect(revised.address).toBe(AL_SHAM.address);
    expect(revised.taxIdentifiers).toEqual(AL_SHAM.taxIdentifiers);
    expect(revised.logo).toBe(AL_SHAM.logo);
  });

  it('lets the logo be removed, which is not the same as leaving it alone', async () => {
    const { company } = await withProfile();

    expect(
      taken(await sys.admin.profile.revise(sys.by, company.id, { logo: null })).logo,
    ).toBeNull();
    expect(taken(await sys.admin.profile.revise(sys.by, company.id, {})).logo).toBeNull();
  });

  it('refuses a profile belonging to a company in another tenant', async () => {
    const { company } = await withProfile();

    expect(await sys.read.profile(sys.byOther, company.id)).toBeNull();
    const refused = await sys.admin.profile.revise(sys.byOther, company.id, { phone: '0' });
    expect(refused.ok ? null : refused.error.code).toBe('sys.company-not-found');
  });

  it('refuses to blank the name printed on every receipt', async () => {
    const { company } = await withProfile();
    const refused = await sys.admin.profile.revise(sys.by, company.id, { name: '   ' });
    expect(refused.ok ? null : refused.error.code).toBe('sys.name-required');
    expect((await sys.read.profile(sys.by, company.id))?.name).not.toBe('   ');
  });
});
