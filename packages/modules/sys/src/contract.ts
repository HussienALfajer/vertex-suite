import {
  permissionId,
  type BranchId,
  type CompanyId,
  type DeviceId,
  type LocationId,
  type PermissionId,
  type RegisterId,
  type SeededRole,
  type TenantId,
} from '@vertex/contracts';
import type { Refusal, Result } from '@vertex/kernel';
import { contractKey, type CommandContext, type UnitOfWork } from '@vertex/platform';

/**
 * What `SYS` lets the rest of the system see.
 *
 * Every module places stock somewhere, issues a document from somewhere, or
 * prints a header, so nearly every module reads this. None of them may reach
 * any further: `modules.md` §4 permits the contract and nothing else, and
 * `check:boundaries` holds the workspace to it.
 *
 * The file is types and keys only. It is imported by anything that depends on
 * `SYS`, so anything it pulled in would be pulled in by all of them — which is
 * why it may not import the implementation behind it, and why the build refuses
 * if it ever does.
 */

/**
 * What `SYS` needs from a store, and nothing more.
 *
 * It is in the contract rather than hidden inside the module because numbering
 * joins the **caller's** transaction (see `DocumentNumbering`), so a caller has
 * to be able to name the handle it is passing. There is no `remove`: `SYS-09`
 * says structural entities are deactivated and never deleted, and a module with
 * no way to delete anything is a stronger statement of that than a rule
 * somebody has to remember.
 */
export interface RecordSession {
  put(key: string, value: unknown): void;
  get(key: string): unknown;
  keys(): readonly string[];
}

/** Where stock sits. A branch has several, and they behave differently in `STK`. */
export type LocationKind = 'shop-floor' | 'store-room' | 'vehicle';

/**
 * A point on the Earth, as two exact decimal strings of degrees (`SYS-14`).
 *
 * Not a pair of numbers, and for the kernel's own reason: a value that is
 * written, synced and read back has to come back as it was written. A float
 * round-trips through JSON as whichever double happened to be nearest, and two
 * store nodes comparing the same doorstep would find a difference nobody made.
 *
 * North and east are positive. `place.ts` is the only seam that produces one,
 * and fixes what "as written" means.
 */
export interface GeoPoint {
  readonly lat: string;
  readonly lng: string;
}

/**
 * Everything `SYS` owns carries its tenant.
 *
 * A store node holds more than one, and there is no read in this system allowed
 * not to know which — so the tenant is on the record itself, not only on the
 * key it was found under, and a caller that has the record can always check.
 */
interface TenantOwned {
  readonly tenant: TenantId;
}

/** A legal entity within the tenant: what a document is issued by. */
export interface Company extends TenantOwned {
  readonly id: CompanyId;
  readonly name: string;
  readonly active: boolean;
}

/** A trading site. Permissions, numbering and stock are all scoped by one. */
export interface Branch extends TenantOwned {
  readonly id: BranchId;
  readonly company: CompanyId;
  readonly name: string;
  /** `SYS-14`. Free text, and empty until somebody writes it. */
  readonly address: string;
  /**
   * `SYS-14`. Null is a branch nobody has placed yet, which is all of them on
   * the day a shop installs this — so it is the ordinary state, not a gap.
   */
  readonly point: GeoPoint | null;
  readonly active: boolean;
}

export interface Location extends TenantOwned {
  readonly id: LocationId;
  readonly branch: BranchId;
  readonly name: string;
  readonly kind: LocationKind;
  /** `SYS-14`. Free text, and empty until somebody writes it. */
  readonly address: string;
  /**
   * `SYS-14`, and **null means "at the branch"** rather than "unknown".
   *
   * A shop floor and the store room behind it share one doorstep, and giving
   * each of them a copy of it would put three markers on one spot and make
   * moving the shop a job of editing three records that must not disagree. A
   * point here is for the location that is somewhere else — the overflow
   * warehouse across town — which is the case this field exists for.
   *
   * A `vehicle` never has one. A van's place is not a fact that holds still,
   * and a fixed point for one is a wrong answer rather than a missing one, so
   * the command refuses it instead of storing it.
   */
  readonly point: GeoPoint | null;
  readonly active: boolean;
}

/**
 * A till position, which is not the machine standing at it.
 *
 * The prefix is `SYS-02`'s: every document number a register issues carries it,
 * so two registers sharing one would file two sales under one number. It is
 * fixed when the register is opened and never edited, because a number already
 * printed cannot be renamed.
 */
