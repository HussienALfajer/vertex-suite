import type { BranchId, CompanyId, LocationId, RegisterId, TenantId } from '@vertex/contracts';
import { newId, ok, refuse, type Result } from '@vertex/kernel';

import type {
  Branch,
  Company,
  Listing,
  Location,
  NewBranch,
  NewLocation,
  NewRegister,
  OrganisationRefusal,
  Register,
} from './contract.js';
import { readRecord, scanRecords, writeRecord, type RecordSession } from './records.js';

/**
 * Companies, branches, stock locations and registers: `SYS-09`.
 *
 * Every function here takes the session of a transaction already open and does
 * its checking **before** its writing. That order is not a style: a refusal is a
 * returned value rather than a thrown one, so the transaction it was refused in
 * still commits, and a command that had already written something would leave
 * it behind. Checks first, writes last, and a refusal costs nothing.
 *
 * Deactivation does not cascade, and that is a decision. Withdrawing a branch
 * could plausibly withdraw its tills with it — but putting the branch back
 * would then have to guess which of them had already been withdrawn beforehand,
 * and a wrong guess quietly re-opens a till nobody meant to re-open. So each
 * entity carries its own state, and a reader that cares whether a location is
 * usable asks about its branch as well.
 */

type Outcome<T> = Result<T, OrganisationRefusal>;

/**
 * A register's prefix is alphanumeric and nothing else.
 *
 * `SYS-02` gives the number a configurable format, which means any punctuation
 * is a candidate separator. Punctuation inside a part would make a printed
 * number ambiguous to read back, and a number is read back by a person holding
 * a receipt at a counter.
 */
const PREFIX = /^[A-Za-z0-9]{1,8}$/;

function named(value: string): string | null {
  const name = value.trim();
  return name === '' ? null : name;
}

function visible<T extends { readonly active: boolean }>(
  records: readonly T[],
  listing: Listing | undefined,
): readonly T[] {
  return listing?.including === 'all' ? records : records.filter((one) => one.active);
}

export function companyIn(session: RecordSession, tenant: TenantId, id: CompanyId): Company | null {
  return readRecord(session, 'company', tenant, [id]);
}

export function branchIn(session: RecordSession, tenant: TenantId, id: BranchId): Branch | null {
  return readRecord(session, 'branch', tenant, [id]);
}

export function locationIn(
  session: RecordSession,
  tenant: TenantId,
  id: LocationId,
): Location | null {
  return readRecord(session, 'location', tenant, [id]);
}

export function registerIn(
  session: RecordSession,
  tenant: TenantId,
  id: RegisterId,
): Register | null {
  return readRecord(session, 'register', tenant, [id]);
}

export function companiesIn(
  session: RecordSession,
  tenant: TenantId,
  listing?: Listing,
): readonly Company[] {
  return visible(scanRecords(session, 'company', tenant), listing);
}

export function branchesIn(
  session: RecordSession,
  tenant: TenantId,
  listing?: Listing,
): readonly Branch[] {
  return visible(scanRecords(session, 'branch', tenant), listing);
}

export function locationsIn(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  listing?: Listing,
): readonly Location[] {
  const all = scanRecords(session, 'location', tenant).filter((one) => one.branch === branch);
  return visible(all, listing);
}

export function registersIn(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  listing?: Listing,
): readonly Register[] {
  const all = scanRecords(session, 'register', tenant).filter((one) => one.branch === branch);
  return visible(all, listing);
}

export function registerCompany(
  session: RecordSession,
  tenant: TenantId,
  name: string,
): Outcome<Company> {
  const trimmed = named(name);
  if (trimmed === null) return refuse('sys.name-required', { of: 'company' });

  const company: Company = {
    id: newId<'company'>(),
    tenant,
    name: trimmed,
    active: true,
  };
  return ok(writeRecord(session, 'company', tenant, [company.id], company));
}

export function openBranch(
  session: RecordSession,
  tenant: TenantId,
  input: NewBranch,
): Outcome<Branch> {
  const trimmed = named(input.name);
  if (trimmed === null) return refuse('sys.name-required', { of: 'branch' });

  const company = companyIn(session, tenant, input.company);
  if (company === null) return refuse('sys.company-not-found', { company: input.company });
  if (!company.active) return refuse('sys.company-inactive', { company: company.name });

  const branch: Branch = {
    id: newId<'branch'>(),
    tenant,
    company: company.id,
    name: trimmed,
    active: true,
  };
  return ok(writeRecord(session, 'branch', tenant, [branch.id], branch));
}

export function openLocation(
  session: RecordSession,
  tenant: TenantId,
  input: NewLocation,
): Outcome<Location> {
  const trimmed = named(input.name);
  if (trimmed === null) return refuse('sys.name-required', { of: 'location' });

  const branch = branchIn(session, tenant, input.branch);
  if (branch === null) return refuse('sys.branch-not-found', { branch: input.branch });
  if (!branch.active) return refuse('sys.branch-inactive', { branch: branch.name });

  const location: Location = {
    id: newId<'location'>(),
    tenant,
    branch: branch.id,
    name: trimmed,
    kind: input.kind,
    active: true,
  };
  return ok(writeRecord(session, 'location', tenant, [location.id], location));
}

