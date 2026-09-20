import type {
  BranchId,
  CompanyId,
  DeviceId,
  LocationId,
  RegisterId,
  TenantId,
} from '@vertex/contracts';
import {
  isErr,
  isId,
  newId,
  ok,
  parseId,
  refuse,
  timeZoneNamed,
  type Result,
} from '@vertex/kernel';

import {
  DEFAULT_TIME_ZONE,
  LOCATION_KINDS,
  type Branch,
  type Company,
  type GeoPoint,
  type Listing,
  type Location,
  type LocationKind,
  type NewBranch,
  type NewLocation,
  type NewRegister,
  type OrganisationRefusal,
  type RecordSession,
  type Register,
} from './contract.js';
import { normalisePoint, writtenAddress } from './place.js';
import { readRecord, scanRecords, writeRecord } from './records.js';

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

/**
 * A point as it will be stored, or the refusal that stops the write.
 *
 * Absent and `null` both mean unplaced, and they arrive from different
 * directions: `undefined` is an administrator who did not say, `null` is one
 * who said "not here any more". Nothing downstream distinguishes them, so
 * neither does the record.
 */
function placeFrom(point: GeoPoint | null | undefined): Outcome<GeoPoint | null> {
  return point === undefined || point === null ? ok(null) : normalisePoint(point);
}

/**
 * A time zone as it will be stored — the runtime's canonical spelling — or the
 * refusal that stops the write.
 *
 * Canonical so that one zone typed two ways is one zone: a report grouping
 * branches by the day they trade on would otherwise see two.
 */
function zoneFrom(timeZone: string): Outcome<string> {
  const named = timeZoneNamed(timeZone);
  // Echoed as text whatever arrived: the refusal is read by a person, and a
  // value that came off a wire as something other than a string is exactly the
  // thing to show them.
  return named === null
    ? refuse('sys.time-zone-unknown', { timeZone: String(timeZone as unknown) })
    : ok(named);
}

/**
 * Whether this kind of location may be given the point offered.
 *
 * Only when one is actually offered. Clearing a point a van does not have is a
 * no-op rather than a mistake, and `SYN-02` replays commands — so a command
 * that refused its own second application would turn a sync into a failure.
 */
function mayHoldPoint(kind: LocationKind, point: GeoPoint | null): boolean {
  return point === null || kind !== 'vehicle';
}

/**
 * A refusal when the branch's company has been withdrawn from use.
 *
 * Opening a branch under a withdrawn company was refused and restoring one was
 * too, but a location or a till could still be opened below a live branch of a
 * withdrawn company — so the entity that issues the documents was withdrawn and
 * its shops went on growing.
 */
function companyWithdrawn(
  session: RecordSession,
  tenant: TenantId,
  branch: Branch,
): Result<never, OrganisationRefusal> | null {
  const company = companyIn(session, tenant, branch.company);
  if (company === null) return refuse('sys.company-not-found', { company: branch.company });
  return company.active ? null : refuse('sys.company-inactive', { company: company.name });
}

function named(value: string): string | null {
  const name = value.trim();
  return name === '' ? null : name;
}

/**
 * Two names are the same name when the person reading the list cannot tell them
 * apart.
 *
 * Composed and folded the way `SEC` folds a sign-in handle, and for the same
 * reason: Arabic is written with combining marks that two keyboards encode
 * differently, so two entries that look identical on screen can differ byte for
 * byte. A branch picker showing "الفرع الرئيسي" twice is a stock transfer sent
 * to the wrong shop, and the mistake is made when the list is read rather than
 * when the name is typed.
 */
function sameName(one: string, two: string): boolean {
  return foldedName(one) === foldedName(two);
}

/**
 * A name as the eye reads it.
 *
 * Composition and case were folded, and that was not what the eye cannot see.
 * A trailing right-to-left mark or a zero-width joiner — which Arabic keyboards
 * and pasted text carry all the time — a tatweel stretching a letter, and a
 * doubled or non-breaking space each left two identical-looking names distinct.
 * Folded for the comparison only: the stored name is the one somebody typed.
 */
