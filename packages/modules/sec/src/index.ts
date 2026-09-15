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
  RoleAdministration,
  RoleDirectory,
  SEC_PERMISSION_SEEDS,
  TENANT_WIDE,
  type Listing,
  type NewAssignment,
  type NewRole,
  type RecordSession,
  type RoleId,
  type Where,
} from './contract.js';
import { assignRole, placesNamed, withdrawAssignment } from './assignments.js';
import { decideFor, reachFor } from './decide.js';
import { assignmentsIn, roleIn, rolesIn } from './records.js';
import {
  defineRole,
  grantRights,
  renameRole,
  revokeRights,
  seedRoles,
  setRoleActive,
} from './roles.js';

export * from './contract.js';

function permissions(): readonly PermissionDeclaration[] {
  return SEC_PERMISSION_SEEDS.map(({ id, seededFor }) => ({
    id,
    labelKey: `permission.${id}`,
    seededFor,
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
    ],
  });
}
