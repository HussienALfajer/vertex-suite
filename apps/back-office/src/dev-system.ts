import { newId, ok, orThrow, refuse, systemClock, type Clock, type Id } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  defineModule,
  provideContract,
  type Authoriser,
  type CommandContext,
  type MemorySession,
  type PermissionDeclaration,
} from '@vertex/platform';
import { OWNER, SEEDED_ROLES, type PermissionId } from '@vertex/contracts';
import {
  Authorisation,
  SEC_PERMISSIONS,
  SEC_PERMISSION_SEEDS,
  TENANT_WIDE,
  type Assignment,
  type Role,
  type User,
} from '@vertex/sec/contract';
import {
  DocumentNumbering,
  Organisation,
  OrganisationAdministration,
  sysModule,
  type Register,
} from '@vertex/sys';

import type {
  DeclaredRight,
  OrganisationOfRecord,
  SignInAttempt,
  SystemOfRecord,
  UsersOfRecord,
} from './system.js';

/**
 * A development stand-in for the store node.
 *
 * It answers the port two different ways, and the difference between them is
 * the difference between the two modules behind it.
 *
 * **`SEC` is stood in for, because `SEC` cannot run here at all** — see
 * `system.ts`. It hashes passwords with scrypt from Node's standard library,
 * which is exactly the property that makes a stolen database useless and
 * exactly the property no browser has. So what is reproduced below is not the
 * authority but the one thing the sign-in screen is written against: the
 * refusals `SEC` actually returns. `composition.test.ts` pins those codes on the
 * real module, in Node, where it can run; if `SEC` ever answered differently,
 * that test fails rather than this stand-in quietly teaching the screen a lie.
 *
 * **`SYS` is not stood in for. It is the real one, hosted here.** Nothing in it
 * needs a machine: it is an ordinary module over the memory store the platform
 * ships, and it runs in a browser exactly as it runs on a store node. Writing a
 * fake organisation would have meant writing a second implementation of every
 * rule the screens are built on — that two branches in one company may not
 * share a name, that a location cannot be opened in a branch that is shut, that
 * nothing is ever deleted — and a screen developed against a second
 * implementation is a screen developed against a guess. The composition here is
 * the real edition composition, the real registry and the real transactor, for
 * the same reason `edition.fixture.ts` is.
 *
 * All of it goes when `U07` brings the store node and a transport. The screens
 * do not change: they never named anything in this file.
 */

export interface StandInPerson {
  readonly handle: string;
  readonly password: string;
  /** What the shop calls them. Defaults to the handle, for a fixture that has nothing else to say. */
  readonly name?: string;
  /** Withdrawn from this shop, and still able to prove who they are (`SEC-09`). */
  readonly active?: boolean;
}

export interface StandInOptions {
  readonly people: readonly StandInPerson[];
  readonly clock?: Clock;
}

/**
 * Everything, to everybody, because there is nobody here to ask.
 *
 * The real answer is `SEC`'s and `SEC` is not in this browser, so this is the
 * one thing in the file that is a fiction rather than a stand-in — and it is a
 * fiction that can only ever be too permissive, which is the safe direction for
 * a development harness and the unusable direction for a shop. The rights
 * themselves are enforced where they are enforced: `SYS` asks on every command,
 * and `composition.test.ts` runs the real `SEC` against the real `SYS` to prove
 * that a cashier is refused what a cashier does not hold.
 */
const ALWAYS: Authoriser = { may: () => Promise.resolve(true) };

/**
 * `SEC`'s own declarations, converted the same way `secModule()` converts
 * them (`packages/modules/sec/src/index.ts`).
 *
 * **Real, not stood in for.** `SEC-01` seeds a role from what an edition
 * declared and `SEC-02` refuses a grant naming a right nothing declared, and
 * both would be answering a shorter list than a real edition's if this browser
 * reported only `SYS`'s. The one thing not composed here is the authority that
 * *acts* on the declarations — nothing in this file enforces one (`ALWAYS`,
 * below) — but the declarations themselves are not a fiction to stand in for.
 */
