import type { CompanyId, TenantId } from '@vertex/contracts';
import { ok, refuse, type Result } from '@vertex/kernel';

import type { BusinessProfile, Company, OrganisationRefusal, ProfileRevision } from './contract.js';
import { readRecord, writeRecord, type RecordSession } from './records.js';

/**
 * The business profile of `SYS-05`.
 *
 * It is created blank the moment a company is registered rather than when
 * somebody first edits it. A receipt printed on the shop's first afternoon has
 * to print something, and "no profile yet" is a null that every caller would
 * have to remember to handle — on the receipt, on the screen header, on every
 * document `SYS-06` will later design. One absent-shaped case, handled here
 * once, instead of one in each of them.
 */
export function profileIn(
  session: RecordSession,
  tenant: TenantId,
  company: CompanyId,
): BusinessProfile | null {
  return readRecord(session, 'profile', tenant, [company]);
}

function merged(profile: BusinessProfile, changes: ProfileRevision): BusinessProfile {
  // Field by field, because an administrator revising a phone number has said
  // nothing about the address, and spreading the whole shape would let an
  // absent field overwrite one somebody else had filled in.
  //
  // Absent and nullish are treated alike for the text fields, deliberately.
  // A revision arrives from outside — a screen, an import, a request body —
  // where an unset field is as likely to be `null` as it is to be missing, and
  // neither is an instruction to blank the shop's address. Clearing a field is
  // said by passing an empty string, which is a thing somebody typed.
  //
  // `logo` is the exception and has to be, because it has no empty value: it is
  // a reference or it is nothing. So there, absent means "leave it" and null
  // means "remove it", and the two are different instructions.
  return {
    tenant: profile.tenant,
    company: profile.company,
    name: changes.name ?? profile.name,
    logo: 'logo' in changes ? (changes.logo ?? null) : profile.logo,
    address: changes.address ?? profile.address,
    phone: changes.phone ?? profile.phone,
    taxIdentifiers:
      changes.taxIdentifiers === undefined
        ? profile.taxIdentifiers
        : Object.freeze({ ...changes.taxIdentifiers }),
    receiptHeader: changes.receiptHeader ?? profile.receiptHeader,
    receiptFooter: changes.receiptFooter ?? profile.receiptFooter,
  };
}

/** The blank one a company starts with: its own name, and room for the rest. */
export function seedProfile(
  session: RecordSession,
  company: Company,
  changes: ProfileRevision | undefined,
): BusinessProfile {
  const blank: BusinessProfile = {
    tenant: company.tenant,
    company: company.id,
    name: company.name,
    logo: null,
    address: '',
    phone: '',
    taxIdentifiers: Object.freeze({}),
    receiptHeader: '',
    receiptFooter: '',
  };
  const profile = changes === undefined ? blank : merged(blank, changes);
  return writeRecord(session, 'profile', company.tenant, [company.id], profile);
}

export function reviseProfile(
  session: RecordSession,
  tenant: TenantId,
  company: CompanyId,
  changes: ProfileRevision,
): Result<BusinessProfile, OrganisationRefusal> {
  const profile = profileIn(session, tenant, company);
  // Missing here means the company is not this tenant's, since every company
  // this tenant registered was given one. The refusal says company rather than
  // profile, because that is the thing the administrator got wrong.
  if (profile === null) return refuse('sys.company-not-found', { company });

  return ok(writeRecord(session, 'profile', tenant, [company], merged(profile, changes)));
}
