import {
  operation,
  permissionId,
  type BranchId,
  type LocationId,
  type PermissionId,
  type SeededRole,
  type TenantId,
  type UserId,
} from '@vertex/contracts';
import type { Id, Instant, Refusal, Result } from '@vertex/kernel';
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
   * What the shipped defaults last offered this role, and the reason seeding
   * can be run twice without being either useless or destructive.
   *
   * It is the difference between a right that is **new** — declared by a module
   * the shop enabled after it was set up (`modules.md` §4.4) — and one an
   * administrator deliberately took away. Without it, seeding either re-imposes
   * the defaults over an edited role or never notices that the edition grew,
   * and the second is how a shop upgrades to `POS` and finds that nobody, the
   * owner included, may sell anything.
   *
   * Empty for a role a tenant invented: the defaults never offered it anything.
   */
  readonly seededWith: readonly PermissionId[];
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
   * Every grant of one right this actor holds, one per role they are in.
   *
   * What a listing needs: `SEC-04` limits what a user may see as well as what
   * they may do, and a screen that asked `may` once per branch would ask a
   * hundred questions to draw one page.
   *
   * A list and not one merged confinement, because there is no such thing. A
   * person who works in every location of Homs and only in the store room of
   * Aleppo has no single pair of lists that says so, and the merged answer —
   * both branches, no narrowing — claims a reach `may` itself refuses. Reading
   * the branches off the list is exact; reading the locations is not, and a
   * screen that needs them must ask per branch.
   */
  reachOf(by: CommandContext, right: PermissionId): Promise<readonly Confinement[]>;
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

/**
 * A person as **this tenant** knows them: `SEC-09`.
 *
 * The person and the sign-in are two different records and the split is the
 * whole of the feature's second paragraph. What is here belongs to one shop
 * group — the name on the screen, the handle typed at the till, whether they
 * still work here — and it is what a document that names a user resolves
 * through. The credential behind it may be shared with another tenant, and no
 * tenant may reach it.
 *
 * Deactivated and never deleted, for the reason `SYS-09` gives about branches
 * and this feature repeats about people: every sale, every adjustment and every
 * approval they ever made names them, and a removed row turns all of it into an
 * identifier nobody can resolve.
 */
export interface User extends TenantOwned {
  readonly id: UserId;
  /** What they type to sign in here. Unique within the tenant, never beyond it. */
  readonly handle: string;
  /** What the shop calls them, in the shop's own words. */
  readonly name: string;
  readonly active: boolean;
  /**
   * `SEC-09`'s force sign-out, as a moment rather than an act.
   *
   * A register that has been offline for two days cannot be told to drop a
   * session; it can be told that sessions issued before a moment are void, and
   * it finds that out the next time it syncs or the next time it asks. `U23`
   * owns sessions and honours this; nothing here issues one.
   *
   * It is on the **tenant's** record and not on the identity, so that one shop
   * cannot sign somebody out of another shop's till.
   */
  readonly sessionsVoidBefore: Instant | null;
  /**
   * Whether the sign-in behind this person is also some other tenant's.
   *
   * A boolean and never a list. That this administrator may not reset the
   * password is something they have to be told; **where else the person works
   * is not theirs to know**, and a list here would leak one shop's staff to
   * another through a screen built to be helpful.
   */
  readonly shared: boolean;
}

/**
 * What a sign-in produced: who they are, and in which shop.
 *
 * Deliberately not a session. `SEC-07` and `SEC-08` own sessions and devices
 * and arrive with `U23`; what this answers is the question underneath one —
 * whether this password belongs to somebody who may still work here — so that
 * `U23` builds session lifetime on an answer rather than beside it.
 */
export interface Authenticated {
  readonly user: UserId;
  readonly tenant: TenantId;
  readonly at: Instant;
}