export interface Register extends TenantOwned {
  readonly id: RegisterId;
  readonly branch: BranchId;
  readonly name: string;
  readonly prefix: string;
  readonly active: boolean;
  /**
   * The machine standing at the till, and how many have stood there.
   *
   * `SEC` owns the device itself — what it is, whether it may sign in, when it
   * was last seen. What is here is only what numbering turns on: which one
   * holds the position now, and a count that goes up whenever a different one
   * takes over. That count is the **device generation** of `SYS-02`, and it is
   * what makes a replacement machine unable to reissue a number the machine it
   * replaced had already printed but not yet sent.
   *
   * Zero, with nobody holding it, is a register that has been opened and not
   * yet plugged in. It cannot issue a document, because there is nothing for
   * the number to say it came from.
   */
  readonly generation: number;
  readonly heldBy: DeviceId | null;
}

/**
 * `SYS-05`, and it belongs to the **company** rather than to the tenant.
 *
 * A tenant with two companies issues documents from both, and a receipt that
 * printed the wrong legal name and tax number is a document that does not stand
 * up. One company degenerates to the obvious case at no cost.
 */
export interface BusinessProfile extends TenantOwned {
  readonly company: CompanyId;
  readonly name: string;
  /**
   * A reference to stored content, never the bytes.
   *
   * The profile is read on every receipt and every screen header; an image in
   * that row is an image read thousands of times a day. The printer of `HW-01`
   * resolves the reference when it actually needs pixels.
   */
  readonly logo: string | null;
  readonly address: string;
  readonly phone: string;
  /**
   * Keyed by the kind of identifier, because which ones exist is a question
   * about a country rather than about this system: a VAT number, a commercial
   * register number, a national tax number. A fixed set of columns here would
   * be wrong in the second country the product is sold in.
   */
  readonly taxIdentifiers: Readonly<Record<string, string>>;
  readonly receiptHeader: string;
  readonly receiptFooter: string;
}

/** Whether a listing hides what has been taken out of use, or shows everything. */
export interface Listing {
  readonly including?: 'active' | 'all';
}

/**
 * The read side, which is what other modules use.
 *
 * Reads are asynchronous and take a context for the same two reasons: the store
 * is reached through a transaction, and `SEC-04` will scope a user's sight to
 * particular branches — which is answerable only if the reader is known.
 */
export interface Organisation {
  company(by: CommandContext, id: CompanyId): Promise<Company | null>;
  branch(by: CommandContext, id: BranchId): Promise<Branch | null>;
  location(by: CommandContext, id: LocationId): Promise<Location | null>;
  register(by: CommandContext, id: RegisterId): Promise<Register | null>;

  companies(by: CommandContext, listing?: Listing): Promise<readonly Company[]>;
  branches(by: CommandContext, listing?: Listing): Promise<readonly Branch[]>;
  locations(by: CommandContext, branch: BranchId, listing?: Listing): Promise<readonly Location[]>;
  registers(by: CommandContext, branch: BranchId, listing?: Listing): Promise<readonly Register[]>;

  profile(by: CommandContext, company: CompanyId): Promise<BusinessProfile | null>;

  /**
   * The value of a setting at a branch, or the tenant's own if the branch has
   * not overridden it, or null if neither has been set.
   *
   * A string, and deliberately not a union of shapes. What a setting means is
   * known to the module that declared it; a typed value here would make `SYS`
   * know what every other module's settings are for, which is the dependency
   * §4 exists to prevent.
   */
  setting(by: CommandContext, branch: BranchId, key: string): Promise<string | null>;
}

export type OrganisationRefusalCode =
  | 'sys.company-not-found'
  | 'sys.register-inactive'
  | 'sys.branch-not-found'
  | 'sys.location-not-found'
  | 'sys.register-not-found'
  | 'sys.company-inactive'
  | 'sys.branch-inactive'
  | 'sys.register-prefix-taken'
  | 'sys.register-prefix-invalid'
  | 'sys.name-required'
  /** `SYS-14`: not a decimal, or more degrees than the Earth has. */
  | 'sys.point-out-of-range'
  /**
   * `SYS-14`: a van is a stock location whose place moves with it. Storing a
   * point for one would answer a question about where the stock is with
   * somewhere it was, which is worse than having no answer at all.
   */
  | 'sys.location-kind-has-no-place'
  /**
   * Two of anything under one name, in the one place a person has to tell them
   * apart. A dropdown of three branches called "الفرع الرئيسي" is a stock
   * transfer sent to the wrong shop, and the mistake is made at the moment the
   * list is read rather than at the moment the name is typed.
   */
  | 'sys.name-taken'
  /** The caller does not hold the right this command declares (`SEC-02`). */
  | 'sys.not-permitted';

