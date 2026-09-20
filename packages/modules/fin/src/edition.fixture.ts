import type { BranchId, DeviceId, RegisterId, TenantId } from '@vertex/contracts';
import type { CurrencyCode, LocalDate, Result } from '@vertex/kernel';
import {
  instant,
  isId,
  manualClock,
  money,
  newId,
  ok,
  orThrow,
  parseId,
  refuse,
  type Id,
  type ManualClock,
} from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  contractKey,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  defineModule,
  provideContract,
  systemContext,
  type AccountRoleDeclaration,
  type AuthorisationScope,
  type Authoriser,
  type CommandContext,
  type MemorySession,
  type MemoryStore,
  type ModuleDefinition,
  type Registry,
  type SessionDriver,
  type UnitOfWork,
} from '@vertex/platform';
import {
  Currencies,
  CurrencyDefined,
  ROUNDING_ACCOUNT,
  type TenantCurrency,
} from '@vertex/fx/contract';
import {
  DEFAULT_TIME_ZONE,
  DocumentNumbering,
  Organisation,
  type Branch,
  type IssuedNumber,
  type NumberingRefusal,
  type RecordSession,
  type Register,
  type SeriesScope,
} from '@vertex/sys/contract';

import {
  ChartAdministration,
  ChartOfAccounts,
  FiscalCalendar,
  FiscalCalendarAdministration,
  Journal,
  JournalAdministration,
  PostingEngine,
  PostingExceptionAdministration,
  PostingExceptions,
  type EntryDraft,
  type Posted,
  type PostingRefusal,
} from './contract.js';
import { finModule } from './index.js';

/**
 * `FIN` installed the way a store node installs it, over the **contracts** of
 * the modules beneath it.
 *
 * The real edition composition, the real registry and the real transactor over
 * the memory store the platform ships — so a test that passes is a statement
 * about the module as an edition hosts it. The build excludes `*.fixture.ts`,
 * so none of this ships.
 *
 * `SYS`, `SEC` and `FX` are stood in for, as `FX`'s suite stands `SYS` in:
 * `modules.md` §4.1 lets `FIN` rely on their published interfaces and nothing
 * more, and a test composing the real ones would be asserting things `FIN` is
 * not allowed to know. Each stand-in answers the questions `FIN` actually asks
 * and raises on any other, so that a change which started asking something new
 * fails here instead of widening the coupling unremarked. Of `SYS` those are
 * the tenant's branches, one branch, the registers of a branch, and the next
 * document number inside the caller's own transaction; of `FX`, the
 * currencies and the functional one.
 *
 * The modules that will one day post — `STK`, `CSH`, `SAL` — are stood in for
 * by their **declarations** alone: a role each, reserved or not, so that the
 * mapping of `FIN-01` has something to map. `FIN` never learns what any of them
 * does, which is the point of a role.
 */
