import {
  permissionId,
  type BranchId,
  type LocationId,
  type PermissionId,
  type SeededRole,
  type TenantId,
  type UserId,
} from '@vertex/contracts';
import type { Id, Refusal, Result } from '@vertex/kernel';
import { contractKey, type CommandContext } from '@vertex/platform';

/**
 * What `SEC` lets the rest of the system see: who may do what, and where.
 *
 * The important shape here is which way the question travels. No module may
 * depend on `SEC` — `SEC` depends on `SYS`, and every module depends on `SYS`,
 * so a module that also imported `SEC` would sit on both sides of a cycle. The
 * guard therefore lives **on the way in**: the app resolves `Authorisation`,
 * asks before it dispatches, and the module underneath goes on knowing nothing
 * about permissions. That is the same boundary `SYS`'s administration contract
 * described when it said the check belongs where the request arrives.
 *
 * The one exception is this module's own administration, and it is an exception
 * with a reason rather than a convenience. Granting rights is the single
 * command whose unguarded version hands over the entire system, and `SEC` can
 * check it without depending on anybody. Defence in depth where the depth is
 * free.
 */

/**
 * A role, which never leaves this module.
 *
 * `contracts/identity.ts` draws that line: a branch identifier is on eight
 * modules' rows and so is shared vocabulary, while a role is named by nothing
 * outside `SEC` and putting its identifier in a shared package would advertise
 * a reach nobody is permitted.
 */
export type RoleId = Id<'role'>;

/** Everything `SEC` owns carries the tenant it belongs to, like everything else. */
interface TenantOwned {
  readonly tenant: TenantId;
}

/**
 * A named set of rights (`SEC-01`).
 *
 * `seeded` records which of the seven this began as, and is used for one thing
 * only: not seeding it twice. Nothing in this system decides what somebody may
 * do by reading it — the seeded roles are ordinary editable rows, a shop may
 * rename the cashier or withdraw the accountant, and a check for "is the owner"
 * would be a right that never appears in the role editor and cannot be granted
 * to whoever is covering a holiday.
 *
 * `name` is null until somebody renames it. A seeded role is then displayed
 * through the terminology layer (`role.cashier`), which is what
 * `design-system.md` §12 requires of every user-facing string; a role a tenant
 * invented is displayed as the tenant typed it, in the tenant's own language,
 * and there is nothing to translate.
 */
export interface Role extends TenantOwned {
  readonly id: RoleId;
  readonly seeded: SeededRole | null;
  readonly name: string | null;
  readonly rights: readonly PermissionId[];
  /**
   * Withdrawn rather than deleted, and not only because the store cannot
   * delete: `SEC-06` will ask a year from now which rights a user held on the
   * day of a particular sale, and a row that was removed answers nothing.
   */
  readonly active: boolean;
}

/**
 * Where a user's rights reach (`SEC-04`).
 *
 * The two cases are spelled out because the alternative — a list of branches
 * where empty means everywhere — reads correctly in review and grants the
 * entire shop group. Unconfined is a word somebody has to say.
 */
export type Confinement =
  | { readonly kind: 'tenant' }
  | {
      readonly kind: 'branches';
      readonly branches: readonly BranchId[];
      /**
       * Locations narrow **within** those branches, and only questions that
       * name a location.
       *
       * Empty means every location of the named branches, including one opened
       * next month. The stricter reading — an explicit list, and nothing else
       * reachable — was rejected: a manager who adds a store room and finds the
       * keeper locked out of it has no way to connect the two, and the failure
       * arrives in the middle of a delivery.
       */
      readonly locations: readonly LocationId[];
    };

export const TENANT_WIDE: Confinement = Object.freeze({ kind: 'tenant' });

/**
 * A user in a role, over a stretch of the shop group.
 *
 * The confinement belongs to the **assignment** rather than to the user,
 * because the same person is a manager in one shop and stands at a till in
 * another. One confinement per user would force the shop to choose: either the
 * cover supervisor approves refunds in a branch they do not run, or they cannot
 * serve a customer in the one they do.
 */
export interface Assignment extends TenantOwned {
  readonly user: UserId;
  readonly role: RoleId;
  readonly confinement: Confinement;
  /** Withdrawn, never removed: `SEC-06` asks what somebody held last March. */
  readonly active: boolean;
}