export type OrganisationRefusal = Refusal<OrganisationRefusalCode>;

type Outcome<T> = Promise<Result<T, OrganisationRefusal>>;

/**
 * The write side: what the **tenant's own administrator** does, and what the
 * vendor never does.
 *
 * There is no delete, anywhere, and that is the whole of `SYS-09`'s second
 * sentence made structural rather than remembered. Stock movements and
 * documents reference these rows permanently, so an entity leaves use by
 * becoming inactive and stays where every document that names it can still find
 * it. The store this module writes through cannot delete either.
 *
 * **Every command here checks the right it declares.** It did not always: these
 * commands named their rights and enforced none of them, because `SEC` did not
 * exist until `U04.4` and there was nothing to ask. Once `SEC` shipped there
 * was, and the gap left `SYS` declaring a matrix an administrator could read in
 * the role editor while every organisation command ran for whoever called it.
 *
 * The question goes through `ModuleContext.authorise` — the platform's seam —
 * because `SEC` depends on `SYS` and `SYS` may not import it back (`modules.md`
 * §4). The alternative, leaving the check to each app, is an invariant that
 * every future app has to remember; this one fails closed in the composition
 * instead, and an edition wired without an authoriser raises at the first
 * question rather than answering it.
 *
 * `where` is the place the action is taken, so a manager confined to one branch
 * (`SEC-04`) opens a location in that branch and not in the one next door. A
 * command with no branch at all — registering a company, revising the business
 * profile, setting a tenant-wide value — is the tenant-wide place, which only
 * an unconfined grant reaches.
 */
export interface OrganisationAdministration {
  readonly companies: {
    register(by: CommandContext, input: NewCompany): Outcome<Company>;
    rename(by: CommandContext, id: CompanyId, name: string): Outcome<Company>;
    deactivate(by: CommandContext, id: CompanyId): Outcome<Company>;
    reactivate(by: CommandContext, id: CompanyId): Outcome<Company>;
  };
  readonly branches: {
    open(by: CommandContext, input: NewBranch): Outcome<Branch>;
    rename(by: CommandContext, id: BranchId, name: string): Outcome<Branch>;
    readdress(by: CommandContext, id: BranchId, address: string): Outcome<Branch>;
    /** `null` takes the point off. A place wrongly marked is worse than unmarked. */
    locate(by: CommandContext, id: BranchId, point: GeoPoint | null): Outcome<Branch>;
    deactivate(by: CommandContext, id: BranchId): Outcome<Branch>;
    reactivate(by: CommandContext, id: BranchId): Outcome<Branch>;
  };
  readonly locations: {
    open(by: CommandContext, input: NewLocation): Outcome<Location>;
    rename(by: CommandContext, id: LocationId, name: string): Outcome<Location>;
    readdress(by: CommandContext, id: LocationId, address: string): Outcome<Location>;
    /** `null` returns the location to its branch's place; a vehicle is refused. */
    locate(by: CommandContext, id: LocationId, point: GeoPoint | null): Outcome<Location>;
    deactivate(by: CommandContext, id: LocationId): Outcome<Location>;
    reactivate(by: CommandContext, id: LocationId): Outcome<Location>;
  };
  readonly registers: {
    open(by: CommandContext, input: NewRegister): Outcome<Register>;
    rename(by: CommandContext, id: RegisterId, name: string): Outcome<Register>;
    deactivate(by: CommandContext, id: RegisterId): Outcome<Register>;
    reactivate(by: CommandContext, id: RegisterId): Outcome<Register>;
    /**
     * Says which machine is standing at this till now.
     *
     * A different machine than last time raises the device generation, which is
     * the whole of `SYS-02`'s guarantee: the replacement cannot reissue a number
     * the machine it replaced had printed but not yet sent, because every number
     * either of them printed carries the generation it was printed under.
     *
     * Naming the same machine again changes nothing, deliberately. A register
     * that reconnects, or a command that is replayed, must not spend a
     * generation — and a spent generation is not recoverable.
     */
    assignDevice(by: CommandContext, id: RegisterId, device: DeviceId): Outcome<Register>;
  };
  readonly profile: {
    revise(
      by: CommandContext,
      company: CompanyId,
      changes: ProfileRevision,
    ): Outcome<BusinessProfile>;
  };
  readonly numbering: {
    /**
     * Sets the format of one series. Revising it leaves numbers already issued
     * exactly as they were printed, and applies from the next one.
     */
    define(by: CommandContext, scope: SeriesScope, format: string): Numbered<NumberingSeries>;
  };
  readonly settings: {
    /** `null` removes the branch's override and returns it to the tenant's value. */
    forBranch(
      by: CommandContext,
      branch: BranchId,
      key: string,
      value: string | null,
    ): Outcome<void>;
    forTenant(by: CommandContext, key: string, value: string | null): Outcome<void>;
  };
}