export interface Installed {
  readonly registry: Registry<MemorySession>;
  readonly store: MemoryStore;
  readonly chart: ChartOfAccounts;
  readonly admin: ChartAdministration;
  readonly calendar: FiscalCalendar;
  readonly calendarAdmin: FiscalCalendarAdministration;
  readonly posting: PostingEngine;
  readonly journal: Journal;
  readonly journalAdmin: JournalAdministration;
  readonly exceptions: PostingExceptions;
  readonly exceptionsAdmin: PostingExceptionAdministration;
  /** The shop's time. Noon in Damascus on 20 September 2026, which is 09:00 UTC. */
  readonly clock: ManualClock;
  readonly tenant: Id<'tenant'>;
  /** A person acting in the tenant. What they may do is whatever `answers` says. */
  readonly by: CommandContext;
  /** The system: first-run installation, a migration, a sync. It has nobody to ask about. */
  readonly system: CommandContext;
  /** A second tenant on the same store node, which is the normal case. */
  readonly otherTenant: Id<'tenant'>;
  readonly byOther: CommandContext;
  /**
   * The transaction of a business event — a sale, a goods receipt — as the
   * module that owns the event would open it. A test that posts inside one is
   * the test `FIN-02` asks for: the event and its entry commit together, or
   * neither does.
   */
  run<T>(by: CommandContext, work: (uow: UnitOfWork<MemorySession>) => Promise<T>): Promise<T>;
  /**
   * What the stand-in authority answers, for a test that came to prove a guard
   * is live rather than to exercise the command behind it. Everything, by
   * default: a fixture that refused by default would make every test of this
   * module a test of permissions.
   */
  answers(decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean): void;
  /** The currencies `FX` would report for a tenant, as this fixture has them. */
  currencies(tenant?: Id<'tenant'>): readonly TenantCurrency[];
  /**
   * `FX`'s `define` or `seed`, as `FIN` sees it: a currency exists, and the
   * event that says so is delivered after the commit, exactly as the real
   * module delivers it through the unit of work.
   *
   * `raced` makes the command that hears the event lose a race, once: another
   * command commits a change to the store between the subscriber's transaction
   * beginning and its commit, which is what a chart seed running on the same
   * first morning does — and what the serialising store then refuses.
   */
  defineCurrency(
    code: CurrencyCode,
    options?: { readonly tenant?: Id<'tenant'>; readonly raced?: boolean },
  ): Promise<void>;
  /** `FX`'s `disable`, as `FIN` sees it: the currency is still there, and no longer taken. */
  withdrawCurrency(code: CurrencyCode): void;
  /** `FX` for a tenant that has no currencies at all. */
  forgetCurrencies(tenant?: Id<'tenant'>): void;
  /**
   * `FX`'s `makeFunctional`, as `FIN` sees it: the currency the books are kept
   * in (`FX-02`) — or null, for a tenant that has never chosen one.
   */
  setFunctional(code: CurrencyCode | null): void;
  /**
   * A branch, as `SYS` would have opened one. In the order they are opened
   * here, which is the order their identifiers carry.
   */
  openBranch(options?: {
    readonly timeZone?: string;
    readonly tenant?: Id<'tenant'>;
    readonly active?: boolean;
  }): BranchId;
  /** Withdraws a branch, as `SYS`'s `deactivate` would. */
  closeBranch(branch: BranchId): void;
  /**
   * A till in a branch with a machine standing at it, as `SYS` would have
   * opened and paired one — and the context of somebody working at that
   * machine, which is what makes a command "made at a register".
   */
  openRegister(branch: BranchId, options?: { readonly prefix?: string }): AtRegister;
  /**
   * A whole posting through the engine of `FIN-02` — a goods receipt, ten
   * dollars of stock against cash — dated on a day, in a transaction of its
   * own, which the calendar either admits or refuses. What `FIN-05`'s tests
   * need of the engine, and nothing about how the entry is composed.
   */
  post(day: LocalDate, by?: CommandContext): Promise<Result<Posted, PostingRefusal>>;
  /**
   * An entry posted where it was made — at a register trading with the line
   * down — as far as this store is concerned: prepared, numbered and written
   * in a transaction this store never saw commit. What reaches the system of
   * record in `U07` is exactly this value, and `PostingEngine.accept` is the
   * door it comes through.
   */
  postedElsewhere(by: CommandContext, draft: EntryDraft): Promise<Posted>;
}

/** A register, the machine at it, and somebody working there. */
export interface AtRegister {
  readonly register: RegisterId;
  readonly device: DeviceId;
  readonly by: CommandContext;
}

/** 12:00 in Damascus, which keeps UTC+3 all year. */
export const NOON_IN_DAMASCUS = instant(Date.UTC(2026, 8, 20, 9, 0, 0));

/**
 * `SEC`'s answer, stood in for.
 *
 * `FIN` asks through `ModuleContext.authorise` and never learns who answers. The
 * edition hosts a module under the code `SEC` answering that one question,
 * under the key the real one publishes.
 */
const StandInAuthority = contractKey<Authoriser>('sec.authorisation');

function authorityStandIn(
  decide: () => (by: CommandContext, right: string, where?: AuthorisationScope) => boolean,
): ModuleDefinition<MemorySession> {
  return defineModule<MemorySession>({
    code: 'SEC',
    labelKey: 'module.sec',
    provides: [
      provideContract(StandInAuthority, () => ({
        may: (by: CommandContext, right: string, where?: AuthorisationScope) =>
          Promise.resolve(decide()(by, right, where)),
      })),
    ],
  });
}

/**
 * What `FIN` is entitled to know about a shop's structure: the branches, the
 * zone each counts its days in, and the tills with a machine standing at them.
 */
