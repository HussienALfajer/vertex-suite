import type { PermissionId, UserId } from '@vertex/contracts';
import { err } from '@vertex/kernel';
import {
  defineModule,
  provideContract,
  type CommandContext,
  type ModuleContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';
import { Organisation } from '@vertex/sys/contract';

import {
  Authorisation,
  Credentials,
  RoleAdministration,
  RoleDirectory,
  SEC_PERMISSION_SEEDS,
  TENANT_WIDE,
  UserAdministration,
  UserDirectory,
  type AdmittedUser,
  type Listing,
  type NewAssignment,
  type NewRole,
  type NewUser,
  type RecordSession,
  type RecoveryId,
  type RoleId,
  type Where,
} from './contract.js';
import { assignRole, placesNamed, withdrawAssignment } from './assignments.js';
import { decideFor, reachFor } from './decide.js';
import { assignmentsIn, roleIn, rolesIn, userIn, usersIn } from './records.js';
import {
  defineRole,
  grantRights,
  renameRole,
  revokeRights,
  seedRoles,
  setRoleActive,
} from './roles.js';
import {
  admitUser,
  approveRecovery,
  authenticate,
  changeOwnPassword,
  completeRecovery,
  enrolUser,
  forceSignOut,
  normaliseHandle,
  openRecovery,
  renameUser,
  resetPassword,
  setUserActive,
} from './users.js';

export * from './contract.js';

/**
 * What `SEC` declares, as the registry reports it.
 *
 * `sensitive` travels with the rest. It was once dropped here, so the registry
 * reported a password reset and a forced sign-out as ordinary rights — to the
 * role editor that shows the mark, and to `SEC-05`'s re-authorisation that
 * will key on it.
 */
function permissions(): readonly PermissionDeclaration[] {
  return SEC_PERMISSION_SEEDS.map(({ id, seededFor, sensitive }) => ({
    id,
    labelKey: `permission.${id}`,
    seededFor,
    ...(sensitive === undefined ? {} : { sensitive }),
  }));
}

function visible<T extends { readonly active: boolean }>(
  records: readonly T[],
  listing: Listing | undefined,
): readonly T[] {
  return listing?.including === 'all' ? records : records.filter((one) => one.active);
}

/**
 * `SEC`, as an edition hosts it.
 *
 * It depends on `SYS` and reaches it through the published contract alone —
 * which is what makes it the first module in this repository that has anywhere
 * to reach, and therefore the first live test of `modules.md` §4 rather than a
 * rule about a future.
 *
 * No migrations and no events, for the reasons `SYS` gives in the same place:
 * there is no schema until a driver exists, and a placeholder identifier would
 * permanently burn the name the real one wants. Nothing subscribes to a role
 * being granted yet either — `SEC-06`'s audit trail is `U23`, and an event
 * nobody listens to is a name to keep compatible in exchange for nothing.
 */
export function secModule<Session extends RecordSession>(): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'SEC',
    labelKey: 'module.sec',
    dependsOn: ['SYS'],
    permissions: permissions(),
    provides: [
      provideContract(Authorisation, (context: ModuleContext<Session>) => {
        // The set is built once, from what this edition declared, and asked of
        // every decision: a right no module defines can never be granted, so
        // answering "not permitted" for one would hide a host's typo behind a
        // disabled button.
        const declared = new Set(context.declaredPermissions.map((one) => one.id));

        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          may: (by: CommandContext, right: PermissionId, where?: Where) =>
            read(by, (session) => decideFor(session, by, declared, right, where).granted),
          decide: (by: CommandContext, right: PermissionId, where?: Where) =>
            read(by, (session) => decideFor(session, by, declared, right, where)),
          reachOf: (by: CommandContext, right: PermissionId) =>
            read(by, (session) =>
              // The system reaches everywhere, stated as one unconfined grant
              // so that a caller has one shape to read rather than two.
              by.actor === null ? [TENANT_WIDE] : reachFor(session, by.tenant, by.actor, right),
            ),
        } satisfies Authorisation;
      }),

      provideContract(RoleDirectory, (context: ModuleContext<Session>) => {
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          role: (by: CommandContext, id: RoleId) =>
            read(by, (session) => roleIn(session, by.tenant, id)),
          roles: (by: CommandContext, listing?: Listing) =>
            read(by, (session) => visible(rolesIn(session, by.tenant), listing)),
          assignmentsOf: (by: CommandContext, user: UserId, listing?: Listing) =>
            read(by, (session) =>
              visible(
                assignmentsIn(session, by.tenant).filter((one) => one.user === user),
                listing,
              ),
            ),
          holdersOf: (by: CommandContext, role: RoleId, listing?: Listing) =>
            read(by, (session) =>
              visible(
                assignmentsIn(session, by.tenant).filter((one) => one.role === role),
                listing,
              ),
            ),
        } satisfies RoleDirectory;
      }),

      provideContract(RoleAdministration, (context: ModuleContext<Session>) => {
        const declarations = context.declaredPermissions;
        const declared = new Set(declarations.map((one) => one.id));

        const run = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          roles: {
            seed: (by: CommandContext) =>
              run(by, (session) => seedRoles(session, by, declarations, declared)),
            define: (by: CommandContext, input: NewRole) =>
              run(by, (session) => defineRole(session, by, declared, input)),
            rename: (by: CommandContext, id: RoleId, name: string) =>
              run(by, (session) => renameRole(session, by, declared, id, name)),
            grant: (by: CommandContext, id: RoleId, rights: readonly PermissionId[]) =>
              run(by, (session) => grantRights(session, by, declared, id, rights)),
            revoke: (by: CommandContext, id: RoleId, rights: readonly PermissionId[]) =>
              run(by, (session) => revokeRights(session, by, declared, id, rights)),
            withdraw: (by: CommandContext, id: RoleId) =>
              run(by, (session) => setRoleActive(session, by, declared, id, false)),
            restore: (by: CommandContext, id: RoleId) =>
              run(by, (session) => setRoleActive(session, by, declared, id, true)),
          },
          assignments: {
            // The one command that asks another module anything. `SYS` confirms
            // the places before this command's transaction opens, because its
            // contract opens one of its own for every read and two at once for
            // one command is a habit that costs a connection per call the day
            // the drivers arrive.
            assign: async (by: CommandContext, input: NewAssignment) => {
              const places = await placesNamed(
                context.require(Organisation),
                by,
                input.confinement,
              );
              if (places !== null) return err(places);
              return run(by, (session) => assignRole(session, by, input));
            },
            withdraw: (by: CommandContext, user: UserId, role: RoleId) =>
              run(by, (session) => withdrawAssignment(session, by, user, role)),
          },
        } satisfies RoleAdministration;
      }),

      provideContract(UserDirectory, (context: ModuleContext<Session>) => {
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          user: (by: CommandContext, id: UserId) =>
            read(by, (session) => userIn(session, by.tenant, id)),
          users: (by: CommandContext, listing?: Listing) =>
            read(by, (session) => visible(usersIn(session, by.tenant), listing)),
          byHandle: (by: CommandContext, handle: string) =>
            read(by, (session) => {
              const wanted = normaliseHandle(handle);
              if (wanted === null) return null;
              return usersIn(session, by.tenant).find((one) => one.handle === wanted) ?? null;
            }),
        } satisfies UserDirectory;
      }),

      provideContract(UserAdministration, (context: ModuleContext<Session>) => {
        const declared = new Set(context.declaredPermissions.map((one) => one.id));
        const run = <T>(
          by: CommandContext,
          work: (session: Session) => Promise<T> | T,
        ): Promise<T> => context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          enrol: (by: CommandContext, input: NewUser) =>
            run(by, (session) => enrolUser(session, by, declared, input)),
          rename: (by: CommandContext, id: UserId, name: string) =>
            run(by, (session) => renameUser(session, by, declared, id, name)),
          deactivate: (by: CommandContext, id: UserId) =>
            run(by, (session) => setUserActive(session, by, declared, id, false)),
          reactivate: (by: CommandContext, id: UserId) =>
            run(by, (session) => setUserActive(session, by, declared, id, true)),
          resetPassword: (by: CommandContext, id: UserId, password: string) =>
            run(by, (session) =>
              resetPassword(session, by, declared, id, password, context.clock.now()),
            ),
          forceSignOut: (by: CommandContext, id: UserId) =>
            // The moment comes from the clock this module was handed, never from
            // the machine: a register's own clock is a claim, and this stamp is
            // what says whose sessions are over.
            run(by, (session) => forceSignOut(session, by, declared, id, context.clock.now())),
          admit: (by: CommandContext, input: AdmittedUser) =>
            run(by, (session) => admitUser(session, by, input)),
        } satisfies UserAdministration;
      }),

      provideContract(Credentials, (context: ModuleContext<Session>) => {
        const declared = new Set(context.declaredPermissions.map((one) => one.id));
        const run = <T>(
          by: CommandContext,
          work: (session: Session) => Promise<T> | T,
        ): Promise<T> => context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          authenticate: (by: CommandContext, handle: string, password: string) =>
            run(by, (session) => authenticate(session, by, handle, password, context.clock.now())),
          changeOwnPassword: (by: CommandContext, current: string, next: string) =>
            run(by, (session) => changeOwnPassword(session, by, current, next)),
          recovery: {
            open: (by: CommandContext, user: UserId) =>
              run(by, (session) => openRecovery(session, by, declared, user, context.clock.now())),
            approve: (by: CommandContext, id: RecoveryId) =>
              run(by, (session) => approveRecovery(session, by, declared, id, context.clock.now())),
            complete: (by: CommandContext, id: RecoveryId, password: string) =>
              run(by, (session) =>
                completeRecovery(session, by, declared, id, password, context.clock.now()),
              ),
          },
        } satisfies Credentials;
      }),
    ],
  });
}