/**
 * A password change for a sign-in that more than one tenant relies on.
 *
 * `SEC-09` allows exactly two ways for such a password to change: the owner's
 * own current credential, or "a recovery approved by an administrator of every
 * tenant it belongs to". This is the second. It exists because the first is
 * unavailable precisely when it is needed — somebody has forgotten a password —
 * and because the obvious shortcut, letting the tenant in front of you reset
 * it, is how one shop's administrator signs in to another shop.
 *
 * The approvals are tenants, not people: each tenant approves once, through
 * whoever there holds the right.
 */
export interface Recovery {
  readonly id: RecoveryId;
  readonly user: UserId;
  readonly opened: Instant;
  readonly approvedBy: readonly TenantId[];
  readonly settled: boolean;
}

export type RecoveryId = Id<'recovery'>;

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
  | 'sec.last-owner'
  | 'sec.user-not-found'
  | 'sec.user-inactive'
  | 'sec.user-name-required'
  | 'sec.handle-required'
  | 'sec.handle-taken'
  | 'sec.password-too-short'
  | 'sec.password-wrong'
  | 'sec.identity-shared'
  | 'sec.identity-not-found'
  | 'sec.recovery-not-found'
  | 'sec.recovery-settled'
  | 'sec.recovery-incomplete'
  | 'sec.no-actor';

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

/**
 * The people of one tenant. Guarded by the caller, like every other read.
 *
 * There is no listing of identities anywhere, and no read that answers "which
 * other tenants is this person in". `User.shared` says that the question of a
 * password reset has a different answer, and stops there.
 */
export interface UserDirectory {
  user(by: CommandContext, id: UserId): Promise<User | null>;
  users(by: CommandContext, listing?: Listing): Promise<readonly User[]>;
  byHandle(by: CommandContext, handle: string): Promise<User | null>;
}

export interface NewUser {
  readonly handle: string;
  readonly name: string;
  /** Set now, so the cashier can work the moment the manager walks away. */
  readonly password: string;
}

/**
 * What the **tenant's own administrator** does, and the vendor never does.
 *
 * `SEC-09` says that twice, and the acceptance criterion is the test of it: a
 * cashier is added and working at a register with no vendor involvement and no
 * internet connection. Nothing here asks anything of anywhere.
 *
 * Two guards run through it, beyond the right itself:
 *
 *   - **an administrator cannot reset the password of somebody who holds more
 *     than they do.** A reset is a sign-in as that person, so without this the
 *     right to reset a password is the right to become whoever you like;
 *   - **and cannot reset one at all if the sign-in behind it is shared.** That
 *     is `SEC-09`'s own sentence, and the reason is that the password would
 *     work in the other tenant too.
 */
export interface UserAdministration {
  /** Creates the person and the sign-in behind them, together. */
  enrol(by: CommandContext, input: NewUser): Promise<Result<User, SecRefusal>>;
  rename(by: CommandContext, id: UserId, name: string): Promise<Result<User, SecRefusal>>;
  deactivate(by: CommandContext, id: UserId): Promise<Result<User, SecRefusal>>;
  reactivate(by: CommandContext, id: UserId): Promise<Result<User, SecRefusal>>;
  resetPassword(
    by: CommandContext,
    id: UserId,
    password: string,
  ): Promise<Result<User, SecRefusal>>;
  forceSignOut(by: CommandContext, id: UserId): Promise<Result<User, SecRefusal>>;
  /**
   * Admits a sign-in that already exists into this tenant as well.
   *
   * **The system only**, and that is the point rather than an oversight. If a
   * tenant administrator could name any identifier and have that person appear
   * in their shop, every protection in this file would be reachable by typing:
   * attach somebody else's sign-in, give it a role, and wait for them to use
   * the password their own shop set. Sharing is composed where a deployment is
   * composed — an installer, a provisioning job, a migration — and never from
   * inside one of the tenants that would benefit.
   */
  admit(by: CommandContext, input: AdmittedUser): Promise<Result<User, SecRefusal>>;
}

export interface AdmittedUser {
  readonly user: UserId;
  readonly handle: string;
  readonly name: string;
}