type Branches = Map<BranchId, Branch>;

type Registers = Map<RegisterId, Register>;

function unasked(module: string, method: string): never {
  throw new Error(
    `FIN asked ${module} for ${method}, which it has never needed. If that is now a real ` +
      `dependency, say so deliberately — it widens what FIN knows about ${module}.`,
  );
}

/**
 * The two shapes the real module refuses a series scope for, mirrored so that
 * what `FIN` hands `SYS` — its own document type, and the label it gives a
 * fiscal year — is held here to what `SYS` will actually take. A label `SYS`
 * refused would surface as a posting refused in every shop, on the first day of
 * a fiscal year nobody had tested.
 */
const DOCUMENT_TYPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FISCAL_YEAR = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/;

/**
 * `SYS-02` numbering, reduced to what `FIN` relies on from it: a counter that
 * moves in the **caller's** session and nowhere else, one number per document
 * however often it is asked for, a till's series numbered only by the machine
 * standing at it, and the default formats — so that what an entry is called
 * here is what the real module would call it.
 */
function issueNumber(
  registers: Registers,
  uow: UnitOfWork<RecordSession>,
  scope: SeriesScope,
  document: string,
): Result<IssuedNumber, NumberingRefusal> {
  if (!DOCUMENT_TYPE.test(scope.documentType)) {
    return refuse('sys.document-type-unowned', { documentType: scope.documentType });
  }
  if (!FISCAL_YEAR.test(scope.fiscalYear)) {
    return refuse('sys.fiscal-year-required', { fiscalYear: scope.fiscalYear });
  }
  const { session, context } = uow;
  const series = [scope.documentType, scope.branch, scope.register ?? '-', scope.fiscalYear]
    .map(encodeURIComponent)
    .join('|');
  const issuedKey = `standin/issued/${context.tenant}/${document}/${series}`;
  const already = session.get(issuedKey);
  if (already !== undefined) return ok(already as IssuedNumber);

  let prefix = '';
  let generation = 0;
  if (scope.register !== null) {
    const register = registers.get(scope.register);
    if (register === undefined)
      return refuse('sys.register-not-found', { register: scope.register });
    // Read as the real module reads it: a UUID in the one case every record is
    // filed under, so a machine's identifier arriving upper-cased is the machine.
    const machine =
      context.device !== null && isId(context.device) ? parseId<'device'>(context.device) : null;
    if (register.heldBy === null || register.heldBy !== machine) {
      return refuse('sys.register-held-elsewhere', { register: register.name });
    }
    prefix = register.prefix;
    generation = register.generation;
  }
  const counterKey = `standin/counter/${context.tenant}/${series}/${String(generation)}`;
  const sequence = (session.get(counterKey) as { readonly next: number } | undefined)?.next ?? 1;
  const padded = String(sequence).padStart(6, '0');
  const issued: IssuedNumber = {
    number:
      scope.register === null
        ? `${scope.fiscalYear}-${padded}`
        : `${prefix}-${String(generation)}-${scope.fiscalYear}-${padded}`,
    sequence,
    generation,
    scope,
  };
  session.put(counterKey, { next: sequence + 1 });
  session.put(issuedKey, issued);
  return ok(issued);
}

/**
 * `SYS`, stood in for: the tenant's branches, one branch, the tills of a
 * branch, and the next document number — inside the caller's transaction, as
 * the real module issues it.
 */
function organisationStandIn(
  branches: Branches,
  registers: Registers,
): ModuleDefinition<MemorySession> {
  return defineModule<MemorySession>({
    code: 'SYS',
    labelKey: 'module.sys',
    provides: [
      provideContract(Organisation, () => ({
        // Answered in the caller's tenant and nowhere else: a branch of another
        // shop group must be as absent to `FIN` as one that was never opened.
        branches: (by, listing) =>
          Promise.resolve(
            [...branches.values()].filter(
              (one) => one.tenant === by.tenant && (listing?.including === 'all' || one.active),
            ),
          ),
        branch: (by, id) => {
          const found = branches.get(id);
          return Promise.resolve(found?.tenant === by.tenant ? found : null);
        },
        registers: (by, branch, listing) =>
          Promise.resolve(
            [...registers.values()].filter(
              (one) =>
                one.tenant === by.tenant &&
                one.branch === branch &&
                (listing?.including === 'all' || one.active),
            ),
          ),
        company: () => unasked('SYS', 'a company'),
        location: () => unasked('SYS', 'a location'),
        register: () => unasked('SYS', 'a register'),
        companies: () => unasked('SYS', 'every company'),
        locations: () => unasked('SYS', 'the locations of a branch'),
        profile: () => unasked('SYS', 'a business profile'),
        setting: () => unasked('SYS', 'a setting'),
      })),
      provideContract(DocumentNumbering, () => ({
        next: (uow, scope, document) =>
          Promise.resolve(issueNumber(registers, uow, scope, document)),
        series: () => unasked('SYS', 'a numbering series'),
        configured: () => unasked('SYS', 'the configured series of a branch'),
        preview: () => unasked('SYS', 'a numbering specimen'),
      })),
    ],
  });
}