/**
 * Where an action is being taken.
 *
 * **Omitting the branch is not a wildcard.** It asks about an action that has
 * no place — revising the business profile of the company, defining a role —
 * and only somebody unconfined may take one. The other reading, "anywhere at
 * all", is how a supervisor confined to one shop comes to edit the tax number
 * that prints on every receipt in the group.
 */
export interface Where {
  readonly branch?: BranchId;
  readonly location?: LocationId;
}

/**
 * Why the answer was what it was.
 *
 * A screen needs the difference to say anything useful: a button that is
 * disabled everywhere is a job this person does not do, and a button disabled
 * because they are standing in the wrong shop is a sentence a manager can act
 * on. `no-such-right` is separate again — it is the host's own defect, a right
 * asked for under a name no module declared, and a disabled button is the worst
 * possible way to report it.
 */
export type Grounds =
  'system' | 'granted' | 'no-such-right' | 'no-actor-rights' | 'outside-confinement';

export interface Decision {
  readonly granted: boolean;
  readonly grounds: Grounds;
}

/**
 * The answer to `SEC-02` and `SEC-04`, and the only question this module is
 * asked in the ordinary course of a day.
 */
export interface Authorisation {
  /** The whole of it, for a caller that is about to do something or not. */
  may(by: CommandContext, right: PermissionId, where?: Where): Promise<boolean>;
  /** The same question with its reason, for a screen that has to explain itself. */
  decide(by: CommandContext, right: PermissionId, where?: Where): Promise<Decision>;
  /**
   * Everywhere this actor holds a particular right, gathered across every role
   * they are in.
   *
   * What a listing needs: `SEC-04` limits what a user may see as well as what
   * they may do, and a screen that asked `may` once per branch would ask a
   * hundred questions to draw one page.
   */
  reachOf(by: CommandContext, right: PermissionId): Promise<Confinement>;
}

/**
 * The read side. Guarded by the caller like every other module's reads —
 * `sec.role.view` and `sec.role-assignment.view` are declared for exactly that.
 */
export interface RoleDirectory {
  role(by: CommandContext, id: RoleId): Promise<Role | null>;
  roles(by: CommandContext, listing?: Listing): Promise<readonly Role[]>;
  assignmentsOf(
    by: CommandContext,
    user: UserId,
    listing?: Listing,
  ): Promise<readonly Assignment[]>;
  holdersOf(by: CommandContext, role: RoleId, listing?: Listing): Promise<readonly Assignment[]>;
}

/** Whether a listing hides what has been withdrawn, or shows everything. */
export interface Listing {
  readonly including?: 'active' | 'all';
}

export type SecRefusalCode =
  | 'sec.not-permitted'
  | 'sec.role-not-found'
  | 'sec.role-withdrawn'
  | 'sec.role-name-required'
  | 'sec.right-undeclared'
  | 'sec.right-not-held'
  | 'sec.confinement-empty'
  | 'sec.confinement-exceeds-own'
  | 'sec.branch-not-found'
  | 'sec.branch-inactive'
  | 'sec.location-not-found'
  | 'sec.location-outside-confinement'
  | 'sec.assignment-not-found'
  | 'sec.last-owner';

export type SecRefusal = Refusal<SecRefusalCode>;

type Outcome<T> = Promise<Result<T, SecRefusal>>;

export interface NewRole {
  /** A role a tenant invented is named by the tenant, in the tenant's words. */
  readonly name: string;
  readonly rights?: readonly PermissionId[];
}

export interface NewAssignment {
  readonly user: UserId;
  readonly role: RoleId;
  readonly confinement: Confinement;
}

/**
 * What the **tenant's own administrator** does to decide who may do what.
 *
 * Every command here checks the caller, which is the exception this file opened
 * with. Two rules run through all of them and both are about the same failure —
 * an administrator handing out more than they were given:
 *
 *   - a right cannot be put into a role by somebody who does not hold it
 *     tenant-wide, because a role is tenant-wide and whoever is assigned it
 *     unconfined would hold that right everywhere;
 *   - an assignment cannot reach further than the assigner's own reach, right
 *     by right, so a manager covering one shop can staff that shop and not the
 *     group.
 *
 * Without the pair, `sec.role.edit` is indistinguishable from ownership: grant
 * yourself everything, then assign it to yourself.
 */