/**
 * The sign-in itself, which belongs to the person rather than to a shop.
 *
 * `authenticate` is the one call in this module made when there is nobody yet:
 * it is handed the tenant whose register is asking, because a till belongs to
 * one shop, and a handle is that shop's name for a person rather than a name
 * the whole world shares.
 */
export interface Credentials {
  authenticate(
    by: CommandContext,
    handle: string,
    password: string,
  ): Promise<Result<Authenticated, SecRefusal>>;

  /** Always available to the person themselves, shared sign-in or not. */
  changeOwnPassword(
    by: CommandContext,
    current: string,
    next: string,
  ): Promise<Result<void, SecRefusal>>;

  readonly recovery: {
    /** Opened by an administrator of any tenant the sign-in belongs to. */
    open(by: CommandContext, user: UserId): Promise<Result<Recovery, SecRefusal>>;
    approve(by: CommandContext, id: RecoveryId): Promise<Result<Recovery, SecRefusal>>;
    /**
     * Sets the password, once **every** tenant has approved.
     *
     * Not "a majority" and not "the one that opened it": a sign-in that works
     * in three shops is three shops' risk, and any rule short of unanimity is a
     * rule under which two of them decide for the third.
     */
    complete(
      by: CommandContext,
      id: RecoveryId,
      password: string,
    ): Promise<Result<void, SecRefusal>>;
  };
}

export const Authorisation = contractKey<Authorisation>('sec.authorisation');

export const UserDirectory = contractKey<UserDirectory>('sec.user-directory');

export const UserAdministration = contractKey<UserAdministration>('sec.user-administration');

export const Credentials = contractKey<Credentials>('sec.credentials');

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
  /** `SEC-05`: re-authorisation, and an audit record, before it proceeds. */
  readonly sensitive?: boolean;
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

/**
 * The four, and the two things done to a person that are neither an edit nor a
 * deletion.
 *
 * `SEC-09` names both, and both are granted apart from `edit` because they are
 * what an administrator is most careful about handing out: whoever may reset a
 * password may sign in as that person, and whoever may force a sign-out can
 * empty a shop floor mid-shift. Flattening either into `edit` would hide the
 * one right in the role editor that a shop actually thinks about.
 */
export interface UserRights extends StructuralRights {
  readonly resetPassword: PermissionId;
  readonly forceSignOut: PermissionId;
}

type UserSeeds = Readonly<Record<keyof UserRights, readonly SeededRole[]>>;

/**
 * Built through the grammar like everything else, and through `operation()` for
 * the two that are not one of the five — which is what that function exists
 * for: leaving the grid is something a module has to say out loud.
 */
function userRights(seeds: UserSeeds): UserRights {
  const structural = rightsOver('user', seeds);
  const resetPassword = permissionId('sec', 'user', operation('reset-password'));
  const forceSignOut = permissionId('sec', 'user', operation('force-sign-out'));
  DECLARED.push(
    { id: resetPassword, seededFor: seeds.resetPassword, sensitive: true },
    { id: forceSignOut, seededFor: seeds.forceSignOut, sensitive: true },
  );
  return Object.freeze({ ...structural, resetPassword, forceSignOut });
}

export interface SecPermissions {
  readonly role: StructuralRights;
  readonly assignment: StructuralRights;
  readonly user: UserRights;
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
  /**
   * Staffing a shop with people, which is the manager's job and not the
   * vendor's — `SEC-09` says so twice.
   *
   * `delete` is a deactivation: a user is never removed, because every document
   * they ever wrote names them. Both operations are marked sensitive, which is
   * what `SEC-05` re-authorises at a till before it proceeds.
   */
  user: userRights({
    view: MANAGER,
    create: MANAGER,
    edit: MANAGER,
    withdraw: MANAGER,
    resetPassword: MANAGER,
    forceSignOut: MANAGER,
  }),
});

export const SEC_PERMISSION_SEEDS: readonly Declared[] = Object.freeze([...DECLARED]);