/**
 * A currency as `FX` would define it: the kernel's shape, at the precision the
 * real module seeds it — the pound stored to two places and settled to the
 * ten-pound note, the rest to four places, which is the ledger precision every
 * functional amount is held to. The rounding rules matter to nothing here; the
 * precision does, because a figure finer than it is one the engine refuses.
 */
function currencyNamed(tenant: TenantId, code: CurrencyCode): TenantCurrency {
  const pound = code === 'SYP';
  return {
    tenant,
    code,
    symbol: code,
    decimals: pound ? 2 : 4,
    roundingIncrement: pound ? '10' : '0.01',
    roundingMode: 'half-up',
    enabled: true,
  };
}

/** What each tenant keeps its books in (`FX-02`), as the stand-in holds it. */
type Functional = Map<TenantId, CurrencyCode | null>;

/**
 * `FX`, stood in for: the currencies of each tenant, the one the books are
 * kept in, the announcement of a new currency, and the one account role the
 * real module declares.
 *
 * Declares the event the real module declares, under its real name, because
 * the registry refuses a subscription to an event no module in the catalogue
 * publishes — which is how `FIN`'s subscription is held to the name `FX`
 * actually uses. And declares the rounding role under the real module's name
 * for it, so that what is proved here about `FX-07`'s residual reaching a
 * reserved account is proved about the role `FX` actually posts to.
 */
function currenciesStandIn(
  held: Map<TenantId, TenantCurrency[]>,
  functional: Functional,
): ModuleDefinition<MemorySession> {
  return defineModule<MemorySession>({
    code: 'FX',
    labelKey: 'module.fx',
    accounts: [
      {
        role: ROUNDING_ACCOUNT,
        labelKey: `account-role.${ROUNDING_ACCOUNT}`,
        normalBalance: 'credit',
        reserved: 'rounding',
      },
    ],
    publishes: [{ type: CurrencyDefined, labelKey: `event.${CurrencyDefined.name}` }],
    provides: [
      provideContract(Currencies, () => ({
        // In code order, as the real module lists them.
        currencies: (by, listing) =>
          Promise.resolve(
            (held.get(by.tenant) ?? [])
              .filter((one) => listing?.including === 'all' || one.enabled)
              .sort((one, other) => (one.code < other.code ? -1 : 1)),
          ),
        currency: () => unasked('FX', 'one currency'),
        functional: (by) =>
          Promise.resolve(
            (held.get(by.tenant) ?? []).find((one) => one.code === functional.get(by.tenant)) ??
              null,
          ),
      })),
    ],
  });
}

/**
 * Whoever will post, reduced to what `FIN-01` needs from them: the roles they
 * declare. Real module codes, because the platform refuses any other, and the
 * roles they would genuinely declare, so that what is proved here is the
 * resolution those modules will rely on.
 */
function declaring(
  code: 'STK' | 'CSH' | 'SAL',
  accounts: readonly AccountRoleDeclaration[],
): ModuleDefinition<MemorySession> {
  return defineModule<MemorySession>({ code, labelKey: `module.${code.toLowerCase()}`, accounts });
}

/** A role reserved for a purpose, as a module declares one. */
export const INVENTORY_ROLE = 'stk.inventory';
export const COGS_ROLE = 'stk.cost-of-goods-sold';
export const CASH_ROLE = 'csh.cash';
/** Roles nobody reserves, which the accountant maps by hand. */
export const EXPENSE_ROLE = 'csh.expense';
export const REVENUE_ROLE = 'sal.revenue';
/** A role no module in this edition declares. */
export const UNDECLARED_ROLE = 'pur.landed-cost';

