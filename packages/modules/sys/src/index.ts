import type {
  BranchId,
  CompanyId,
  DeviceId,
  LocationId,
  PermissionId,
  RegisterId,
} from '@vertex/contracts';
import { refuse, type Refusal, type Result } from '@vertex/kernel';
import {
  defineModule,
  provideContract,
  type AuthorisationScope,
  type CommandContext,
  type ModuleContext,
  type ModuleDefinition,
  type PermissionDeclaration,
  type UnitOfWork,
} from '@vertex/platform';

import {
  DocumentNumbering,
  Organisation,
  OrganisationAdministration,
  SYS_PERMISSION_SEEDS,
  SYS_PERMISSIONS,
  type GeoPoint,
  type RecordSession,
  type SeriesScope,
  type NewBranch,
  type NewCompany,
  type NewLocation,
  type NewRegister,
  type ProfileRevision,
} from './contract.js';
import { defineSeries, nextNumber, seriesIn } from './numbering.js';
import { profileIn, reviseProfile, seedProfile } from './profile.js';
import { setBranchSetting, settingIn, setTenantSetting } from './settings.js';
import {
  assignDevice,
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
  locateBranch,
  locateLocation,
  readdressBranch,
  readdressLocation,
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

/**
 * Every right this module defines, built from the same grammar the ids were.
 *
 * `SEC-01` seeds these into the seven roles and `SEC-02` grants them per action;
 * neither retypes a string, because a permission granted under a name nobody
 * declared is a permission that silently does nothing.
 */
function permissions(): readonly PermissionDeclaration[] {
  return SYS_PERMISSION_SEEDS.map(({ id, seededFor }) => ({
    id,
    labelKey: `permission.${id}`,
    seededFor,
  }));
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

      provideContract(DocumentNumbering, (context: ModuleContext<Session>) => {
        return {
          // The one contract in this module that does **not** open a
          // transaction. It is handed the caller's, so that the counter moves
          // only if the document it is numbering does.
          next: (uow: UnitOfWork<RecordSession>, scope: SeriesScope, document: string) =>
            Promise.resolve(nextNumber(uow.session, uow.context.tenant, scope, document)),
          series: (by: CommandContext, scope: SeriesScope) =>
            context.transactor.run(by, (uow) =>
              Promise.resolve(seriesIn(uow.session, by.tenant, scope)),
            ),
        } satisfies DocumentNumbering;
      }),

      provideContract(OrganisationAdministration, (context: ModuleContext<Session>) => {
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        /**
         * Ask, then act.
         *
         * The question comes first and outside the transaction, which is the
         * same arrangement `SEC` uses when it asks `SYS` to confirm a place: a
         * refusal then costs no transaction at all, and the answer never holds
         * a second connection open while this one waits — the habit that costs
         * a connection per command the day the drivers arrive in `U07`.
         *
         * A denial is a **refusal and not a throw**. Whether somebody may open
         * a branch is an ordinary business answer that has to reach the screen
         * with its right named, so that the interface can say which one is
         * missing rather than showing a failure.
         */
        const guarded = async <T, Code extends string>(
          by: CommandContext,
          right: PermissionId,
          where: AuthorisationScope | undefined,
          work: (session: Session) => Result<T, Refusal<Code>>,
        ): Promise<Result<T, Refusal<Code | 'sys.not-permitted'>>> => {
          if (!(await context.authorise(by, right, where))) {
            return refuse('sys.not-permitted', { right });
          }
          return read(by, work);
        };

        /**
         * Where an existing entity sits, read before the guard so that a
         * branch-confined administrator is judged against the branch the thing
         * is actually in rather than against nowhere.
         *
         * An entity nobody can find yields `undefined`, which is the
         * tenant-wide place: the command itself then answers "no such branch"
         * to somebody whose rights reach the whole tenant, and "not permitted"
         * to somebody whose rights do not — which is also the answer that
         * declines to say whether the identifier names anything.
         */
        const placeOfLocation = async (
          by: CommandContext,
          id: LocationId,
        ): Promise<AuthorisationScope | undefined> => {
          const location = await read(by, (session) => locationIn(session, by.tenant, id));
          return location === null ? undefined : { branch: location.branch, location: id };
        };
        const placeOfRegister = async (
          by: CommandContext,
          id: RegisterId,
        ): Promise<AuthorisationScope | undefined> => {
          const register = await read(by, (session) => registerIn(session, by.tenant, id));
          return register === null ? undefined : { branch: register.branch };
        };

        return {
          companies: {
            register: (by: CommandContext, input: NewCompany) =>
              guarded(by, SYS_PERMISSIONS.company.create, undefined, (session) => {
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
              guarded(by, SYS_PERMISSIONS.company.edit, undefined, (session) =>
                renameCompany(session, by.tenant, id, name),
              ),
            deactivate: (by: CommandContext, id: CompanyId) =>
              guarded(by, SYS_PERMISSIONS.company.withdraw, undefined, (session) =>
                setCompanyActive(session, by.tenant, id, false),
              ),
            reactivate: (by: CommandContext, id: CompanyId) =>
              guarded(by, SYS_PERMISSIONS.company.withdraw, undefined, (session) =>
                setCompanyActive(session, by.tenant, id, true),
              ),
          },
          branches: {
            // Opening one has no branch to be judged against — the branch is
            // what is being made — so it is the tenant-wide place, which is
            // also what `SYS_PERMISSIONS` seeds it as: the owner's.
            open: (by: CommandContext, input: NewBranch) =>
              guarded(by, SYS_PERMISSIONS.branch.create, undefined, (session) =>
                openBranch(session, by.tenant, input),
              ),
            rename: (by: CommandContext, id: BranchId, name: string) =>
              guarded(by, SYS_PERMISSIONS.branch.edit, { branch: id }, (session) =>
                renameBranch(session, by.tenant, id, name),
              ),
            // Where a branch is is an edit to the branch, judged at the branch
            // — so a manager confined to Aleppo (SEC-04) can say where Aleppo
            // is and cannot move Damascus.
            readdress: (by: CommandContext, id: BranchId, address: string) =>
              guarded(by, SYS_PERMISSIONS.branch.edit, { branch: id }, (session) =>
                readdressBranch(session, by.tenant, id, address),
              ),
            locate: (by: CommandContext, id: BranchId, point: GeoPoint | null) =>
              guarded(by, SYS_PERMISSIONS.branch.edit, { branch: id }, (session) =>
                locateBranch(session, by.tenant, id, point),
              ),
            deactivate: (by: CommandContext, id: BranchId) =>
              guarded(by, SYS_PERMISSIONS.branch.withdraw, { branch: id }, (session) =>
                setBranchActive(session, by.tenant, id, false),
              ),
            reactivate: (by: CommandContext, id: BranchId) =>
              guarded(by, SYS_PERMISSIONS.branch.withdraw, { branch: id }, (session) =>
                setBranchActive(session, by.tenant, id, true),
              ),
          },
          locations: {
            open: (by: CommandContext, input: NewLocation) =>
              guarded(by, SYS_PERMISSIONS.location.create, { branch: input.branch }, (session) =>
                openLocation(session, by.tenant, input),
              ),
            rename: async (by: CommandContext, id: LocationId, name: string) =>
              guarded(by, SYS_PERMISSIONS.location.edit, await placeOfLocation(by, id), (session) =>
                renameLocation(session, by.tenant, id, name),
              ),
            readdress: async (by: CommandContext, id: LocationId, address: string) =>
              guarded(by, SYS_PERMISSIONS.location.edit, await placeOfLocation(by, id), (session) =>
                readdressLocation(session, by.tenant, id, address),
              ),
            locate: async (by: CommandContext, id: LocationId, point: GeoPoint | null) =>
              guarded(by, SYS_PERMISSIONS.location.edit, await placeOfLocation(by, id), (session) =>
                locateLocation(session, by.tenant, id, point),
              ),
            deactivate: async (by: CommandContext, id: LocationId) =>
              guarded(
                by,
                SYS_PERMISSIONS.location.withdraw,
                await placeOfLocation(by, id),
                (session) => setLocationActive(session, by.tenant, id, false),
              ),
            reactivate: async (by: CommandContext, id: LocationId) =>
              guarded(
                by,
                SYS_PERMISSIONS.location.withdraw,
                await placeOfLocation(by, id),
                (session) => setLocationActive(session, by.tenant, id, true),
              ),
          },
          registers: {
            open: (by: CommandContext, input: NewRegister) =>
              guarded(by, SYS_PERMISSIONS.register.create, { branch: input.branch }, (session) =>
                openRegister(session, by.tenant, input),
              ),
            rename: async (by: CommandContext, id: RegisterId, name: string) =>
              guarded(by, SYS_PERMISSIONS.register.edit, await placeOfRegister(by, id), (session) =>
                renameRegister(session, by.tenant, id, name),
              ),
            deactivate: async (by: CommandContext, id: RegisterId) =>
              guarded(
                by,
                SYS_PERMISSIONS.register.withdraw,
                await placeOfRegister(by, id),
                (session) => setRegisterActive(session, by.tenant, id, false),
              ),
            reactivate: async (by: CommandContext, id: RegisterId) =>
              guarded(
                by,
                SYS_PERMISSIONS.register.withdraw,
                await placeOfRegister(by, id),
                (session) => setRegisterActive(session, by.tenant, id, true),
              ),
            assignDevice: async (by: CommandContext, id: RegisterId, device: DeviceId) =>
              guarded(by, SYS_PERMISSIONS.register.edit, await placeOfRegister(by, id), (session) =>
                assignDevice(session, by.tenant, id, device),
              ),
          },
          profile: {
            // The company's own profile is what every receipt in the group
            // carries, so it is the tenant-wide place: `decide.ts` admits it
            // only to somebody whose rights are not confined to one branch.
            revise: (by: CommandContext, company: CompanyId, changes: ProfileRevision) =>
              guarded(by, SYS_PERMISSIONS.businessProfile.edit, undefined, (session) =>
                reviseProfile(session, by.tenant, company, changes),
              ),
          },
          numbering: {
            define: (by: CommandContext, scope: SeriesScope, format: string) =>
              guarded(
                by,
                SYS_PERMISSIONS.numberingSeries.edit,
                { branch: scope.branch },
                (session) => defineSeries(session, by.tenant, scope, format),
              ),
          },
          settings: {
            forBranch: (by: CommandContext, branch: BranchId, key: string, value: string | null) =>
              guarded(by, SYS_PERMISSIONS.branchSetting.edit, { branch }, (session) =>
                setBranchSetting(session, by.tenant, branch, key, value),
              ),
            forTenant: (by: CommandContext, key: string, value: string | null) =>
              guarded(by, SYS_PERMISSIONS.branchSetting.edit, undefined, (session) =>
                setTenantSetting(session, by.tenant, key, value),
              ),
          },
        } satisfies OrganisationAdministration;
      }),
    ],
  });
}
