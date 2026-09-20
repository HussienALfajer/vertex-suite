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
  type AccountRoleDeclaration,
  type CommandContext,
  type ModuleContext,
  type ModuleDefinition,
  type PermissionDeclaration,
} from '@vertex/platform';
import { Currencies, CurrencyDefined } from '@vertex/fx/contract';
import { DEFAULT_TIME_ZONE, Organisation } from '@vertex/sys/contract';

import { bookkeeping } from './bookkeeping.js';
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
  Journal,
  JournalAdministration,
  PostingEngine,
  PostingExceptionAdministration,
  PostingExceptions,
  type AccountId,
  type AccountingPeriodId,
  type AttachmentStore,
  type CalendarRefusal,
  type ChartRefusal,
  type EntrySource,
  type ExceptionDecision,
  type ExceptionListing,
  type FiscalYearId,
  type JournalEntryId,
  type JournalListing,
  type Listing,
  type ManualEntry,
  type NewAccount,
  type OpeningBalances,
  type PostingExceptionId,
  type RecordSession,
  type ReversalTerms,
  type YearDefinition,
  type YearShape,
} from './contract.js';
import { postingEngine } from './engine.js';
import { exceptionIn, exceptionsIn, resolveException } from './exceptions.js';
import { entriesIn, postedFor, postedIn, reversalIn } from './journal.js';

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
 * The account roles this module posts to itself (`FIN_ACCOUNT_ROLES`), each
 * reserved for the purpose the seed opens an account for, and each declared
 * the way every other module declares one: `FIN` posts to itself through the
 * same door everybody else uses.
 */
function accounts(): readonly AccountRoleDeclaration[] {
  const declare = (
    role: string,
    normalBalance: AccountRoleDeclaration['normalBalance'],
    reserved: NonNullable<AccountRoleDeclaration['reserved']>,
  ): AccountRoleDeclaration => ({
    role,
    labelKey: `account-role.${role}`,
    normalBalance,
    reserved,
  });
  return [
    declare(FIN_ACCOUNT_ROLES.openingBalanceEquity, 'credit', 'opening-equity'),
    declare(FIN_ACCOUNT_ROLES.openingInventory, 'debit', 'inventory'),
    declare(FIN_ACCOUNT_ROLES.openingCash, 'debit', 'cash'),
    declare(FIN_ACCOUNT_ROLES.openingCustomerDebts, 'debit', 'receivables'),
    declare(FIN_ACCOUNT_ROLES.openingSupplierDebts, 'credit', 'payables'),
  ];
}

/**
 * What a host provides this module with, beyond what every module is handed.
 *
 * The attachment store is the host's for the reason the session driver is:
 * where files go is a fact about the installation — a directory on the store
 * node, an object store in the cloud — and not about the ledger.
 */
export interface FinOptions {
  /** Where the bytes of what the accountant attaches are kept (`FIN-04`). */
  readonly attachments: AttachmentStore;
}

/**
 * `FIN`, as an edition hosts it.
 *
 * A factory for the reason `SYS` and `FX` are: the session type belongs to the
 * host, and a store node and a register run this same module over different
 * stores.
 *
 * It depends on `SYS`, `SEC` and `FX`, as `modules.md` §3 says. Of `FX` it asks
 * the tenant's currencies — to open a cash account for each (`FIN-01`), and to
 * know what an entry balances in and how finely each currency is kept
 * (`FIN-02`); a stamp and a valuation for an amount the accountant states in
 * another currency (`FIN-04`, `FIN-06`, through `FX-05` and `FX-07`) — and it
 * hears one thing: a currency defined afterwards, which is the only way a
 * module beneath this one can reach it (§4). Of `SYS` it asks the tenant's
 * branches, for the zone the first of them counts its days in (`FIN-05`); one
 * branch, that an entry is booked at a shop that trades; the registers of a
 * branch, to know the till a command is being run at; and the next document
 * number, inside the caller's own transaction (`SYS-02`).
 *
 * Its own account roles are declared the way every other module declares its
 * own, reserved for the purposes the seed opens accounts for: `FIN` posts to
 * itself through the same door everybody else uses.
 *
 * `PostingEngine` is the one contract here that writes into somebody else's
 * transaction rather than its own, and it is split in two so that it can: see
 * the contract for why an event and its entry cannot be allowed to commit
 * separately.
 *
 * No migrations, as in the modules before it: there is no schema until a
 * driver exists and a placeholder migration would burn the name the real one
 * wants.
 */