export interface NewCompany {
  readonly name: string;
  readonly profile?: ProfileRevision;
}

export interface NewBranch {
  readonly company: CompanyId;
  readonly name: string;
  /**
   * Both optional, and both settable afterwards.
   *
   * Here because an administrator opening a branch usually knows where it is,
   * and a second trip through a second command to say so is a step that gets
   * skipped — leaving the map of `SYS-14` empty for a shop that could have
   * filled it in while it was already typing.
   */
  readonly address?: string;
  readonly point?: GeoPoint;
}

export interface NewLocation {
  readonly branch: BranchId;
  readonly name: string;
  readonly kind: LocationKind;
  readonly address?: string;
  /** Omitted is the ordinary case: the location is at its branch. */
  readonly point?: GeoPoint;
}

export interface NewRegister {
  readonly branch: BranchId;
  readonly name: string;
  readonly prefix: string;
}

/** Every field optional: an administrator revises what they came to revise. */
export interface ProfileRevision {
  readonly name?: string;
  readonly logo?: string | null;
  readonly address?: string;
  readonly phone?: string;
  readonly taxIdentifiers?: Readonly<Record<string, string>>;
  readonly receiptHeader?: string;
  readonly receiptFooter?: string;
}

/**
 * Which series a number is drawn from: `SYS-02`'s four dimensions.
 *
 * The document type is a name the **owning module** chose — `pos.sale`,
 * `pur.invoice` — and `SYS` never learns what one means. The fiscal year is a
 * label the caller supplies rather than an identifier `SYS` resolves, because
 * `FIN` owns fiscal years and `FIN` depends on `SYS`; asking for the identifier
 * would be the cycle `modules.md` §4 exists to prevent. `SYS` partitions by
 * whatever label it is handed and has no opinion about when the year turns.
 */
export interface SeriesScope {
  readonly documentType: string;
  readonly branch: BranchId;
  /** Null for a document nobody issues at a till: a purchase invoice, typed. */
  readonly register: RegisterId | null;
  readonly fiscalYear: string;
}

/** The configured shape of one series. The counter is not here; see below. */
export interface NumberingSeries extends TenantOwned {
  readonly scope: SeriesScope;
  readonly format: string;
}

export interface IssuedNumber {
  /** What is printed, and what a person reads back over the counter. */
  readonly number: string;
  readonly sequence: number;
  /** Zero for a series with no register, where there is no machine to count. */
  readonly generation: number;
  readonly scope: SeriesScope;
}

export type NumberingRefusalCode =
  | 'sys.document-type-unowned'
  | 'sys.document-reference-required'
  | 'sys.fiscal-year-required'
  | 'sys.series-format-invalid'
  | 'sys.series-format-must-carry-register'
  | 'sys.series-format-carries-absent-register'
  | 'sys.register-not-found'
  | 'sys.register-inactive'
  | 'sys.register-has-no-device'
  | 'sys.register-outside-branch'
  | 'sys.branch-not-found'
  | 'sys.branch-inactive'
  /**
   * Revising a format is a right (`SYS_PERMISSIONS.numberingSeries.edit`);
   * taking the next number is not, and never reaches this refusal — a document
   * numbers itself, and a right nobody can be refused only clutters the role
   * editor.
   */
  | 'sys.not-permitted';

export type NumberingRefusal = Refusal<NumberingRefusalCode>;

type Numbered<T> = Promise<Result<T, NumberingRefusal>>;