function foldedName(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\p{Cf}\u0640]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Whether a name is already in use among the things it has to be told apart
 * from.
 *
 * **Against what is in use, not against what ever existed.** A shop that closed
 * keeps its name in every document it ever issued, and refusing to reuse it
 * years later would be this module deciding that a name is spent — which is not
 * `SYS-09`'s rule about deactivation, only a side effect of it. What matters is
 * that no two live entities in one list carry one name.
 *
 * `except` is the entity being renamed: renaming something to the name it
 * already has is not a collision with itself, and `SYN-02` replays commands, so
 * it has to stay a thing that can happen twice.
 */
function nameTaken<T extends { readonly name: string; readonly active: boolean }>(
  siblings: readonly T[],
  name: string,
  except: (one: T) => boolean = () => false,
): boolean {
  return siblings.some((one) => one.active && !except(one) && sameName(one.name, name));
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
  if (nameTaken(scanRecords(session, 'company', tenant), trimmed)) {
    return refuse('sys.name-taken', { of: 'company', name: trimmed });
  }

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

  // Within the company rather than the tenant: a group that holds two companies
  // may well run a "الفرع الرئيسي" in each, and they are never listed together.
  const siblings = scanRecords(session, 'branch', tenant).filter(
    (one) => one.company === company.id,
  );
  if (nameTaken(siblings, trimmed)) {
    return refuse('sys.name-taken', { of: 'branch', name: trimmed });
  }

  const placed = placeFrom(input.point);
  if (isErr(placed)) return placed;

  const zoned = zoneFrom(input.timeZone ?? DEFAULT_TIME_ZONE);
  if (isErr(zoned)) return zoned;

  const branch: Branch = {
    id: newId<'branch'>(),
    tenant,
    company: company.id,
    name: trimmed,
    address: writtenAddress(input.address ?? ''),
    point: placed.value,
    timeZone: zoned.value,
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

  // A kind is a closed list and it arrives from outside, where the type does not
  // reach: an unknown one was stored, and a van spelled differently got round
  // the rule that a van has no fixed place.
  if (!(LOCATION_KINDS as readonly string[]).includes(input.kind)) {
    return refuse('sys.location-kind-unknown', { kind: input.kind });
  }

  const branch = branchIn(session, tenant, input.branch);
  if (branch === null) return refuse('sys.branch-not-found', { branch: input.branch });
  if (!branch.active) return refuse('sys.branch-inactive', { branch: branch.name });
  const inactiveCompany = companyWithdrawn(session, tenant, branch);
  if (inactiveCompany !== null) return inactiveCompany;

  if (nameTaken(locationsIn(session, tenant, branch.id, { including: 'all' }), trimmed)) {
    return refuse('sys.name-taken', { of: 'location', name: trimmed });
  }

  const placed = placeFrom(input.point);
  if (isErr(placed)) return placed;
  if (!mayHoldPoint(input.kind, placed.value)) {
    return refuse('sys.location-kind-has-no-place', { of: 'location', name: trimmed });
  }

  const location: Location = {
    id: newId<'location'>(),
    tenant,
    branch: branch.id,
    name: trimmed,
    kind: input.kind,
    address: writtenAddress(input.address ?? ''),
    point: placed.value,
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
  const inactiveCompany = companyWithdrawn(session, tenant, branch);
  if (inactiveCompany !== null) return inactiveCompany;

  // Unique across the tenant rather than within the branch. The number format
  // of `SYS-02` is configurable and need not carry the branch, so a prefix
  // unique only within one is a collision waiting for somebody to change the
  // format — and the collision surfaces as two sales filed under one number.
  const wanted = input.prefix.toUpperCase();
  const taken = scanRecords(session, 'register', tenant).some(
    (one) => one.prefix.toUpperCase() === wanted,
  );
  if (taken) return refuse('sys.register-prefix-taken', { prefix: input.prefix });

  if (nameTaken(registersIn(session, tenant, branch.id, { including: 'all' }), trimmed)) {
    return refuse('sys.name-taken', { of: 'register', name: trimmed });
  }

  const register: Register = {
    id: newId<'register'>(),
    tenant,
    branch: branch.id,
    name: trimmed,
    prefix: input.prefix,
    active: true,
    // Opened, and nothing standing at it yet. It cannot issue a document until
    // a machine is named, because `SYS-02`'s number has to say which one.
    generation: 0,
    heldBy: null,
  };
  return ok(writeRecord(session, 'register', tenant, [register.id], register));
}

/**
 * Says which machine is standing at this till.
 *
 * A different machine than the one before raises the generation, and that is
 * the whole of `SYS-02`'s guarantee — every number either machine printed
 * carries the generation it was printed under, so the replacement cannot
 * reissue one the machine it replaced had printed but not yet sent.
 *
 * Naming the same machine again changes nothing. A register that reconnects, or
 * a command `SYN-02` replays, must not spend a generation: a spent one is not
 * recoverable, and the count is what a whole run of documents is filed under.
 */
export function assignDevice(
  session: RecordSession,
  tenant: TenantId,
  id: RegisterId,
  device: DeviceId,
): Outcome<Register> {
  const register = registerIn(session, tenant, id);
  if (register === null) return refuse('sys.register-not-found', { register: id });
  if (!register.active) return refuse('sys.register-inactive', { register: register.name });

  // The brand on `DeviceId` is a compile-time claim and nothing at all at run
  // time, and this value always arrives from outside the process: typed by an
  // administrator pairing a till, or carried in a command `SYN-02` replayed.
  // Storing whatever was handed over would be storing a machine's identity that
  // the machine itself will never report — so every reconnection would look
  // like a different machine and spend another generation, and a generation is
  // not recoverable.
  if (!isId(device)) return refuse('sys.device-identifier-invalid', { device });
  // Cannot throw behind `isId`. It is here for the normalisation: a UUID is
  // case-insensitive by specification, and one machine written two ways would
  // otherwise be two machines.
  const machine = parseId<'device'>(device);
  if (register.heldBy === machine) return ok(register);

  return ok(
    writeRecord(session, 'register', tenant, [id], {
      ...register,
      heldBy: machine,
      generation: register.generation + 1,
    }),
  );
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
  if (nameTaken(scanRecords(session, 'company', tenant), trimmed, (one) => one.id === id)) {
    return refuse('sys.name-taken', { of: 'company', name: trimmed });
  }
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
  const siblings = scanRecords(session, 'branch', tenant).filter(
    (one) => one.company === branch.company,
  );
  if (nameTaken(siblings, trimmed, (one) => one.id === id)) {
    return refuse('sys.name-taken', { of: 'branch', name: trimmed });
  }
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
  const siblings = locationsIn(session, tenant, location.branch, { including: 'all' });
  if (nameTaken(siblings, trimmed, (one) => one.id === id)) {
    return refuse('sys.name-taken', { of: 'location', name: trimmed });
  }
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
  const siblings = registersIn(session, tenant, register.branch, { including: 'all' });
  if (nameTaken(siblings, trimmed, (one) => one.id === id)) {
    return refuse('sys.name-taken', { of: 'register', name: trimmed });
  }
  return ok(writeRecord(session, 'register', tenant, [id], { ...register, name: trimmed }));
}

/**
 * Where a branch is, in words (`SYS-14`).
 *
 * There is no refusal for an empty address and there should not be: clearing
 * one is how a shop that moved says it no longer knows, and an administrator
 * who has to type something untrue to get past a form types something untrue.
 */
export function readdressBranch(
  session: RecordSession,
  tenant: TenantId,
  id: BranchId,
  address: string,
): Outcome<Branch> {
  const branch = branchIn(session, tenant, id);
  if (branch === null) return refuse('sys.branch-not-found', { branch: id });
  return ok(
    writeRecord(session, 'branch', tenant, [id], { ...branch, address: writtenAddress(address) }),
  );
}

/**
 * Where a branch is, on the map (`SYS-14`).
 *
 * A withdrawn branch may still be placed, and a withdrawn one keeps the point
 * it had. `SYS-09` deactivates rather than deletes precisely so that the
 * documents that name it stay readable, and a shop that closed is still a shop
 * that was somewhere — a report of last year's sales by branch is a report
 * about places, and wiping the place would make it a report about names.
 */
export function locateBranch(
  session: RecordSession,
  tenant: TenantId,
  id: BranchId,
  point: GeoPoint | null,
): Outcome<Branch> {
  const branch = branchIn(session, tenant, id);
  if (branch === null) return refuse('sys.branch-not-found', { branch: id });
  const placed = placeFrom(point);
  if (isErr(placed)) return placed;
  return ok(writeRecord(session, 'branch', tenant, [id], { ...branch, point: placed.value }));
}

/**
 * Which time zone a branch trades in, from now on.
 *
 * A withdrawn branch may be rezoned, for the reason it may be readdressed: the
 * record outlives its trading, and a branch whose zone was wrong while it
 * traded is one whose history is read against the wrong days until somebody
 * corrects it.
 */
export function rezoneBranch(
  session: RecordSession,
  tenant: TenantId,
  id: BranchId,
  timeZone: string,
): Outcome<Branch> {
  const branch = branchIn(session, tenant, id);
  if (branch === null) return refuse('sys.branch-not-found', { branch: id });
  const zoned = zoneFrom(timeZone);
  if (isErr(zoned)) return zoned;
  return ok(writeRecord(session, 'branch', tenant, [id], { ...branch, timeZone: zoned.value }));
}

export function readdressLocation(
  session: RecordSession,
  tenant: TenantId,
  id: LocationId,
  address: string,
): Outcome<Location> {
  const location = locationIn(session, tenant, id);
  if (location === null) return refuse('sys.location-not-found', { location: id });
  return ok(
    writeRecord(session, 'location', tenant, [id], {
      ...location,
      address: writtenAddress(address),
    }),
  );
}

/**
 * Where a stock location is, when it is not simply at its branch (`SYS-14`).
 *
 * `null` puts it back at the branch rather than marking it unknown, which is
 * the state almost every location is in: a shop floor and the store room behind
 * it share a doorstep, and only the warehouse across town needs its own.
 */
export function locateLocation(
  session: RecordSession,
  tenant: TenantId,
  id: LocationId,
  point: GeoPoint | null,
): Outcome<Location> {
  const location = locationIn(session, tenant, id);
  if (location === null) return refuse('sys.location-not-found', { location: id });
  const placed = placeFrom(point);
  if (isErr(placed)) return placed;
  if (!mayHoldPoint(location.kind, placed.value)) {
    return refuse('sys.location-kind-has-no-place', { of: 'location', name: location.name });
  }
  return ok(writeRecord(session, 'location', tenant, [id], { ...location, point: placed.value }));
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
  // Coming back is where a name can collide without anybody typing one: the
  // name was free while this was closed, and somebody used it.
  if (
    active &&
    nameTaken(scanRecords(session, 'company', tenant), company.name, (one) => one.id === id)
  ) {
    return refuse('sys.name-taken', { of: 'company', name: company.name });
  }
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
    const siblings = scanRecords(session, 'branch', tenant).filter(
      (one) => one.company === branch.company,
    );
    if (nameTaken(siblings, branch.name, (one) => one.id === id)) {
      return refuse('sys.name-taken', { of: 'branch', name: branch.name });
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
    // One level further up as well, and for the reason `openLocation` asks:
    // the branch may still be trading while the company that issues its
    // documents has been withdrawn, and putting a place back into use below
    // it is the same growth that opening one would be.
    if (branch !== null) {
      const inactiveCompany = companyWithdrawn(session, tenant, branch);
      if (inactiveCompany !== null) return inactiveCompany;
    }
    const siblings = locationsIn(session, tenant, location.branch, { including: 'all' });
    if (nameTaken(siblings, location.name, (one) => one.id === id)) {
      return refuse('sys.name-taken', { of: 'location', name: location.name });
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
    if (branch !== null) {
      const inactiveCompany = companyWithdrawn(session, tenant, branch);
      if (inactiveCompany !== null) return inactiveCompany;
    }
    const siblings = registersIn(session, tenant, register.branch, { including: 'all' });
    if (nameTaken(siblings, register.name, (one) => one.id === id)) {
      return refuse('sys.name-taken', { of: 'register', name: register.name });
    }
  }
  return ok(writeRecord(session, 'register', tenant, [id], { ...register, active }));
}
