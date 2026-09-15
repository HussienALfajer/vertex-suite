import type { BranchId, CompanyId, LocationId, RegisterId } from '@vertex/contracts';
import {
  defineModule,
  provideContract,
  type CommandContext,
  type ModuleContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';

import {
  Organisation,
  OrganisationAdministration,
  SYS_PERMISSION_IDS,
  type NewBranch,
  type NewCompany,
  type NewLocation,
  type NewRegister,
  type ProfileRevision,
} from './contract.js';
import { profileIn, reviseProfile, seedProfile } from './profile.js';
import type { RecordSession } from './records.js';
import { setBranchSetting, settingIn, setTenantSetting } from './settings.js';
import {
  branchesIn,
  branchIn,
  companiesIn,
  companyIn,
  locationIn,
  locationsIn,
  openBranch,
  openLocation,
  openRegister,
  registerCompany,
  registerIn,
  registersIn,
  renameBranch,
  renameCompany,
  renameLocation,
  renameRegister,
  setBranchActive,
  setCompanyActive,
  setLocationActive,
  setRegisterActive,
} from './structure.js';

export * from './contract.js';
export type { RecordSession } from './records.js';

/**
 * Every right this module defines, built from the same grammar the ids were.
 *
 * `SEC-01` seeds these into the seven roles and `SEC-02` grants them per action;
 * neither retypes a string, because a permission granted under a name nobody
 * declared is a permission that silently does nothing.
 */
function permissions(): readonly PermissionDeclaration[] {
  return SYS_PERMISSION_IDS.map((id) => ({ id, labelKey: `permission.${id}` }));
}

/**
 * `SYS`, as an edition hosts it.
 *
 * A factory rather than a constant because the session type belongs to the
 * host: a store node and a register run the same module over different stores,
 * and `U07` brings both. What the module needs from either is `RecordSession`,
 * and nothing below knows which one it was given.
 *
 * It declares **no migrations**, which is deliberate and not an omission. There
 * is no schema to create until a driver exists, and a placeholder would be
 * worse than nothing: `runMigrations` writes each id into a journal and never
 * runs that id again, so a stand-in `sys.0001-…` would permanently burn the
 * name the real one wants on every store that had already started.
 *
 * It publishes **no events** either, for a narrower reason. Nothing reacts to
 * structure yet, and the one thing modules will need — whether a branch or a
 * location may still be used — has to be answered inside the transaction that
 * is about to write a movement, which is a question for the contract rather
 * than an announcement after the fact. An event nobody subscribes to is a name
 * to keep compatible in exchange for nothing.
 */
export function sysModule<Session extends RecordSession>(): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'SYS',
    labelKey: 'module.sys',
    permissions: permissions(),
    provides: [
      provideContract(Organisation, (context: ModuleContext<Session>) => {
        // Every read opens its own transaction. It is the only way to reach the
        // store, and it is also the seam SEC-04 will need: scoping a user's
        // sight to their branches happens once, here, rather than in each
        // caller.
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          company: (by, id) => read(by, (session) => companyIn(session, by.tenant, id)),
          branch: (by, id) => read(by, (session) => branchIn(session, by.tenant, id)),
          location: (by, id) => read(by, (session) => locationIn(session, by.tenant, id)),
          register: (by, id) => read(by, (session) => registerIn(session, by.tenant, id)),

          companies: (by, listing) =>
            read(by, (session) => companiesIn(session, by.tenant, listing)),
          branches: (by, listing) => read(by, (session) => branchesIn(session, by.tenant, listing)),
          locations: (by, branch, listing) =>
            read(by, (session) => locationsIn(session, by.tenant, branch, listing)),
          registers: (by, branch, listing) =>
            read(by, (session) => registersIn(session, by.tenant, branch, listing)),

          profile: (by, company) => read(by, (session) => profileIn(session, by.tenant, company)),
          setting: (by, branch, key) =>
            read(by, (session) => settingIn(session, by.tenant, branch, key)),
        } satisfies Organisation;
      }),

      provideContract(OrganisationAdministration, (context: ModuleContext<Session>) => {
        const run = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          companies: {
            register: (by: CommandContext, input: NewCompany) =>
              run(by, (session) => {
                const registered = registerCompany(session, by.tenant, input.name);
                if (registered.ok) {
                  // Part of registering a company rather than a second command
                  // an administrator might not know to run: SYS-05 has to have
                  // an answer from the first receipt onwards.
                  seedProfile(session, registered.value, input.profile);
                }
                return registered;
              }),
            rename: (by: CommandContext, id: CompanyId, name: string) =>
              run(by, (session) => renameCompany(session, by.tenant, id, name)),
            deactivate: (by: CommandContext, id: CompanyId) =>
              run(by, (session) => setCompanyActive(session, by.tenant, id, false)),
            reactivate: (by: CommandContext, id: CompanyId) =>
              run(by, (session) => setCompanyActive(session, by.tenant, id, true)),
          },
          branches: {
            open: (by: CommandContext, input: NewBranch) =>
              run(by, (session) => openBranch(session, by.tenant, input)),
            rename: (by: CommandContext, id: BranchId, name: string) =>
              run(by, (session) => renameBranch(session, by.tenant, id, name)),
            deactivate: (by: CommandContext, id: BranchId) =>
              run(by, (session) => setBranchActive(session, by.tenant, id, false)),
            reactivate: (by: CommandContext, id: BranchId) =>
              run(by, (session) => setBranchActive(session, by.tenant, id, true)),
          },
          locations: {
            open: (by: CommandContext, input: NewLocation) =>
              run(by, (session) => openLocation(session, by.tenant, input)),
            rename: (by: CommandContext, id: LocationId, name: string) =>
              run(by, (session) => renameLocation(session, by.tenant, id, name)),
            deactivate: (by: CommandContext, id: LocationId) =>
              run(by, (session) => setLocationActive(session, by.tenant, id, false)),
            reactivate: (by: CommandContext, id: LocationId) =>
              run(by, (session) => setLocationActive(session, by.tenant, id, true)),
          },
          registers: {
            open: (by: CommandContext, input: NewRegister) =>
              run(by, (session) => openRegister(session, by.tenant, input)),
            rename: (by: CommandContext, id: RegisterId, name: string) =>
              run(by, (session) => renameRegister(session, by.tenant, id, name)),
            deactivate: (by: CommandContext, id: RegisterId) =>
              run(by, (session) => setRegisterActive(session, by.tenant, id, false)),
            reactivate: (by: CommandContext, id: RegisterId) =>
              run(by, (session) => setRegisterActive(session, by.tenant, id, true)),
          },
          profile: {
            revise: (by: CommandContext, company: CompanyId, changes: ProfileRevision) =>
              run(by, (session) => reviseProfile(session, by.tenant, company, changes)),
          },
          settings: {
            forBranch: (by: CommandContext, branch: BranchId, key: string, value: string | null) =>
              run(by, (session) => setBranchSetting(session, by.tenant, branch, key, value)),
            forTenant: (by: CommandContext, key: string, value: string | null) =>
              run(by, (session) => setTenantSetting(session, by.tenant, key, value)),
          },
        } satisfies OrganisationAdministration;
      }),
    ],
  });
}