/**
 * `SYS-02`, and the reason it is offline-safe **by construction** rather than
 * by coordination.
 *
 * Each device counts from one. Two devices that have never met, and never will
 * until they sync, cannot produce the same number, because every number carries
 * the register's prefix — unique across the tenant — and the generation under
 * which that machine took the position. Nothing has to be asked, reserved or
 * agreed, which is what `POS-19` needs: a register with no connection still
 * sells, and what it printed reconciles afterwards.
 *
 * That is also why the counter restarts when a device is replaced. A counter
 * carried across the handover would have to know where the previous machine had
 * got to — and the numbers it had not yet sent are exactly the ones nobody
 * knows about. Restarting needs no such knowledge, and the generation keeps the
 * two runs apart.
 */
export interface DocumentNumbering {
  /**
   * Takes the next number, **inside the caller's transaction**.
   *
   * Not its own: a sale that rolls back has to take its number with it, or the
   * series grows a gap that a tax inspector asks about and nobody can explain.
   * The caller passes the unit of work it is already in, and the counter moves
   * only if the document does.
   *
   * `document` is the caller's own identifier for the thing being numbered,
   * generated on the device before this call. It makes the issue repeatable:
   * `SYN-02` replays an operation that may already have been applied, and a
   * replay that asked for a new number would print a second document for one
   * sale. Asking again for the same document returns the number it already has.
   *
   * Called **where the document is made, once**. A number is taken on the
   * machine that prints it and then travels with the document; a store node
   * applying that document from the outbox stores the number it was given and
   * does not ask for one, because the receipt in the customer's hand is already
   * the record of what this document is called.
   */
  next(
    uow: UnitOfWork<RecordSession>,
    scope: SeriesScope,
    document: string,
  ): Numbered<IssuedNumber>;

  /** The configured series, or null where nobody has set a format yet. */
  series(by: CommandContext, scope: SeriesScope): Promise<NumberingSeries | null>;
}

export const DocumentNumbering = contractKey<DocumentNumbering>('sys.document-numbering');

export const Organisation = contractKey<Organisation>('sys.organisation');

export const OrganisationAdministration = contractKey<OrganisationAdministration>(
  'sys.organisation-administration',
);

/**
 * The rights this module defines, named so that `SEC-01` can seed them into the
 * seven roles without retyping a string.
 *
 * Deactivation is granted as `delete`, which is not a compromise: withdrawing a
 * branch from use **is** what deletion means here, since the row itself never
 * goes. Whoever may take one out of use may put it back, because an
 * administrator who can withdraw a register and then cannot restore it is an
 * administrator who calls the vendor — which is the one thing `SYS-09` says
 * must never be necessary.
 */
/** The four a structural entity has. `withdraw` is the `delete` of `SEC-02`. */
export interface StructuralRights {
  readonly view: PermissionId;
  readonly create: PermissionId;
  readonly edit: PermissionId;
  readonly withdraw: PermissionId;
}

/** A thing that is looked at and revised, and never created or withdrawn. */
export interface EditableRights {
  readonly view: PermissionId;
  readonly edit: PermissionId;
}

/**
 * Every right defined below, collected as each one is built, with the roles
 * that hold it on the day a shop is set up.
 *
 * The module declares its permissions from this list, and the two functions
 * beneath are the only way to make a right at all — so a right cannot exist
 * without being declared. A second list written by hand would eventually miss
 * one, and a right nobody declared is a right `SEC` cannot grant: it shows up
 * as an administrator who simply cannot be given a job, with nothing anywhere
 * saying why.
 *
 * The seeds are `SEC-01`'s, and they are this module's to state rather than
 * `SEC`'s: who has business with a stock location is a question about stock
 * locations. The owner appears nowhere below, because the owner holds
 * everything the edition declares and `SEC` works that out from the
 * declarations themselves.
 */
interface Declared {
  readonly id: PermissionId;
  readonly seededFor: readonly SeededRole[];
}

const DECLARED: Declared[] = [];

/** Who holds each of the four rights over a structural entity. */
type StructuralSeeds = Readonly<Record<keyof StructuralRights, readonly SeededRole[]>>;

/** Who holds each of the two rights over something read and revised. */
type EditableSeeds = Readonly<Record<keyof EditableRights, readonly SeededRole[]>>;