export interface RoleAdministration {
  readonly roles: {
    /**
     * Installs the seven of `SEC-01`, once.
     *
     * Idempotent, and that is load-bearing rather than tidy: `SYN-02` replays
     * commands, first-run installation may be interrupted, and a second seeding
     * that re-imposed the shipped rights would silently undo every edit a shop
     * had made to them.
     */
    seed(by: CommandContext): Outcome<readonly Role[]>;
    define(by: CommandContext, input: NewRole): Outcome<Role>;
    rename(by: CommandContext, id: RoleId, name: string): Outcome<Role>;
    grant(by: CommandContext, id: RoleId, rights: readonly PermissionId[]): Outcome<Role>;
    revoke(by: CommandContext, id: RoleId, rights: readonly PermissionId[]): Outcome<Role>;
    withdraw(by: CommandContext, id: RoleId): Outcome<Role>;
    restore(by: CommandContext, id: RoleId): Outcome<Role>;
  };
  readonly assignments: {
    /** Assigning a role the user already holds replaces its confinement. */
    assign(by: CommandContext, input: NewAssignment): Outcome<Assignment>;
    withdraw(by: CommandContext, user: UserId, role: RoleId): Outcome<Assignment>;
  };
}

export const Authorisation = contractKey<Authorisation>('sec.authorisation');

export const RoleDirectory = contractKey<RoleDirectory>('sec.role-directory');

export const RoleAdministration = contractKey<RoleAdministration>('sec.role-administration');

/**
 * What `SEC` needs from a store.
 *
 * Declared here rather than imported from `SYS`, whose contract carries the
 * same three methods. A store port is not `SYS`'s property, and the day the
 * drivers arrive (`U07`) the two modules may want different things of one;
 * structural typing already lets a host satisfy both with one session, which is
 * the whole benefit an import would have bought.
 */
export interface RecordSession {
  put(key: string, value: unknown): void;
  get(key: string): unknown;
  keys(): readonly string[];
}

/** The four rights over a thing that is made, read, revised and withdrawn. */
export interface StructuralRights {
  readonly view: PermissionId;
  readonly create: PermissionId;
  readonly edit: PermissionId;
  readonly withdraw: PermissionId;
}

interface Declared {
  readonly id: PermissionId;
  readonly seededFor: readonly SeededRole[];
}

const DECLARED: Declared[] = [];

type Seeds = Readonly<Record<keyof StructuralRights, readonly SeededRole[]>>;

function rightsOver(resource: string, seeds: Seeds): StructuralRights {
  const rights: StructuralRights = Object.freeze({
    view: permissionId('sec', resource, 'view'),
    create: permissionId('sec', resource, 'create'),
    edit: permissionId('sec', resource, 'edit'),
    withdraw: permissionId('sec', resource, 'delete'),
  });
  DECLARED.push(
    { id: rights.view, seededFor: seeds.view },
    { id: rights.create, seededFor: seeds.create },
    { id: rights.edit, seededFor: seeds.edit },
    { id: rights.withdraw, seededFor: seeds.withdraw },
  );
  return rights;
}

export interface SecPermissions {
  readonly role: StructuralRights;
  readonly assignment: StructuralRights;
}

const MANAGER: readonly SeededRole[] = Object.freeze(['manager']);
const OWNER_ONLY: readonly SeededRole[] = Object.freeze([]);

export const SEC_PERMISSIONS: SecPermissions = Object.freeze({
  /**
   * Editing what a role holds stays with the owner, seeded.
   *
   * It is the one right that can be turned into every other right, and the
   * no-escalation rule above bounds that but does not make it ordinary. A shop
   * that wants its manager designing roles grants it deliberately, and the
   * grant is itself a change somebody can be shown.
   */
  role: rightsOver('role', {
    view: MANAGER,
    create: OWNER_ONLY,
    edit: OWNER_ONLY,
    withdraw: OWNER_ONLY,
  }),
  /**
   * Staffing, which is a manager's daily work rather than an owner's.
   *
   * Safe to seed that far because an assignment can never exceed the assigner's
   * own reach: a manager confined to one shop staffs that shop.
   */
  assignment: rightsOver('role-assignment', {
    view: MANAGER,
    create: MANAGER,
    edit: MANAGER,
    withdraw: MANAGER,
  }),
});

export const SEC_PERMISSION_SEEDS: readonly Declared[] = Object.freeze([...DECLARED]);

export const SEC_PERMISSION_IDS: readonly PermissionId[] = Object.freeze(
  DECLARED.map((one) => one.id),
);