function secPermissionDeclarations(): readonly PermissionDeclaration[] {
  return SEC_PERMISSION_SEEDS.map(({ id, seededFor, sensitive }) => ({
    id,
    labelKey: `permission.${id}`,
    seededFor,
    ...(sensitive === undefined ? {} : { sensitive }),
  }));
}

function authorityStandIn() {
  return defineModule<MemorySession>({
    code: 'SEC',
    labelKey: 'module.sec',
    permissions: secPermissionDeclarations(),
    // The key the real `SEC` publishes, so the registry is wired here exactly as
    // a store node wires it — and so swapping the real module in is a change of
    // catalogue and nothing else.
    provides: [provideContract(Authorisation, () => ALWAYS)],
  });
}

/**
 * The people and their sign-ins, `SEC-09` by hand.
 *
 * **This is not a second implementation of `SEC`.** It reproduces the
 * structural rules a screen actually has to react to while somebody is typing —
 * a handle already taken, a password too short, the shop's last owner standing
 * down — and deliberately nothing else: no permission escalation, because
 * nothing in this file enforces a permission in the first place (`ALWAYS`,
 * above); no cross-tenant sharing, because this harness never holds more than
 * one tenant, so `User.shared` is always false here. `composition.test.ts`
 * pins every rule claimed below against the real module, in Node, where it can
 * run — including the password length, which `@vertex/sec` does not export and
 * is therefore repeated here by number rather than by reference.
 */
const MINIMUM_PASSWORD_LENGTH = 8;

/** The same fold `SEC` applies before comparing two handles, or a handle to itself. */
function foldHandle(raw: string): string | null {
  const handle = raw.normalize('NFC').trim().toLowerCase();
  return handle === '' ? null : handle;
}