/**
 * Built through the grammar rather than written out, so that a right this
 * module declares and a right `SEC` later grants cannot differ by a character.
 */
function rightsOver(resource: string, seeds: StructuralSeeds): StructuralRights {
  const rights: StructuralRights = Object.freeze({
    view: permissionId('sys', resource, 'view'),
    create: permissionId('sys', resource, 'create'),
    edit: permissionId('sys', resource, 'edit'),
    withdraw: permissionId('sys', resource, 'delete'),
  });
  DECLARED.push(
    { id: rights.view, seededFor: seeds.view },
    { id: rights.create, seededFor: seeds.create },
    { id: rights.edit, seededFor: seeds.edit },
    { id: rights.withdraw, seededFor: seeds.withdraw },
  );
  return rights;
}

function rightsToReadAndRevise(resource: string, seeds: EditableSeeds): EditableRights {
  const rights: EditableRights = Object.freeze({
    view: permissionId('sys', resource, 'view'),
    edit: permissionId('sys', resource, 'edit'),
  });
  DECLARED.push(
    { id: rights.view, seededFor: seeds.view },
    { id: rights.edit, seededFor: seeds.edit },
  );
  return rights;
}

/** Everyone who works in a shop can see which shop they are working in. */
const EVERYONE: readonly SeededRole[] = Object.freeze([
  'manager',
  'accountant',
  'purchasing',
  'warehouse-keeper',
  'floor-supervisor',
  'cashier',
]);

const MANAGER: readonly SeededRole[] = Object.freeze(['manager']);

/**
 * Nobody but the owner, seeded.
 *
 * Registering a company and withdrawing one are decisions about the legal
 * entity that issues every document; a shop that wants its manager doing them
 * grants it in the role editor, which is a deliberate act and an auditable one.
 */
const OWNER_ONLY: readonly SeededRole[] = Object.freeze([]);

export interface SysPermissions {
  readonly company: StructuralRights;
  readonly branch: StructuralRights;
  readonly location: StructuralRights;
  readonly register: StructuralRights;
  readonly businessProfile: EditableRights;
  readonly branchSetting: EditableRights;
  readonly numberingSeries: EditableRights;
}

export const SYS_PERMISSIONS: SysPermissions = Object.freeze({
  company: rightsOver('company', {
    view: ['manager', 'accountant'],
    create: OWNER_ONLY,
    edit: OWNER_ONLY,
    withdraw: OWNER_ONLY,
  }),
  branch: rightsOver('branch', {
    view: EVERYONE,
    // Opening and shutting a shop is the owner's; running the one you are in is
    // the manager's.
    create: OWNER_ONLY,
    edit: MANAGER,
    withdraw: OWNER_ONLY,
  }),
  location: rightsOver('location', {
    view: ['manager', 'purchasing', 'warehouse-keeper', 'floor-supervisor'],
    create: MANAGER,
    edit: MANAGER,
    withdraw: MANAGER,
  }),
  register: rightsOver('register', {
    view: ['manager', 'floor-supervisor', 'cashier'],
    create: MANAGER,
    edit: MANAGER,
    withdraw: MANAGER,
  }),
  // The cashier reads this one, and it is the only `SYS` record they revise
  // nothing of: `SYS-05` puts the legal name and the tax number on every
  // receipt, and a register that cannot read them cannot print one.
  businessProfile: rightsToReadAndRevise('business-profile', {
    view: ['manager', 'accountant', 'cashier'],
    edit: MANAGER,
  }),
  branchSetting: rightsToReadAndRevise('branch-setting', {
    view: MANAGER,
    edit: MANAGER,
  }),
  // Revising a format is a right; taking the next number is not. Numbering is
  // something a document does to itself, not something a person asks for, and a
  // right nobody can be refused is a right that only clutters the role editor.
  //
  // The accountant revises it rather than the manager. A document series is
  // what an inspector reads a year later, and its format is an accounting
  // decision that outlives whoever is managing the shop this season.
  numberingSeries: rightsToReadAndRevise('numbering-series', {
    view: ['manager', 'accountant'],
    edit: ['accountant'],
  }),
});

export const SYS_PERMISSION_IDS: readonly PermissionId[] = Object.freeze(
  DECLARED.map((one) => one.id),
);

/** What the module hands the platform: every right, and who starts out holding it. */
export const SYS_PERMISSION_SEEDS: readonly Declared[] = Object.freeze([...DECLARED]);
