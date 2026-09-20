import type { BranchId, DeviceId, PermissionId, RegisterId } from '@vertex/contracts';
import {
  compareIds,
  isId,
  localDateOf,
  ok,
  parseId,
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
  type UnitOfWork,
} from '@vertex/platform';
import { Currencies, CurrencyDefined } from '@vertex/fx/contract';
import { DEFAULT_TIME_ZONE, DocumentNumbering, Organisation } from '@vertex/sys/contract';

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
  type CalendarRefusal,
  type ChartRefusal,
  type EntryDraft,
  type EntrySource,
  type ExceptionDecision,
  type ExceptionListing,
  type FiscalYearId,
  type JournalEntryId,
  type JournalListing,
  type Listing,
  type NewAccount,
  type Posted,
  type PostingExceptionId,
  type PostingRefusal,
  type PreparedEntry,
  type RecordSession,
  type ReversalTerms,
  type YearDefinition,
  type YearShape,
} from './contract.js';
import {
  draftArriving,
  prepareEntry,
  reversalArriving,
  reversalOf,
  type Books,
  type Making,
} from './drafts.js';
import { acceptEntry, exceptionIn, exceptionsIn, resolveException } from './exceptions.js';
import { entriesIn, postedFor, postedIn, postEntry, reversalIn } from './journal.js';

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
 * the tenant's currencies — to open a cash account for each (`FIN-01`), and to
 * know what an entry balances in and how finely each currency is kept
 * (`FIN-02`) — and it hears one thing: a currency defined afterwards, which is
 * the only way a module beneath this one can reach it (§4). Of `SYS` it asks
 * the tenant's branches, for the zone the first of them counts its days in
 * (`FIN-05`); one branch, that an entry is booked at a shop that trades; the
 * registers of a branch, to know the till a command is being run at; and the
 * next document number, inside the caller's own transaction (`SYS-02`).
 *
 * Its own account role is declared the way every other module declares one,
 * reserved for the purpose the seed opens an account for: `FIN` posts to itself
 * through the same door everybody else uses.
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

      provideContract(PostingEngine, (context: ModuleContext<Session>) => postingEngine(context)),

      provideContract(Journal, (context: ModuleContext<Session>) => {
        // Unguarded: see `Journal` in the contract for where a person's sight
        // is decided.
        const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
          context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

        return {
          entry: (by: CommandContext, id: JournalEntryId) =>
            read(by, (session) => postedIn(session, by.tenant, id)),
          entryFor: (by: CommandContext, source: EntrySource) =>
            read(by, (session) => postedFor(session, by.tenant, source)),
          entries: (by: CommandContext, listing?: JournalListing) =>
            read(by, (session) => entriesIn(session, by.tenant, listing)),
          reversalOf: (by: CommandContext, id: JournalEntryId) =>
            read(by, (session) => reversalIn(session, by.tenant, id)),
        } satisfies Journal;
      }),

      provideContract(JournalAdministration, (context: ModuleContext<Session>) => {
        const engine = postingEngine(context);
        const { journalEntry } = FIN_PERMISSIONS;

        return {
          // Ask, then prepare, then post in a transaction of this module's own:
          // the accountant's reversal is the engine driven from inside this
          // module, under this module's right, and nothing more.
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
 * The machine a command is being run at, in the one spelling this module files
 * it under — or null, for a command run at no register.
 *
 * `SYS` stores which machine holds a till through `parseId`, so a UUID is
 * case-insensitive there as the specification says it is. A device id arriving
 * on the context in another case — off a wire, out of `SYN-02`'s replay — would
 * otherwise be a machine that holds no till, and an entry numbered in the
 * branch's series that the till had already numbered in its own. Read once
 * here, as `FX` reads it, so that the till an entry is made at and the machine
 * its number is issued to cannot disagree about which machine that is.
 */
function machineOf(by: CommandContext): DeviceId | null {
  const device = by.device as unknown;
  return typeof device === 'string' && isId(device) ? parseId<'device'>(device) : null;
}

/**
 * The engine of `FIN-02`, as `PostingEngine` publishes it — built once per
 * contract that drives it, because it holds nothing.
 *
 * `prepare` asks in the order that costs a refused caller the least: the
 * draft's own shape, which costs nothing; then `SYS`, whether the branch
 * trades; then `FX`, what the books are kept in; then `SYS` again, for the
 * till; and only then this module's own read. Every one of those contract calls
 * opens a transaction of the other module's, which is why none of them can
 * happen inside `post` — the caller's transaction is already open there, and
 * one command never holds two.
 */
function postingEngine<Session extends RecordSession>(
  context: ModuleContext<Session>,
): PostingEngine {
  const read = <T>(by: CommandContext, work: (session: Session) => T): Promise<T> =>
    context.transactor.run(by, (uow) => Promise.resolve(work(uow.session)));

  /**
   * The till the caller is standing at in this branch, or null: the machine on
   * the context, if a register of the branch is held by it. It decides which
   * series numbers the entry (`SYS-02`), and nothing else.
   */
  const registerOf = async (by: CommandContext, branch: BranchId): Promise<RegisterId | null> => {
    const device = machineOf(by);
    if (device === null) return null;
    const registers = await context.require(Organisation).registers(by, branch);
    return registers.find((one) => one.heldBy === device)?.id ?? null;
  };

  /** What the books are kept in, and every currency an amount may be stated in (`FX-02`). */
  const booksOf = async (by: CommandContext): Promise<Result<Books, PostingRefusal>> => {
    const currencies = context.require(Currencies);
    const functional = await currencies.functional(by);
    if (functional === null) return refuse('fin.functional-currency-unset');
    // Every currency the tenant has, in use or not: an amount is still stated
    // in a currency the shop has since stopped taking.
    return ok({ functional, currencies: await currencies.currencies(by, { including: 'all' }) });
  };

  const making = (by: CommandContext, register: RegisterId | null): Making => ({
    tenant: by.tenant,
    register,
    by: by.actor,
    device: machineOf(by),
    // The clock is read once, here, so that every entry of one command carries
    // one moment.
    at: context.clock.now(),
  });

  return {
    prepare: async (by: CommandContext, draft: EntryDraft) => {
      const judged = draftArriving(draft);
      if (!judged.ok) return judged;

      // Booked at a shop that trades: a withdrawn branch issues no documents,
      // so there is nothing for it to post — the answer `FX` gives a stamp.
      const branch = await context.require(Organisation).branch(by, judged.value.branch);
      if (branch === null) return refuse('fin.branch-not-found', { branch: judged.value.branch });
      if (!branch.active) return refuse('fin.branch-inactive', { branch: branch.id });

      const books = await booksOf(by);
      if (!books.ok) return books;
      const register = await registerOf(by, branch.id);

      return read(by, (session) =>
        prepareEntry(
          session,
          context.declaredAccounts,
          books.value,
          making(by, register),
          judged.value,
        ),
      );
    },

    prepareReversal: async (by: CommandContext, original: JournalEntryId, terms: ReversalTerms) => {
      const basis = await read(by, (session) =>
        reversalArriving(session, by.tenant, original, terms),
      );
      if (!basis.ok) return basis;
      // At the original's branch, which is the only branch a correction of it
      // can be booked at, and at the till the caller stands at, if any.
      const register = await registerOf(by, basis.value.original.entry.branch);
      return ok(reversalOf(basis.value, making(by, register)));
    },

    post: (uow: UnitOfWork<RecordSession>, prepared: PreparedEntry) =>
      postEntry(uow, context.require(DocumentNumbering), prepared),

    accept: (uow: UnitOfWork<RecordSession>, arrived: Posted) =>
      Promise.resolve(acceptEntry(uow.session, uow.context.tenant, arrived, context.clock.now())),
  };
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