function namedTrim(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The seven of `SEC-01`, seeded once, holding what the edition actually
 * declared — `roles.ts`'s own `seededRights`, by hand: the owner holds every
 * right this edition's two composed modules declare, computed rather than
 * listed, and every other seeded role holds what each declaration names it
 * for. This stand-in offers no way to define an eighth from a blank slate the
 * real seeding also refuses.
 */
function seedRoles(
  tenant: Id<'tenant'>,
  declarations: readonly PermissionDeclaration[],
): readonly Role[] {
  return SEEDED_ROLES.map((seeded) => {
    const rights = Object.freeze(
      declarations
        .filter((one) => seeded === OWNER || (one.seededFor ?? []).includes(seeded))
        .map((one) => one.id as PermissionId),
    );
    return {
      id: newId<'role'>(),
      tenant,
      seeded,
      // Displayed through the terminology layer (`role.<seeded>`), like the real
      // module's own seeding: nobody has renamed one, because there is nowhere
      // here to.
      name: null,
      rights,
      seededWith: rights,
      active: true,
    };
  });
}

export function developmentSystem(options: StandInOptions): SystemOfRecord {
  const clock = options.clock ?? systemClock;
  const tenant = newId<'tenant'>();

  const catalogue = [sysModule<MemorySession>(), authorityStandIn()];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC'] }),
    (refusal) => new Error(`The edition would not compose: ${refusal.code}`),
  );

  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw new Error(`A subscriber failed: ${String(failure.cause)}`);
    },
  });
  const store = createMemoryStore();
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock,
    onEffectFailure: (failure) => {
      throw new Error(`An effect failed: ${String(failure.cause)}`);
    },
  });
  const registry = createRegistry({
    catalogue,
    plan,
    bus,
    transactor,
    clock,
    authorisedBy: Authorisation,
  });

  const read = registry.require(Organisation);
  const admin = registry.require(OrganisationAdministration);
  // `next` is not reached from here and must not be: a number is taken on the
  // machine that prints the document, inside that document's own transaction.
  // What the back office asks this contract are the two questions that take
  // nothing — what is configured, and what a format would print.
  const numbering = registry.require(DocumentNumbering);

  /**
   * Who is asking, which is the transport's business and not a screen's.
   *
   * Set when somebody signs in, exactly as a session on the other side of a
   * real transport would set it. Reading it before then is not a refusal and
   * not something to render — it is a screen that was mounted without a
   * session, which is a defect, so it throws.
   */
  let actor: Id<'user'> | null = null;
  const asWhoeverSignedIn = (): CommandContext => {
    if (actor === null) {
      throw new Error('The organisation was read before anybody signed in.');
    }
    return commandContext({ tenant, actor });
  };

  const by = asWhoeverSignedIn;

  /**
   * A machine's identifier, as it crosses the process boundary.
   *
   * The brand is a compile-time claim and nothing at run time, and what reaches
   * here is text somebody read off a till's screen — so asserting it is honest
   * about what this is rather than a shortcut. The value is judged by `SYS`,
   * which refuses an identifier it could not have issued. `U07` replaces this
   * file with a transport, and JSON carries no brands either: the assertion
   * moves, the check does not.
   */
  const asMachine = (device: string): NonNullable<Register['heldBy']> =>
    device as NonNullable<Register['heldBy']>;

  const organisation: OrganisationOfRecord = {
    companies: {
      list: (listing) => read.companies(by(), listing),
      register: (input) => admin.companies.register(by(), input),
      rename: (id, name) => admin.companies.rename(by(), id, name),
      deactivate: (id) => admin.companies.deactivate(by(), id),
      reactivate: (id) => admin.companies.reactivate(by(), id),
    },
    branches: {
      list: (listing) => read.branches(by(), listing),
      open: (input) => admin.branches.open(by(), input),
      rename: (id, name) => admin.branches.rename(by(), id, name),
      readdress: (id, address) => admin.branches.readdress(by(), id, address),
      locate: (id, point) => admin.branches.locate(by(), id, point),
      deactivate: (id) => admin.branches.deactivate(by(), id),
      reactivate: (id) => admin.branches.reactivate(by(), id),
    },
    locations: {
      list: (branch, listing) => read.locations(by(), branch, listing),
      open: (input) => admin.locations.open(by(), input),
      rename: (id, name) => admin.locations.rename(by(), id, name),
      readdress: (id, address) => admin.locations.readdress(by(), id, address),
      locate: (id, point) => admin.locations.locate(by(), id, point),
      deactivate: (id) => admin.locations.deactivate(by(), id),
      reactivate: (id) => admin.locations.reactivate(by(), id),
    },
    registers: {
      list: (branch, listing) => read.registers(by(), branch, listing),
      open: (input) => admin.registers.open(by(), input),
      rename: (id, name) => admin.registers.rename(by(), id, name),
      assignDevice: (id, device) => admin.registers.assignDevice(by(), id, asMachine(device)),
      deactivate: (id) => admin.registers.deactivate(by(), id),
      reactivate: (id) => admin.registers.reactivate(by(), id),
    },
    numbering: {
      configured: (branch) => numbering.configured(by(), branch),
      preview: (scope, format) => numbering.preview(by(), scope, format),
      define: (scope, format) => admin.numbering.define(by(), scope, format),
    },
    profile: {
      read: (company) => read.profile(by(), company),
      revise: (company, changes) => admin.profile.revise(by(), company, changes),
    },
  };

  // The people store: `SEC`'s own vocabulary, kept by hand for the reason the
  // file's own opening comment gives. Passwords are plain text, on purpose —
  // there is no hashing to stand in for without the runtime `SEC` uses, and a
  // fake hash would only dress up a fiction as a fact nobody can check.
  const users = new Map<Id<'user'>, User>();
  const passwords = new Map<Id<'user'>, string>();
  let roles: readonly Role[] = seedRoles(tenant, registry.permissions);
  let assignments: readonly Assignment[] = [];

  const ownerRole = roles.find((one) => one.seeded === 'owner');
  if (ownerRole === undefined) throw new Error('Seeding produced no owner role.');
  const ownerRoleId = ownerRole.id;

  // The people this shop already has, standing in the owner's role tenant-wide
  // — a shop that a fixture opens is a shop `SYS-13`'s first run would have
  // already given one to, and every existing test signs in as exactly this.
  for (const person of options.people) {
    const handle = foldHandle(person.handle);
    if (handle === null) throw new Error(`A stand-in person needs a handle: "${person.handle}".`);
    const id = newId<'user'>();
    users.set(id, {
      tenant,
      id,
      handle,
      name: person.name ?? person.handle,
      active: person.active ?? true,
      sessionsVoidBefore: null,
      shared: false,
    });
    passwords.set(id, person.password);
    assignments = [
      ...assignments,
      { tenant, user: id, role: ownerRoleId, confinement: TENANT_WIDE, active: true },
    ];
  }

  /**
   * Whether some other active person would still hold `keystone` if this
   * change went through — `users.ts`'s, `roles.ts`'s and `assignments.ts`'s own
   * `wouldStrandTheTenant`, by hand, in the one shape that answers all three.
   *
   * Three different changes ask this the same question: a role losing rights
   * (`role`, `afterRights` — what it is **about to** hold), one assignment
   * being withdrawn (`skip: { user, role }`), and a person leaving the shop
   * entirely (`skip: { user }` alone, which counts out every role that person
   * holds rather than one). All three are the same rule underneath: a tenant
   * that has lost its last way to edit a role has no way back that does not
   * involve a database client (`SEC-09`, `SYS-09`, all of them).
   */
  function keystoneWouldRemainHeld(
    keystone: PermissionId,
    change:
      | { readonly role: Id<'role'>; readonly afterRights: readonly PermissionId[] }
      | { readonly skip: { readonly user: Id<'user'>; readonly role?: Id<'role'> } },
  ): boolean {
    const holds = (role: Id<'role'>): boolean => {
      if ('role' in change && role === change.role) return change.afterRights.includes(keystone);
      const candidate = roles.find((one) => one.id === role);
      return candidate !== undefined && candidate.active && candidate.rights.includes(keystone);
    };
    return assignments.some((one) => {
      if (
        'skip' in change &&
        one.user === change.skip.user &&
        (change.skip.role === undefined || one.role === change.skip.role)
      ) {
        return false;
      }
      return one.active && (users.get(one.user)?.active ?? false) && holds(one.role);
    });
  }

  function without<T>(values: readonly T[], removed: readonly T[]): readonly T[] {
    return values.filter((one) => !removed.includes(one));
  }

  function withAll<T>(values: readonly T[], added: readonly T[]): readonly T[] {
    return [...values, ...added.filter((one) => !values.includes(one))];
  }

  const usersPort: UsersOfRecord = {
    list: (listing) => {
      by();
      const all = [...users.values()];
      return Promise.resolve(listing?.including === 'all' ? all : all.filter((one) => one.active));
    },

    enrol: (input) => {
      by();
      const handle = foldHandle(input.handle);
      if (handle === null) return Promise.resolve(refuse('sec.handle-required'));
      const name = namedTrim(input.name);
      if (name === null) return Promise.resolve(refuse('sec.user-name-required'));
      if (input.password.length < MINIMUM_PASSWORD_LENGTH) {
        return Promise.resolve(
          refuse('sec.password-too-short', { atLeast: MINIMUM_PASSWORD_LENGTH }),
        );
      }
      // Unique within the tenant, the same rule `SEC` states for the same reason.
      if ([...users.values()].some((one) => one.handle === handle)) {
        return Promise.resolve(refuse('sec.handle-taken', { handle }));
      }

      const id = newId<'user'>();
      const user: User = {
        tenant,
        id,
        handle,
        name,
        active: true,
        sessionsVoidBefore: null,
        shared: false,
      };
      users.set(id, user);
      passwords.set(id, input.password);
      return Promise.resolve(ok(user));
    },

    rename: (id, name) => {
      by();
      const user = users.get(id);
      if (user === undefined) return Promise.resolve(refuse('sec.user-not-found', { user: id }));
      const trimmed = namedTrim(name);
      if (trimmed === null) return Promise.resolve(refuse('sec.user-name-required'));
      const updated: User = { ...user, name: trimmed };
      users.set(id, updated);
      return Promise.resolve(ok(updated));
    },

    deactivate: (id) => {
      by();
      const user = users.get(id);
      if (user === undefined) return Promise.resolve(refuse('sec.user-not-found', { user: id }));

      // `users.ts`'s own `wouldStrandTheTenant`: the question is whether
      // **this person** currently holds `sec.role.edit` through any active
      // role, not whether the role they hold happens to be named "owner" —
      // the seven seeded roles are ordinary editable rows from the moment
      // they exist, and a shop that moved role-editing onto a custom role is
      // exactly as strandable as one that never touched the seeded owner.
      const keystone = SEC_PERMISSIONS.role.edit;
      const holdsIt = assignments.some((one) => {
        if (one.user !== id || !one.active) return false;
        const role = roles.find((candidate) => candidate.id === one.role);
        return role !== undefined && role.active && role.rights.includes(keystone);
      });
      if (holdsIt && !keystoneWouldRemainHeld(keystone, { skip: { user: id } })) {
        return Promise.resolve(refuse('sec.last-owner', { user: id }));
      }

      const updated: User = { ...user, active: false };
      users.set(id, updated);
      return Promise.resolve(ok(updated));
    },

    reactivate: (id) => {
      by();
      const user = users.get(id);
      if (user === undefined) return Promise.resolve(refuse('sec.user-not-found', { user: id }));
      const updated: User = { ...user, active: true };
      users.set(id, updated);
      return Promise.resolve(ok(updated));
    },

    resetPassword: (id, password) => {
      by();
      const user = users.get(id);
      if (user === undefined) return Promise.resolve(refuse('sec.user-not-found', { user: id }));
      if (password.length < MINIMUM_PASSWORD_LENGTH) {
        return Promise.resolve(
          refuse('sec.password-too-short', { atLeast: MINIMUM_PASSWORD_LENGTH }),
        );
      }
      passwords.set(id, password);
      return Promise.resolve(ok(user));
    },

    forceSignOut: (id) => {
      by();
      const user = users.get(id);
      if (user === undefined) return Promise.resolve(refuse('sec.user-not-found', { user: id }));
      const updated: User = { ...user, sessionsVoidBefore: clock.now() };
      users.set(id, updated);
      return Promise.resolve(ok(updated));
    },

    roles: {
      list: (listing) => {
        by();
        return Promise.resolve(
          listing?.including === 'all' ? roles : roles.filter((one) => one.active),
        );
      },

      // What this edition's two composed modules actually declared, and
      // nothing invented here — the same list `SEC-01` would seed the seven
      // from, and `SEC-02` would refuse a grant naming a right outside of.
      rights: () => {
        by();
        const declared: readonly DeclaredRight[] = registry.permissions.map((one) => ({
          id: one.id as PermissionId,
          sensitive: one.sensitive ?? false,
        }));
        return Promise.resolve(declared);
      },

      define: (input) => {
        by();
        const name = namedTrim(input.name);
        if (name === null) return Promise.resolve(refuse('sec.role-name-required'));

        const declared = new Set(registry.permissions.map((one) => one.id));
        const rights = input.rights ?? [];
        const undeclared = rights.find((one) => !declared.has(one));
        if (undeclared !== undefined) {
          return Promise.resolve(refuse('sec.right-undeclared', { right: undeclared }));
        }

        const role: Role = {
          id: newId<'role'>(),
          tenant,
          seeded: null,
          name,
          rights: Object.freeze([...rights]),
          seededWith: Object.freeze([]),
          active: true,
        };
        roles = [...roles, role];
        return Promise.resolve(ok(role));
      },

      rename: (id, name) => {
        by();
        const role = roles.find((one) => one.id === id);
        if (role === undefined) return Promise.resolve(refuse('sec.role-not-found', { role: id }));
        const trimmed = namedTrim(name);
        if (trimmed === null) return Promise.resolve(refuse('sec.role-name-required'));

        const updated: Role = { ...role, name: trimmed };
        roles = roles.map((one) => (one.id === id ? updated : one));
        return Promise.resolve(ok(updated));
      },

      grant: (id, rights) => {
        by();
        const role = roles.find((one) => one.id === id);
        if (role === undefined) return Promise.resolve(refuse('sec.role-not-found', { role: id }));
        if (!role.active) return Promise.resolve(refuse('sec.role-withdrawn', { role: id }));

        const declared = new Set(registry.permissions.map((one) => one.id));
        const undeclared = rights.find((one) => !declared.has(one));
        if (undeclared !== undefined) {
          return Promise.resolve(refuse('sec.right-undeclared', { right: undeclared }));
        }

        const updated: Role = { ...role, rights: Object.freeze(withAll(role.rights, rights)) };
        roles = roles.map((one) => (one.id === id ? updated : one));
        return Promise.resolve(ok(updated));
      },

      // Not symmetrical with `grant`, the same way the real module states it:
      // taking a right out asks nothing of the caller beyond the role existing,
      // because the moment it matters is the one where a right has to come off
      // quickly.
      revoke: (id, rights) => {
        by();
        const role = roles.find((one) => one.id === id);
        if (role === undefined) return Promise.resolve(refuse('sec.role-not-found', { role: id }));

        const keystone = SEC_PERMISSIONS.role.edit;
        if (role.rights.includes(keystone) && rights.includes(keystone)) {
          const after = without(role.rights, rights);
          if (!keystoneWouldRemainHeld(keystone, { role: id, afterRights: after })) {
            return Promise.resolve(refuse('sec.last-owner', { role: id }));
          }
        }

        const updated: Role = { ...role, rights: Object.freeze(without(role.rights, rights)) };
        roles = roles.map((one) => (one.id === id ? updated : one));
        return Promise.resolve(ok(updated));
      },

      withdraw: (id) => {
        by();
        const role = roles.find((one) => one.id === id);
        if (role === undefined) return Promise.resolve(refuse('sec.role-not-found', { role: id }));

        const keystone = SEC_PERMISSIONS.role.edit;
        if (
          role.active &&
          role.rights.includes(keystone) &&
          !keystoneWouldRemainHeld(keystone, { role: id, afterRights: [] })
        ) {
          return Promise.resolve(refuse('sec.last-owner', { role: id }));
        }

        // Idempotent, like every withdrawal here: `SYN-02` replays commands.
        const updated: Role = { ...role, active: false };
        roles = roles.map((one) => (one.id === id ? updated : one));
        return Promise.resolve(ok(updated));
      },

      restore: (id) => {
        by();
        const role = roles.find((one) => one.id === id);
        if (role === undefined) return Promise.resolve(refuse('sec.role-not-found', { role: id }));

        const updated: Role = { ...role, active: true };
        roles = roles.map((one) => (one.id === id ? updated : one));
        return Promise.resolve(ok(updated));
      },
    },

    assignments: {
      of: (user) => {
        by();
        return Promise.resolve(assignments.filter((one) => one.user === user && one.active));
      },

      holdersOf: (role) => {
        by();
        return Promise.resolve(assignments.filter((one) => one.role === role && one.active));
      },

      assign: async (input) => {
        by();
        if (input.confinement.kind === 'branches' && input.confinement.branches.length === 0) {
          return refuse('sec.confinement-empty');
        }

        const role = roles.find((one) => one.id === input.role);
        if (role === undefined) return refuse('sec.role-not-found', { role: input.role });
        if (!role.active) return refuse('sec.role-withdrawn', { role: input.role });

        // Validated against the real `SYS` this browser hosts for real (unlike
        // `SEC`): a confinement naming a branch that is not in this tenant, or
        // one that is shut, is not a reach anybody meant to grant.
        if (input.confinement.kind === 'branches') {
          for (const branch of input.confinement.branches) {
            const found = await read.branch(by(), branch);
            if (found === null) return refuse('sec.branch-not-found', { branch });
            if (!found.active) return refuse('sec.branch-inactive', { branch: found.name });
          }
        }

        // Assigning a role the user already holds replaces its confinement,
        // the same rule the real contract states.
        const assignment: Assignment = {
          tenant,
          user: input.user,
          role: input.role,
          confinement: input.confinement,
          active: true,
        };
        const already = assignments.some(
          (one) => one.user === input.user && one.role === input.role,
        );
        assignments = already
          ? assignments.map((one) =>
              one.user === input.user && one.role === input.role ? assignment : one,
            )
          : [...assignments, assignment];
        return ok(assignment);
      },

      withdraw: (user, role) => {
        by();
        const existing = assignments.find((one) => one.user === user && one.role === role);
        if (existing === undefined)
          return Promise.resolve(refuse('sec.assignment-not-found', { role }));
        // Already withdrawn is done, as it is in `SEC` (`assignments.ts`): a
        // replayed or repeated command succeeds over a state that is already
        // what it asked for. The stand-in refused it, and taught the screen a
        // refusal the real module never gives.
        if (!existing.active) return Promise.resolve(ok(existing));

        // `assignments.ts`'s own `wouldStrandTheTenant`, one level out from the
        // role's: standing down the shop's last holder of `sec.role.edit` has no
        // way back that does not involve a database client, whether it is done
        // by editing the role or by unassigning the one person who holds it.
        // Only this role's own hold on the keystone matters — an assignment to a
        // role that never granted it cannot be the one that strands the tenant.
        const keystone = SEC_PERMISSIONS.role.edit;
        const grantsKeystone = roles.find((one) => one.id === role)?.rights.includes(keystone);
        if (
          grantsKeystone === true &&
          !keystoneWouldRemainHeld(keystone, { skip: { user, role } })
        ) {
          return Promise.resolve(refuse('sec.last-owner', { user }));
        }

        const withdrawn: Assignment = { ...existing, active: false };
        assignments = assignments.map((one) => (one === existing ? withdrawn : one));
        return Promise.resolve(ok(withdrawn));
      },
    },
  };

  return {
    signIn({ handle, password }: SignInAttempt) {
      // A new attempt is nobody until it succeeds. A failed one once left the
      // previous person in place, answering for whoever typed next.
      actor = null;
      const wanted = foldHandle(handle);
      const found = [...users.entries()].find(([, user]) => user.handle === wanted);

      // One refusal for an unknown name and for a wrong password, which is
      // `SEC`'s own rule: answering differently for a name that does not exist
      // is a list of everybody who does, readable by anybody who can reach a
      // till. The stand-in has to keep the rule or the screen is never tested
      // against it.
      if (found === undefined || passwords.get(found[0]) !== password) {
        return Promise.resolve(refuse('sec.password-wrong'));
      }

      const [id, user] = found;

      // Only somebody who has the password learns that the account is
      // withdrawn — refusing earlier would tell whoever is guessing which names
      // are real.
      if (!user.active) return Promise.resolve(refuse('sec.user-inactive', { user: id }));

      actor = id;
      return Promise.resolve(ok({ user: id, tenant, at: clock.now() }));
    },

    signOut() {
      actor = null;
      return Promise.resolve();
    },

    // `Credentials.changeOwnPassword`, by hand: available to whoever is
    // signed in, over their own record alone, and asking for their current
    // password rather than any right at all — the one command in `SEC` whose
    // subject is always the caller.
    changeOwnPassword(current, next) {
      if (actor === null) return Promise.resolve(refuse('sec.no-actor'));
      if (next.length < MINIMUM_PASSWORD_LENGTH) {
        return Promise.resolve(
          refuse('sec.password-too-short', { atLeast: MINIMUM_PASSWORD_LENGTH }),
        );
      }

      const user = users.get(actor);
      if (user === undefined) return Promise.resolve(refuse('sec.user-not-found', { user: actor }));
      if (!user.active) return Promise.resolve(refuse('sec.user-inactive', { user: actor }));
      if (passwords.get(actor) !== current) return Promise.resolve(refuse('sec.password-wrong'));

      passwords.set(actor, next);
      return Promise.resolve(ok(undefined));
    },

    organisation,
    users: usersPort,
  };
}