export function installFin(): Installed {
  let decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean = () =>
    true;

  const held = new Map<TenantId, TenantCurrency[]>();
  const functional: Functional = new Map();
  const branches: Branches = new Map();
  const registers: Registers = new Map();
  const catalogue = [
    organisationStandIn(branches, registers),
    authorityStandIn(() => decide),
    currenciesStandIn(held, functional),
    finModule<MemorySession>(),
    declaring('STK', [
      {
        role: INVENTORY_ROLE,
        labelKey: `account-role.${INVENTORY_ROLE}`,
        normalBalance: 'debit',
        reserved: 'inventory',
      },
      {
        role: COGS_ROLE,
        labelKey: `account-role.${COGS_ROLE}`,
        normalBalance: 'debit',
        reserved: 'cogs',
      },
    ]),
    declaring('CSH', [
      {
        role: CASH_ROLE,
        labelKey: `account-role.${CASH_ROLE}`,
        normalBalance: 'debit',
        reserved: 'cash',
      },
      { role: EXPENSE_ROLE, labelKey: `account-role.${EXPENSE_ROLE}`, normalBalance: 'debit' },
    ]),
    declaring('SAL', [
      { role: REVENUE_ROLE, labelKey: `account-role.${REVENUE_ROLE}`, normalBalance: 'credit' },
    ]),
  ];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC', 'FX', 'FIN', 'STK', 'CSH', 'SAL'] }),
    (refusal) => new Error(`The edition would not compose: ${refusal.code}`),
  );

  const clock = manualClock(NOON_IN_DAMASCUS);
  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw new Error(`A subscriber failed: ${String(failure.cause)}`);
    },
  });
  const store = createMemoryStore();

  // How many of the transactions that begin next are made to lose: another
  // transaction commits a fresh key between their `begin` and their commit,
  // so a transaction that scans the store is refused at its commit.
  let racesToLose = 0;
  const driver: SessionDriver<MemorySession> = {
    async begin(context) {
      const session = await store.driver.begin(context);
      if (racesToLose > 0) {
        racesToLose -= 1;
        const other = await store.driver.begin(context);
        other.put(`fixture/race/${String(racesToLose)}`, { lost: true });
        await store.driver.commit(other);
      }
      return session;
    },
    commit: (session) => store.driver.commit(session),
    rollback: (session) => store.driver.rollback(session),
  };
  const transactor = createTransactor({
    driver,
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
    authorisedBy: StandInAuthority,
  });

  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();
  held.set(
    tenant,
    ['EUR', 'SYP', 'TRY', 'USD'].map((code) => currencyNamed(tenant, code)),
  );
  held.set(otherTenant, [currencyNamed(otherTenant, 'USD')]);
  // The dollar, as `FX-01` seeds it and `FX-02` makes it — for both tenants,
  // so that a test which never mentions the functional currency is a test of a
  // shop set up the ordinary way.
  functional.set(tenant, 'USD');
  functional.set(otherTenant, 'USD');

  const posting = registry.require(PostingEngine);
  const admin = registry.require(ChartAdministration);

  const openBranch = (
    options: {
      readonly timeZone?: string;
      readonly tenant?: Id<'tenant'>;
      readonly active?: boolean;
    } = {},
  ): BranchId => {
    const branch: Branch = {
      id: newId<'branch'>(),
      tenant: options.tenant ?? tenant,
      company: newId<'company'>(),
      name: 'Aleppo',
      address: '',
      point: null,
      timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
      active: options.active ?? true,
    };
    branches.set(branch.id, branch);
    return branch.id;
  };

  /** The branch a posting with no branch of its own is booked at: the tenant's first, opened if there is none. */
  const someBranch = (of: TenantId): BranchId =>
    [...branches.values()].find((one) => one.tenant === of && one.active)?.id ??
    openBranch({ tenant: of });

  return {
    registry,
    store,
    chart: registry.require(ChartOfAccounts),
    admin,
    calendar: registry.require(FiscalCalendar),
    calendarAdmin: registry.require(FiscalCalendarAdministration),
    posting,
    journal: registry.require(Journal),
    journalAdmin: registry.require(JournalAdministration),
    exceptions: registry.require(PostingExceptions),
    exceptionsAdmin: registry.require(PostingExceptionAdministration),
    clock,
    tenant,
    by: commandContext({ tenant, actor: newId<'user'>() }),
    system: systemContext(tenant),
    otherTenant,
    byOther: commandContext({ tenant: otherTenant, actor: newId<'user'>() }),
    run: (by, work) => transactor.run(by, work),
    answers(
      next: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean,
    ): void {
      decide = next;
    },
    currencies: (of: Id<'tenant'> = tenant) => [...(held.get(of) ?? [])],
    withdrawCurrency(code) {
      held.set(
        tenant,
        (held.get(tenant) ?? []).map((one) =>
          one.code === code ? { ...one, enabled: false } : one,
        ),
      );
    },
    forgetCurrencies(of = tenant) {
      held.set(of, []);
      functional.set(of, null);
    },
    setFunctional(code) {
      functional.set(tenant, code);
    },
    openBranch,
    closeBranch(id) {
      const branch = branches.get(id);
      if (branch === undefined) throw new Error('No such branch to close.');
      branches.set(id, { ...branch, active: false });
    },
    openRegister(branch, options = {}): AtRegister {
      const device = newId<'device'>();
      const register: Register = {
        id: newId<'register'>(),
        tenant: branches.get(branch)?.tenant ?? tenant,
        branch,
        name: 'Till',
        prefix: options.prefix ?? 'T1',
        active: true,
        generation: 1,
        heldBy: device,
      };
      registers.set(register.id, register);
      return {
        register: register.id,
        device,
        by: commandContext({ tenant: register.tenant, actor: newId<'user'>(), device }),
      };
    },
    async post(day, by = commandContext({ tenant, actor: newId<'user'>() })) {
      // Ten dollars of stock received against cash: two roles every edition
      // reserves, so that a posting needs nothing mapped first. The chart is
      // seeded if it has not been, which is what a shop's first morning does.
      orThrow(
        await admin.seed(systemContext(by.tenant)),
        (refusal) => new Error(`The chart would not seed: ${refusal.code}`),
      );
      const prepared = await posting.prepare(by, {
        id: newId<'journal-entry'>(),
        source: { kind: 'stk.goods-receipt', document: newId<'goods-receipt'>() },
        branch: someBranch(by.tenant),
        day,
        lines: [
          { role: INVENTORY_ROLE, side: 'debit', amount: money('10', 'USD') },
          { role: CASH_ROLE, currency: 'USD', side: 'credit', amount: money('10', 'USD') },
        ],
      });
      if (!prepared.ok) return prepared;
      return transactor.run(by, (uow) => posting.post(uow, prepared.value));
    },
    async postedElsewhere(by, draft) {
      const prepared = orThrow(
        await posting.prepare(by, draft),
        (refusal) => new Error(`The entry would not prepare: ${refusal.code}`),
      );
      // Posted, then rolled back on purpose: the register's store committed
      // this and ours never did, which is the whole of what "elsewhere" means
      // to a store node. The value is kept; the transaction is not.
      const made: { value: Posted | null } = { value: null };
      const elsewhere = new Error('made elsewhere');
      try {
        await transactor.run(by, async (uow) => {
          made.value = orThrow(
            await posting.post(uow, prepared),
            (refusal) => new Error(`The entry would not post: ${refusal.code}`),
          );
          throw elsewhere;
        });
      } catch (cause) {
        if (cause !== elsewhere) throw cause;
      }
      if (made.value === null) throw new Error('Nothing was made elsewhere.');
      return made.value;
    },
    async defineCurrency(code, options = {}) {
      const of = options.tenant ?? tenant;
      const currency = currencyNamed(of, code);
      held.set(of, [...(held.get(of) ?? []), currency]);
      // Through the transactor, as the real `FX` publishes: the event is
      // delivered once this command has committed, and `FIN`'s handler runs a
      // command of its own after it.
      await transactor.run(systemContext(of), (uow) => {
        uow.publish(CurrencyDefined, { currency });
        // Armed inside this transaction, so that the next one to begin — the
        // subscriber's, after this commit — is the one that loses.
        if (options.raced === true) racesToLose = 1;
        return Promise.resolve();
      });
    },
  };
}
