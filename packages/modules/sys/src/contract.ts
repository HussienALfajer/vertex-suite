import {
  permissionId,
  type BranchId,
  type CompanyId,
  type LocationId,
  type PermissionId,
  type RegisterId,
  type TenantId,
} from '@vertex/contracts';
import type { Refusal, Result } from '@vertex/kernel';
import { contractKey, type CommandContext } from '@vertex/platform';

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

/** Where stock sits. A branch has several, and they behave differently in `STK`. */
export type LocationKind = 'shop-floor' | 'store-room' | 'vehicle';

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
  readonly active: boolean;
}

export interface Location extends TenantOwned {
  readonly id: LocationId;
  readonly branch: BranchId;
  readonly name: string;
  readonly kind: LocationKind;
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
  | 'sys.branch-not-found'
  | 'sys.location-not-found'
  | 'sys.register-not-found'
  | 'sys.company-inactive'
  | 'sys.branch-inactive'
  | 'sys.register-prefix-taken'
  | 'sys.register-prefix-invalid'
  | 'sys.name-required';

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
 * **Nothing here checks a permission yet.** `SEC` does not exist until `U04.4`,
 * and these commands declare the rights they will be guarded by rather than
 * enforcing them. Until then the only caller is this module's own test: an app
 * that wired this contract to a request before `SEC` arrives would be offering
 * the organisation of the shop to whoever asked. The check belongs on the way
 * in, once there is something to ask.
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
    deactivate(by: CommandContext, id: BranchId): Outcome<Branch>;
    reactivate(by: CommandContext, id: BranchId): Outcome<Branch>;
  };
  readonly locations: {
    open(by: CommandContext, input: NewLocation): Outcome<Location>;
    rename(by: CommandContext, id: LocationId, name: string): Outcome<Location>;
    deactivate(by: CommandContext, id: LocationId): Outcome<Location>;
    reactivate(by: CommandContext, id: LocationId): Outcome<Location>;
  };
  readonly registers: {
    open(by: CommandContext, input: NewRegister): Outcome<Register>;
    rename(by: CommandContext, id: RegisterId, name: string): Outcome<Register>;
    deactivate(by: CommandContext, id: RegisterId): Outcome<Register>;
    reactivate(by: CommandContext, id: RegisterId): Outcome<Register>;
  };
  readonly profile: {
    revise(
      by: CommandContext,
      company: CompanyId,
      changes: ProfileRevision,
    ): Outcome<BusinessProfile>;
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
}

export interface NewLocation {
  readonly branch: BranchId;
  readonly name: string;
  readonly kind: LocationKind;
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
 * Every right defined below, collected as each one is built.
 *
 * The module declares its permissions from this list, and the two functions
 * beneath are the only way to make a right at all — so a right cannot exist
 * without being declared. A second list written by hand would eventually miss
 * one, and a right nobody declared is a right `SEC` cannot grant: it shows up
 * as an administrator who simply cannot be given a job, with nothing anywhere
 * saying why.
 */
const DECLARED: PermissionId[] = [];

/**
 * Built through the grammar rather than written out, so that a right this
 * module declares and a right `SEC` later grants cannot differ by a character.
 */
function rightsOver(resource: string): StructuralRights {
  const rights: StructuralRights = Object.freeze({
    view: permissionId('sys', resource, 'view'),
    create: permissionId('sys', resource, 'create'),
    edit: permissionId('sys', resource, 'edit'),
    withdraw: permissionId('sys', resource, 'delete'),
  });
  DECLARED.push(rights.view, rights.create, rights.edit, rights.withdraw);
  return rights;
}

function rightsToReadAndRevise(resource: string): EditableRights {
  const rights: EditableRights = Object.freeze({
    view: permissionId('sys', resource, 'view'),
    edit: permissionId('sys', resource, 'edit'),
  });
  DECLARED.push(rights.view, rights.edit);
  return rights;
}

export interface SysPermissions {
  readonly company: StructuralRights;
  readonly branch: StructuralRights;
  readonly location: StructuralRights;
  readonly register: StructuralRights;
  readonly businessProfile: EditableRights;
  readonly branchSetting: EditableRights;
}

export const SYS_PERMISSIONS: SysPermissions = Object.freeze({
  company: rightsOver('company'),
  branch: rightsOver('branch'),
  location: rightsOver('location'),
  register: rightsOver('register'),
  businessProfile: rightsToReadAndRevise('business-profile'),
  branchSetting: rightsToReadAndRevise('branch-setting'),
});

export const SYS_PERMISSION_IDS: readonly PermissionId[] = Object.freeze([...DECLARED]);