export function openRegister(
  session: RecordSession,
  tenant: TenantId,
  input: NewRegister,
): Outcome<Register> {
  const trimmed = named(input.name);
  if (trimmed === null) return refuse('sys.name-required', { of: 'register' });
  if (!PREFIX.test(input.prefix)) {
    return refuse('sys.register-prefix-invalid', { prefix: input.prefix });
  }

  const branch = branchIn(session, tenant, input.branch);
  if (branch === null) return refuse('sys.branch-not-found', { branch: input.branch });
  if (!branch.active) return refuse('sys.branch-inactive', { branch: branch.name });

  // Unique across the tenant rather than within the branch. The number format
  // of `SYS-02` is configurable and need not carry the branch, so a prefix
  // unique only within one is a collision waiting for somebody to change the
  // format — and the collision surfaces as two sales filed under one number.
  const wanted = input.prefix.toUpperCase();
  const taken = scanRecords(session, 'register', tenant).some(
    (one) => one.prefix.toUpperCase() === wanted,
  );
  if (taken) return refuse('sys.register-prefix-taken', { prefix: input.prefix });

  const register: Register = {
    id: newId<'register'>(),
    tenant,
    branch: branch.id,
    name: trimmed,
    prefix: input.prefix,
    active: true,
  };
  return ok(writeRecord(session, 'register', tenant, [register.id], register));
}

export function renameCompany(
  session: RecordSession,
  tenant: TenantId,
  id: CompanyId,
  name: string,
): Outcome<Company> {
  const trimmed = named(name);
  if (trimmed === null) return refuse('sys.name-required', { of: 'company' });
  const company = companyIn(session, tenant, id);
  if (company === null) return refuse('sys.company-not-found', { company: id });
  return ok(writeRecord(session, 'company', tenant, [id], { ...company, name: trimmed }));
}

export function renameBranch(
  session: RecordSession,
  tenant: TenantId,
  id: BranchId,
  name: string,
): Outcome<Branch> {
  const trimmed = named(name);
  if (trimmed === null) return refuse('sys.name-required', { of: 'branch' });
  const branch = branchIn(session, tenant, id);
  if (branch === null) return refuse('sys.branch-not-found', { branch: id });
  return ok(writeRecord(session, 'branch', tenant, [id], { ...branch, name: trimmed }));
}

export function renameLocation(
  session: RecordSession,
  tenant: TenantId,
  id: LocationId,
  name: string,
): Outcome<Location> {
  const trimmed = named(name);
  if (trimmed === null) return refuse('sys.name-required', { of: 'location' });
  const location = locationIn(session, tenant, id);
  if (location === null) return refuse('sys.location-not-found', { location: id });
  return ok(writeRecord(session, 'location', tenant, [id], { ...location, name: trimmed }));
}

export function renameRegister(
  session: RecordSession,
  tenant: TenantId,
  id: RegisterId,
  name: string,
): Outcome<Register> {
  const trimmed = named(name);
  if (trimmed === null) return refuse('sys.name-required', { of: 'register' });
  const register = registerIn(session, tenant, id);
  if (register === null) return refuse('sys.register-not-found', { register: id });
  return ok(writeRecord(session, 'register', tenant, [id], { ...register, name: trimmed }));
}

/**
 * Setting the activation state is idempotent, on purpose.
 *
 * `SYN-02` replays a command that may already have been applied — a register
 * that lost its connection halfway through sending one sends it again. A second
 * deactivation that refused would turn a sync that worked into a sync that
 * failed, over a state that is already exactly what was asked for.
 */
export function setCompanyActive(
  session: RecordSession,
  tenant: TenantId,
  id: CompanyId,
  active: boolean,
): Outcome<Company> {
  const company = companyIn(session, tenant, id);
  if (company === null) return refuse('sys.company-not-found', { company: id });
  if (company.active === active) return ok(company);
  return ok(writeRecord(session, 'company', tenant, [id], { ...company, active }));
}

export function setBranchActive(
  session: RecordSession,
  tenant: TenantId,
  id: BranchId,
  active: boolean,
): Outcome<Branch> {
  const branch = branchIn(session, tenant, id);
  if (branch === null) return refuse('sys.branch-not-found', { branch: id });
  if (branch.active === active) return ok(branch);
  if (active) {
    const company = companyIn(session, tenant, branch.company);
    if (company !== null && !company.active) {
      return refuse('sys.company-inactive', { company: company.name });
    }
  }
  return ok(writeRecord(session, 'branch', tenant, [id], { ...branch, active }));
}

export function setLocationActive(
  session: RecordSession,
  tenant: TenantId,
  id: LocationId,
  active: boolean,
): Outcome<Location> {
  const location = locationIn(session, tenant, id);
  if (location === null) return refuse('sys.location-not-found', { location: id });
  if (location.active === active) return ok(location);
  if (active) {
    const branch = branchIn(session, tenant, location.branch);
    if (branch !== null && !branch.active) {
      return refuse('sys.branch-inactive', { branch: branch.name });
    }
  }
  return ok(writeRecord(session, 'location', tenant, [id], { ...location, active }));
}

export function setRegisterActive(
  session: RecordSession,
  tenant: TenantId,
  id: RegisterId,
  active: boolean,
): Outcome<Register> {
  const register = registerIn(session, tenant, id);
  if (register === null) return refuse('sys.register-not-found', { register: id });
  if (register.active === active) return ok(register);
  if (active) {
    const branch = branchIn(session, tenant, register.branch);
    if (branch !== null && !branch.active) {
      return refuse('sys.branch-inactive', { branch: branch.name });
    }
  }
  return ok(writeRecord(session, 'register', tenant, [id], { ...register, active }));
}