export function finModule<Session extends RecordSession>(
  options: FinOptions,
): ModuleDefinition<Session> {
  return defineModule<Session>({
    code: 'FIN',
    labelKey: 'module.fin',
    dependsOn: ['SYS', 'SEC', 'FX'],
    permissions: permissions(),
    accounts: accounts(),
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

      provideContract(PostingEngine, (context: ModuleContext<Session>) => postingEngine(context)),

      provideContract(Journal, (context: ModuleContext<Session>) => {
        // Unguarded: see `Journal` in the contract for where a person's sight
        // is decided.
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));
        const { attachment } = bookkeeping(context, options.attachments);

        return {
          entry: (by: CommandContext, id: JournalEntryId) =>
            read(by, (session) => postedIn(session, by.tenant, id)),
          entryFor: (by: CommandContext, source: EntrySource) =>
            read(by, (session) => postedFor(session, by.tenant, source)),
          entries: (by: CommandContext, listing?: JournalListing) =>
            read(by, (session) => entriesIn(session, by.tenant, listing)),
          reversalOf: (by: CommandContext, id: JournalEntryId) =>
            read(by, (session) => reversalIn(session, by.tenant, id)),
          attachment,
        } satisfies Journal;
      }),

      provideContract(JournalAdministration, (context: ModuleContext<Session>) => {
        const engine = postingEngine(context);
        const { record, open } = bookkeeping(context, options.attachments);
        const { journalEntry } = FIN_PERMISSIONS;

        return {
          // The accountant's own postings: the engine driven from inside this
          // module, under this module's rights, and nothing more — see
          // `bookkeeping.ts` for the order each asks in.
          record: (by: CommandContext, entry: ManualEntry) => record(by, entry),
          open: (by: CommandContext, balances: OpeningBalances) => open(by, balances),
          // Ask, then prepare, then post in a transaction of this module's own.
          reverse: async (by: CommandContext, original: JournalEntryId, terms: ReversalTerms) => {
            if (!(await context.authorise(by, journalEntry.reverse))) {
              return refuse('fin.not-permitted', { right: journalEntry.reverse });
            }
            const prepared = await engine.prepareReversal(by, original, terms);
            if (!prepared.ok) return prepared;
            return context.transactor.run(by, (uow) => engine.post(uow, prepared.value));
          },
        } satisfies JournalAdministration;
      }),

      provideContract(PostingExceptions, (context: ModuleContext<Session>) => {
        // Unguarded, as the module's other reads are.
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          exceptions: (by: CommandContext, listing?: ExceptionListing) =>
            read(by, (session) => exceptionsIn(session, by.tenant, listing)),
          exception: (by: CommandContext, id: PostingExceptionId) =>
            read(by, (session) => exceptionIn(session, by.tenant, id)),
        } satisfies PostingExceptions;
      }),

      provideContract(PostingExceptionAdministration, (context: ModuleContext<Session>) => {
        const { postingException } = FIN_PERMISSIONS;

        return {
          // Ask, then act, at the tenant-wide place: the books are the tenant's,
          // and what goes into them out of the queue is judged there.
          post: async (
            by: CommandContext,
            id: PostingExceptionId,
            decision?: ExceptionDecision,
          ) => {
            if (!(await context.authorise(by, postingException.resolve))) {
              return refuse('fin.not-permitted', { right: postingException.resolve });
            }
            const keeping: Keeping = { by: by.actor, at: context.clock.now() };
            return context.transactor.run(by, (uow) =>
              Promise.resolve(resolveException(uow.session, by.tenant, id, decision, keeping)),
            );
          },
        } satisfies PostingExceptionAdministration;
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
