import type { PermissionId } from '@vertex/contracts';
import {
  compareIds,
  localDateOf,
  ok,
  refuse,
  type CurrencyCode,
  type LocalDate,
  type Result,
} from '@vertex/kernel';
import {
  defineModule,
  provideContract,
  subscribeTo,
  untilCommitted,
  type CommandContext,
  type ModuleContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';
import { Currencies, CurrencyDefined } from '@vertex/fx/contract';
import { DEFAULT_TIME_ZONE, Organisation } from '@vertex/sys/contract';

import {
  appendYear,
  closePeriod,
  postingPeriodOn,
  redefineYear,
  reopenPeriod,
  reopeningsIn,
  seedCalendar,
  yearsIn,
  type Keeping,
} from './calendar.js';
import {
  accountIn,
  accountsIn,
  addAccount,
  ensureCashAccount,
  mappingsIn,
  mapRole,
  moveAccount,
  renameAccount,
  resolveRole,
  seedChart,
  setAccountActive,
  treeOf,
} from './chart.js';
import {
  ChartAdministration,
  ChartOfAccounts,
  FIN_ACCOUNT_ROLES,
  FIN_PERMISSION_SEEDS,
  FIN_PERMISSIONS,
  FiscalCalendar,
  FiscalCalendarAdministration,
  type AccountId,
  type AccountingPeriodId,
  type CalendarRefusal,
  type ChartRefusal,
  type FiscalYearId,
  type Listing,
  type NewAccount,
  type RecordSession,
  type YearDefinition,
  type YearShape,
} from './contract.js';

export * from './contract.js';
export { yearState } from './calendar.js';
export { compareCodes, normalBalanceOf } from './chart.js';
export { SEEDED_ACCOUNTS, type SeededAccount } from './seeds.js';

/**
 * Every right this module defines, built from the same grammar the ids were, so
 * that `SEC-01` seeds and `SEC-02` grants them without retyping a string.
 */
function permissions(): readonly PermissionDeclaration[] {
  return FIN_PERMISSION_SEEDS.map(({ id, seededFor, sensitive }) => ({
    id,
    labelKey: `permission.${id}`,
    seededFor,
    ...(sensitive === undefined ? {} : { sensitive }),
  }));
}

/**
 * `FIN`, as an edition hosts it.
 *
 * A factory for the reason `SYS` and `FX` are: the session type belongs to the
 * host, and a store node and a register run this same module over different
 * stores.
 *
 * It depends on `SYS`, `SEC` and `FX`, as `modules.md` §3 says. Of `FX` it asks
 * one thing so far — the tenant's currencies, to open a cash account for each
 * (`FIN-01`) — and it hears one thing: a currency defined afterwards, which is
 * the only way a module beneath this one can reach it (§4). Of `SYS` it asks
 * one thing: the tenant's branches, for the zone the first of them counts its
 * days in, because a fiscal calendar has to start on a day and every day in
 * this product is somewhere's (`FIN-05`). The document number arrives with the
 * posting engine.
 *
 * Its own account role is declared the way every other module declares one,
 * reserved for the purpose the seed opens an account for: `FIN` posts to itself
 * through the same door everybody else uses.
 *
 * No migrations, as in the modules before it: there is no schema until a
 * driver exists and a placeholder migration would burn the name the real one
 * wants.
 */
export function finModule<Session extends RecordSession>(): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'FIN',
    labelKey: 'module.fin',
    dependsOn: ['SYS', 'SEC', 'FX'],
    permissions: permissions(),
    accounts: [
      {
        role: FIN_ACCOUNT_ROLES.openingBalanceEquity,
        labelKey: `account-role.${FIN_ACCOUNT_ROLES.openingBalanceEquity}`,
        normalBalance: 'credit',
        reserved: 'opening-equity',
      },
    ],
    subscribes: [
      // After the commit that defined the currency, in a command of this
      // module's own under the same context — the same tenant, the same
      // correlation — so that the account and the currency it is for can be
      // read as one act by anyone asking later what happened.
      //
      // Run until it commits. On a shop's first morning the currencies are
      // seeded while the chart is, and a currency announced in that window
      // races the seed for the same records: whichever commits second is
      // refused. The seed's caller runs the seed again; nothing would ever
      // run this again, and a currency the ledger never heard of is a till
      // that takes money the books have nowhere to put. Opening the account
      // is idempotent, so a second attempt costs nothing but the attempt.
      subscribeTo(CurrencyDefined, (event, context: ModuleContext<Session>) =>
        untilCommitted(() =>
          context.transactor.run(event.context, (uow) => {
            ensureCashAccount(uow.session, event.context.tenant, event.payload.currency.code);
            return Promise.resolve();
          }),
        ),
      ),
    ],
    provides: [
      provideContract(ChartOfAccounts, (context: ModuleContext<Session>) => {
        // Unguarded: see `ChartOfAccounts` in the contract for where a
        // person's sight is decided.
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          accounts: (by: CommandContext, listing?: Listing) =>
            read(by, (session) => accountsIn(session, by.tenant, listing)),
          account: (by: CommandContext, id: AccountId) =>
            read(by, (session) => accountIn(session, by.tenant, id)),
          tree: (by: CommandContext, listing?: Listing) =>
            read(by, (session) => treeOf(session, by.tenant, listing)),
          resolve: (by: CommandContext, role: string, currency?: CurrencyCode) =>
            read(by, (session) =>
              resolveRole(session, by.tenant, context.declaredAccounts, role, currency),
            ),
          mappings: (by: CommandContext) => read(by, (session) => mappingsIn(session, by.tenant)),
        } satisfies ChartOfAccounts;
      }),

      provideContract(ChartAdministration, (context: ModuleContext<Session>) => {
        /**
         * Ask, then act — the arrangement `SYS` and `FX` use, for their reasons.
         *
         * The question is asked before the transaction opens, so a refusal
         * costs no transaction and the answer never holds a second connection
         * open while this one waits. A denial is a refusal naming the right, so
         * that a screen can say which one is missing.
         *
         * Always at the tenant-wide place: a chart is one per tenant, so there
         * is no branch to be judged at.
         */
        const guarded = async <T>(
          by: CommandContext,
          right: PermissionId,
          work: (session: Session) => Result<T, ChartRefusal>,
        ): Promise<Result<T, ChartRefusal>> => {
          if (!(await context.authorise(by, right))) {
            return refuse('fin.not-permitted', { right });
          }
          return context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));
        };

        const { account, accountMapping } = FIN_PERMISSIONS;

        return {
          seed: async (by: CommandContext) => {
            // The right first, then `FX`, then this module's own transaction:
            // somebody refused learns nothing, and one command never holds two
            // transactions open at once.
            if (!(await context.authorise(by, account.create))) {
              return refuse('fin.not-permitted', { right: account.create });
            }
            // Every currency the tenant has, in use or not: an amount recorded
            // in a currency since withdrawn still needs somewhere to sit.
            const currencies = await context
              .require(Currencies)
              .currencies(by, { including: 'all' });
            return context.transactor.run(by, (uow) =>
              Promise.resolve(ok(seedChart(uow.session, by.tenant, currencies))),
            );
          },
          add: (by: CommandContext, input: NewAccount) =>
            guarded(by, account.create, (session) => addAccount(session, by.tenant, input)),
          rename: (by: CommandContext, id: AccountId, name: string) =>
            guarded(by, account.edit, (session) => renameAccount(session, by.tenant, id, name)),
          move: (by: CommandContext, id: AccountId, parent: AccountId | null) =>
            guarded(by, account.edit, (session) => moveAccount(session, by.tenant, id, parent)),
          withdraw: (by: CommandContext, id: AccountId) =>
            guarded(by, account.withdraw, (session) =>
              setAccountActive(session, by.tenant, id, false),
            ),
          restore: (by: CommandContext, id: AccountId) =>
            guarded(by, account.withdraw, (session) =>
              setAccountActive(session, by.tenant, id, true),
            ),
          map: (by: CommandContext, role: string, id: AccountId) =>
            guarded(by, accountMapping.edit, (session) =>
              mapRole(session, by.tenant, context.declaredAccounts, role, id),
            ),
        } satisfies ChartAdministration;
      }),

      provideContract(FiscalCalendar, (context: ModuleContext<Session>) => {
        // Unguarded: see `FiscalCalendar` in the contract for where a person's
        // sight is decided.
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          years: (by: CommandContext) => read(by, (session) => yearsIn(session, by.tenant)),
          postingPeriodOn: (by: CommandContext, day: LocalDate) =>
            read(by, (session) => postingPeriodOn(session, by.tenant, day)),
          reopenings: (by: CommandContext, period?: AccountingPeriodId) =>
            read(by, (session) => reopeningsIn(session, by.tenant, period)),
        } satisfies FiscalCalendar;
      }),

      provideContract(FiscalCalendarAdministration, (context: ModuleContext<Session>) => {
        // Ask, then act, always at the tenant-wide place — for the reasons
        // `ChartAdministration` gives above, and because a calendar, unlike a
        // chart, is one per tenant by the arithmetic of `FIN-05` rather than
        // merely by arrangement: a month closed at one branch and open at
        // another is one set of books with two answers.
        const guarded = async <T>(
          by: CommandContext,
          right: PermissionId,
          work: (session: Session) => Result<T, CalendarRefusal>,
        ): Promise<Result<T, CalendarRefusal>> => {
          if (!(await context.authorise(by, right))) {
            return refuse('fin.not-permitted', { right });
          }
          return context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));
        };

        /** Who is keeping the books, and the one moment this command reads. */
        const keeping = (by: CommandContext): Keeping => ({
          by: by.actor,
          at: context.clock.now(),
        });

        const { fiscalYear, accountingPeriod } = FIN_PERMISSIONS;

        return {
          seed: async (by: CommandContext) => {
            // The right first, then `SYS`, then this module's own transaction:
            // somebody refused learns nothing, and one command never holds two
            // transactions open at once.
            if (!(await context.authorise(by, fiscalYear.create))) {
              return refuse('fin.not-permitted', { right: fiscalYear.create });
            }
            const today = await tenantToday(context, by);
            return context.transactor.run(by, (uow) =>
              Promise.resolve(ok(seedCalendar(uow.session, by.tenant, today))),
            );
          },
          append: (by: CommandContext, shape?: YearShape) =>
            guarded(by, fiscalYear.create, (session) => appendYear(session, by.tenant, shape)),
          redefine: (by: CommandContext, year: FiscalYearId, definition: YearDefinition) =>
            guarded(by, fiscalYear.edit, (session) =>
              redefineYear(session, by.tenant, year, definition),
            ),
          close: (by: CommandContext, period: AccountingPeriodId) =>
            guarded(by, accountingPeriod.close, (session) =>
              closePeriod(session, by.tenant, period, keeping(by)),
            ),
          reopen: (by: CommandContext, period: AccountingPeriodId, reason: string) =>
            guarded(by, accountingPeriod.reopen, (session) =>
              reopenPeriod(session, by.tenant, period, reason, keeping(by)),
            ),
        } satisfies FiscalCalendarAdministration;
      }),
    ],
  });
}

/**
 * The day it is for the tenant, counted where the tenant trades.
 *
 * Every day in this product is somewhere's day (`SYS`'s `Branch.timeZone`), and
 * a fiscal calendar is the tenant's rather than any one branch's — so the zone
 * is taken from the branch the tenant **opened first**, which is a fact that
 * does not move as branches open and close. Withdrawn branches count: the shop
 * that started in Damascus counts its years there whether or not that first
 * shop is still trading.
 *
 * A tenant with no branch at all is counted in the zone a branch is opened in
 * by default. It happens exactly once, when the calendar is installed before
 * the first branch is opened, and it decides which calendar year the seed
 * installs — a question with one answer for all but a few hours of the year,
 * and one the accountant settles for good with `redefine`.
 */
async function tenantToday<Session>(
  context: ModuleContext<Session>,
  by: CommandContext,
): Promise<LocalDate> {
  const branches = await context.require(Organisation).branches(by, { including: 'all' });
  // Identifiers are UUIDv7 and carry the moment they were made, so the
  // smallest is the first branch the tenant opened.
  const first = [...branches].sort((one, other) => compareIds(one.id, other.id))[0];
  return localDateOf(context.clock.now(), first?.timeZone ?? DEFAULT_TIME_ZONE);
}
