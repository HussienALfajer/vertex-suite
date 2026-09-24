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
  systemContext,
  untilCommitted,
  type Authoriser,
  type CommandContext,
  type MemorySession,
  type PermissionDeclaration,
} from '@vertex/platform';
import { OWNER, SEEDED_ROLES, type PermissionId } from '@vertex/contracts';
import { catModule, Catalogue, CatalogueAdministration } from '@vertex/cat';
import { prcModule, PriceLists, PriceListAdministration, UsdPrices } from '@vertex/prc';
import {
  ChartAdministration,
  ChartOfAccounts,
  FiscalCalendar,
  FiscalCalendarAdministration,
  Journal,
  JournalAdministration,
  PostingExceptionAdministration,
  PostingExceptions,
  Statements,
  finModule,
  type AttachmentStore,
} from '@vertex/fin';
import {
  Currencies,
  CurrencyAdministration,
  ExchangeRates,
  RateAdministration,
  fxModule,
} from '@vertex/fx';
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
import type { Branch } from '@vertex/sys/contract';

import { DEMO_LOCATIONS, DEMO_ORGANISATION, DEMO_RATES } from './demo/catalogue.js';
import type {
  CalendarOfRecord,
  ChartOfRecord,
  CurrenciesOfRecord,
  DeclaredRight,
  JournalOfRecord,
  OrganisationOfRecord,
  PostingExceptionsOfRecord,
  RatesOfRecord,
  SignInAttempt,
  StatementsOfRecord,
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
 * **`SYS` and `FX` are not stood in for. They are the real ones, hosted here.**
 * Nothing in either needs a machine: both are ordinary modules over the memory
 * store the platform ships, and both run in a browser exactly as they run on a
 * store node. Writing a fake organisation, or a fake currency, would have meant
 * writing a second implementation of every rule the screens are built on —
 * that two branches in one company may not share a name, that a rounding step
 * cannot be finer than a currency's own stored precision — and a screen
 * developed against a second implementation is a screen developed against a
 * guess. The composition here is the real edition composition, the real
 * registry and the real transactor, for the same reason `edition.fixture.ts`
 * is.
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
  /**
   * Open the shop already set up — `DEMO_ORGANISATION` and `DEMO_RATES`,
   * below — rather than empty.
   *
   * Off unless asked for, and only `main.tsx` asks, under `pnpm demo`. Every
   * test and every journey is about a shop somebody sets up from nothing
   * (`SYS-09`'s acceptance criterion is exactly that journey), so an empty
   * shop is the default and a furnished one is the exception a person
   * exploring the screens opts into.
   */
  readonly demo?: boolean;
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

  /**
   * Where the bytes of an attachment would go, if anything attached one yet.
   *
   * `finModule` asks a host for this the way it asks for a session driver —
   * where files live is a fact about the installation, not about the ledger
   * (`AttachmentStore`) — so it is answered before the module composes rather
   * than when a screen first needs it. A `Map` is the honest answer for a
   * browser: the evidence an accountant attaches to a manual entry (`FIN-04`)
   * lives as long as the tab does, which is exactly as long as the shop this
   * file stands in for does. Copied on the way in and on the way out, so a
   * caller cannot reach back into what it handed over.
   */
  const attachmentBytes = new Map<string, Uint8Array>();
  const attachments: AttachmentStore = {
    put(key, bytes) {
      attachmentBytes.set(key, Uint8Array.from(bytes));
      return Promise.resolve();
    },
    get(key) {
      const found = attachmentBytes.get(key);
      return Promise.resolve(found === undefined ? null : Uint8Array.from(found));
    },
  };

  const catalogue = [
    sysModule<MemorySession>(),
    authorityStandIn(),
    fxModule<MemorySession>(),
    finModule<MemorySession>({ attachments }),
    catModule<MemorySession>(),
    prcModule<MemorySession>(),
  ];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC', 'FX', 'FIN', 'CAT', 'PRC'] }),
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
  const currenciesRead = registry.require(Currencies);
  const currenciesAdmin = registry.require(CurrencyAdministration);
  const ratesRead = registry.require(ExchangeRates);
  const ratesAdmin = registry.require(RateAdministration);
  const chartRead = registry.require(ChartOfAccounts);
  const chartAdmin = registry.require(ChartAdministration);
  const calendarRead = registry.require(FiscalCalendar);
  const calendarAdmin = registry.require(FiscalCalendarAdministration);
  const journalRead = registry.require(Journal);
  const journalAdmin = registry.require(JournalAdministration);
  const exceptionsRead = registry.require(PostingExceptions);
  const exceptionsAdmin = registry.require(PostingExceptionAdministration);
  const statementsRead = registry.require(Statements);
  const catRead = registry.require(Catalogue);
  const catAdmin = registry.require(CatalogueAdministration);
  const priceRead = registry.require(PriceLists);
  const priceAdmin = registry.require(PriceListAdministration);
  const usdPrices = registry.require(UsdPrices);

  let priceSeed: Promise<void> | null = null;
  function ensurePriceLists(): Promise<void> {
    priceSeed ??= (async () => {
      try {
        orThrow(await priceAdmin.seed(systemContext(tenant)), (error) => new Error(error.code));
      } catch (cause) {
        priceSeed = null;
        throw cause;
      }
    })();
    return priceSeed;
  }

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

  /**
   * A seed's step, run again when it lost a race. The demo's seed and the
   * currencies' seed start from the same first render and commit through the
   * same store, so either can be the one that finds the store changed under
   * it; the platform's bounded retry is what runs it again.
   */
  const retrying = <T>(attempt: () => Promise<T>): Promise<T> => untilCommitted(attempt);

  const demo = options.demo === true;

  /**
   * `DEMO_ORGANISATION`, opened through the same commands a screen calls — at
   * the system's own place rather than a signed-in person's, as the
   * currencies' seed below is, because nobody is signed in yet and nobody's
   * rights are in question. Nothing at all unless `demo`.
   *
   * One promise for every caller, so two screens mounting at once wait on the
   * same seed rather than racing it into every company twice. Not reset when
   * it fails, unlike the currencies' seed: that one is idempotent and this one
   * is not — a second attempt would find the first company already registered
   * and be refused for it. A step that lost a race is retried where it stands,
   * by `retrying`; anything else is a defect in the demo, and says so.
   */
  let demoShop: Promise<void> | null = null;
  // Which of the branches opened below start with today's rates — filled as
  // they open, since their identifiers exist nowhere else, and read only by
  // `ensureRatesReady`, which waits for this seed to finish first.
  const pricedBranches: Branch['id'][] = [];
  function ensureDemoShop(): Promise<void> {
    if (!demo) return Promise.resolve();
    demoShop ??= (async () => {
      for (const company of DEMO_ORGANISATION) {
        const registered = orThrow(
          await retrying(() =>
            admin.companies.register(systemContext(tenant), { name: company.name }),
          ),
          (refusal) => new Error(`Seeding a company was refused: ${refusal.code}`),
        );
        for (const branch of company.branches) {
          const opened = orThrow(
            await retrying(() =>
              admin.branches.open(systemContext(tenant), {
                company: registered.id,
                name: branch.name,
                address: branch.address,
              }),
            ),
            (refusal) => new Error(`Seeding a branch was refused: ${refusal.code}`),
          );
          if (branch.hasRates === true) pricedBranches.push(opened.id);
          for (const location of DEMO_LOCATIONS) {
            orThrow(
              await retrying(() =>
                admin.locations.open(systemContext(tenant), {
                  branch: opened.id,
                  name: location.name,
                  kind: location.kind,
                  ...(location.address === undefined ? {} : { address: location.address }),
                }),
              ),
              (refusal) => new Error(`Seeding a location was refused: ${refusal.code}`),
            );
          }

          if (branch.register !== undefined) {
            const till = branch.register;
            const openedRegister = orThrow(
              await retrying(() =>
                admin.registers.open(systemContext(tenant), {
                  branch: opened.id,
                  name: till.name,
                  prefix: till.prefix,
                }),
              ),
              (refusal) => new Error(`Seeding a register was refused: ${refusal.code}`),
            );
            // The identifier a real terminal generates for itself on its
            // first run; the demo has no terminal to read one from.
            orThrow(
              await retrying(() =>
                admin.registers.assignDevice(
                  systemContext(tenant),
                  openedRegister.id,
                  newId<'device'>(),
                ),
              ),
              (refusal) => new Error(`Seeding a device was refused: ${refusal.code}`),
            );
          }
        }
      }
    })();
    return demoShop;
  }

  /**
   * A read of the organisation, asked once the demo's shop — if there is one
   * — is in place.
   *
   * Who is asking is settled first, and synchronously: a read on behalf of
   * nobody is a defect, and it throws where it is asked (`README.md`: a
   * defect is an exception) rather than turning into a rejected promise
   * because a seed happened to be awaited ahead of it.
   */
  function afterDemo<T>(ask: (context: CommandContext) => Promise<T>): Promise<T> {
    const context = by();
    return demo ? ensureDemoShop().then(() => ask(context)) : ask(context);
  }

  const organisation: OrganisationOfRecord = {
    companies: {
      list: (listing) => afterDemo((context) => read.companies(context, listing)),
      register: (input) => admin.companies.register(by(), input),
      rename: (id, name) => admin.companies.rename(by(), id, name),
      deactivate: (id) => admin.companies.deactivate(by(), id),
      reactivate: (id) => admin.companies.reactivate(by(), id),
    },
    branches: {
      list: (listing) => afterDemo((context) => read.branches(context, listing)),
      open: (input) => admin.branches.open(by(), input),
      rename: (id, name) => admin.branches.rename(by(), id, name),
      readdress: (id, address) => admin.branches.readdress(by(), id, address),
      locate: (id, point) => admin.branches.locate(by(), id, point),
      deactivate: (id) => admin.branches.deactivate(by(), id),
      reactivate: (id) => admin.branches.reactivate(by(), id),
    },
    locations: {
      list: (branch, listing) => afterDemo((context) => read.locations(context, branch, listing)),
      open: (input) => admin.locations.open(by(), input),
      rename: (id, name) => admin.locations.rename(by(), id, name),
      readdress: (id, address) => admin.locations.readdress(by(), id, address),
      locate: (id, point) => admin.locations.locate(by(), id, point),
      deactivate: (id) => admin.locations.deactivate(by(), id),
      reactivate: (id) => admin.locations.reactivate(by(), id),
    },
    registers: {
      list: (branch, listing) => afterDemo((context) => read.registers(context, branch, listing)),
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

  /**
   * The four currencies of `FX-01`, ready before anybody asks for them.
   *
   * `seed` is idempotent and asks nothing of a specific person — `SYS-13`'s
   * first run has nobody signed in yet either — so it runs at the system's
   * own place the first time this port is used, rather than waiting for a
   * screen to trigger it explicitly. Cached in one promise so a second screen
   * mounting while the first is still seeding awaits the same attempt instead
   * of racing it and seeding twice — and cleared on failure, so a transport
   * hiccup is a `currencies.tsx` `reload()` away from trying again rather
   * than a refusal every caller is stuck with for the rest of the session.
   */
  let seeded: Promise<void> | null = null;
  function ensureCurrenciesSeeded(): Promise<void> {
    seeded ??= (async () => {
      try {
        orThrow(
          // `retrying`: the demo's seed may be committing through the same
          // store at the same moment.
          await retrying(() => currenciesAdmin.seed(systemContext(tenant))),
          (refusal) => new Error(`Seeding currencies was refused: ${refusal.code}`),
        );
      } catch (cause) {
        seeded = null;
        throw cause;
      }
    })();
    return seeded;
  }

  const currencies: CurrenciesOfRecord = {
    list: async (listing) => {
      await ensureCurrenciesSeeded();
      return currenciesRead.currencies(by(), listing);
    },
    functional: async () => {
      await ensureCurrenciesSeeded();
      return currenciesRead.functional(by());
    },
    define: async (input) => {
      await ensureCurrenciesSeeded();
      return currenciesAdmin.define(by(), input);
    },
    revise: async (code, changes) => {
      await ensureCurrenciesSeeded();
      return currenciesAdmin.revise(by(), code, changes);
    },
    disable: async (code) => {
      await ensureCurrenciesSeeded();
      return currenciesAdmin.disable(by(), code);
    },
    enable: async (code) => {
      await ensureCurrenciesSeeded();
      return currenciesAdmin.enable(by(), code);
    },
    makeFunctional: async (code) => {
      await ensureCurrenciesSeeded();
      return currenciesAdmin.makeFunctional(by(), code);
    },
  };

  /**
   * What every rate command waits for: the currencies, and in a demo the
   * demo's own rates — `DEMO_RATES` at every branch that starts with them,
   * recorded through the real `record` at the system's own place.
   *
   * Every method of `rates` waits for the whole of it rather than for the
   * currencies alone, because a rate somebody typed before the demo's were
   * recorded would be overwritten by them as the day's next revision — a
   * correction nobody asked for. Not reset on failure, for the reason
   * `ensureDemoShop` gives.
   */
  let demoRates: Promise<void> | null = null;
  function ensureRatesReady(): Promise<void> {
    if (!demo) return ensureCurrenciesSeeded();
    demoRates ??= (async () => {
      await Promise.all([ensureDemoShop(), ensureCurrenciesSeeded()]);
      for (const branch of pricedBranches) {
        for (const { currency, quote } of DEMO_RATES) {
          orThrow(
            await retrying(() => ratesAdmin.record(systemContext(tenant), branch, currency, quote)),
            (refusal) => new Error(`Seeding a rate was refused: ${refusal.code}`),
          );
        }
      }
    })();
    return demoRates;
  }

  const rates: RatesOfRecord = {
    board: async (branch) => {
      await ensureRatesReady();
      return ratesRead.board(by(), branch);
    },
    record: async (branch, currency, quote) => {
      await ensureRatesReady();
      return ratesAdmin.record(by(), branch, currency, quote);
    },
    suggest: async (currency, quote) => {
      await ensureRatesReady();
      return ratesAdmin.suggest(by(), currency, quote);
    },
    adopt: async (branch) => {
      await ensureRatesReady();
      return ratesAdmin.adopt(by(), branch);
    },
  };

  /**
   * The retail chart of `FIN-01` and the first fiscal year of `FIN-05`, ready
   * before anybody asks for either.
   *
   * Both are installation's rather than an accountant's (`SYS-03`), which is
   * why neither port offers a `seed` — so they run here, at the system's own
   * place, exactly as `FX`'s currencies do and for the same reasons: both
   * seeds are idempotent, neither asks anything of a specific person, and one
   * promise is cached so two screens mounting at once await the same attempt
   * instead of racing it.
   *
   * **The chart waits for the currencies**, and that order is `FIN-01`'s own:
   * the seed opens one cash account per currency the tenant has, so a chart
   * seeded first would be a chart with a cash group and nothing under it. A
   * currency defined afterwards reaches the ledger through the event `FIN`
   * subscribes to, not through here.
   *
   * Cleared on failure, as the currencies' seed is: a transport that hiccuped
   * is a `reload()` away from trying again rather than a refusal every caller
   * is stuck with for the session.
   */
  let ledger: Promise<void> | null = null;
  function ensureLedgerSeeded(): Promise<void> {
    ledger ??= (async () => {
      try {
        await ensureCurrenciesSeeded();
        orThrow(
          await retrying(() => chartAdmin.seed(systemContext(tenant))),
          (refusal) => new Error(`Seeding the chart of accounts was refused: ${refusal.code}`),
        );
        orThrow(
          await retrying(() => calendarAdmin.seed(systemContext(tenant))),
          (refusal) => new Error(`Seeding the fiscal calendar was refused: ${refusal.code}`),
        );
      } catch (cause) {
        ledger = null;
        throw cause;
      }
    })();
    return ledger;
  }

  const chart: ChartOfRecord = {
    tree: async (listing) => {
      await ensureLedgerSeeded();
      return chartRead.tree(by(), listing);
    },
    add: async (input) => {
      await ensureLedgerSeeded();
      return chartAdmin.add(by(), input);
    },
    rename: async (id, name) => {
      await ensureLedgerSeeded();
      return chartAdmin.rename(by(), id, name);
    },
    move: async (id, parent) => {
      await ensureLedgerSeeded();
      return chartAdmin.move(by(), id, parent);
    },
    withdraw: async (id) => {
      await ensureLedgerSeeded();
      return chartAdmin.withdraw(by(), id);
    },
    restore: async (id) => {
      await ensureLedgerSeeded();
      return chartAdmin.restore(by(), id);
    },
  };

  const calendar: CalendarOfRecord = {
    years: async () => {
      await ensureLedgerSeeded();
      return calendarRead.years(by());
    },
    reopenings: async () => {
      await ensureLedgerSeeded();
      return calendarRead.reopenings(by());
    },
    append: async (shape) => {
      await ensureLedgerSeeded();
      return calendarAdmin.append(by(), shape);
    },
    redefine: async (year, definition) => {
      await ensureLedgerSeeded();
      return calendarAdmin.redefine(by(), year, definition);
    },
    close: async (period) => {
      await ensureLedgerSeeded();
      return calendarAdmin.close(by(), period);
    },
    reopen: async (period, reason) => {
      await ensureLedgerSeeded();
      return calendarAdmin.reopen(by(), period, reason);
    },
  };

  /**
   * The journal, the exceptions queue and the statements, over the real `FIN`.
   *
   * Each waits on the same seed the chart and the calendar wait on, for the
   * same reason: an entry is posted into an accounting period and onto an
   * account, and a screen that asked before either existed would be told the
   * books have no calendar rather than shown the shop's.
   *
   * There is nothing stood in for here. A manual entry made through this port
   * is posted by the engine that posts a sale, refused by the calendar that
   * refuses one, and numbered by the `SYS` series that numbers one.
   */
  const journal: JournalOfRecord = {
    entries: async (listing) => {
      await ensureLedgerSeeded();
      return journalRead.entries(by(), listing);
    },
    entry: async (id) => {
      await ensureLedgerSeeded();
      return journalRead.entry(by(), id);
    },
    reversalOf: async (id) => {
      await ensureLedgerSeeded();
      return journalRead.reversalOf(by(), id);
    },
    attachment: async (entry, ordinal) => {
      await ensureLedgerSeeded();
      return journalRead.attachment(by(), entry, ordinal);
    },
    record: async (entry) => {
      await ensureLedgerSeeded();
      return journalAdmin.record(by(), entry);
    },
    open: async (balances) => {
      await ensureLedgerSeeded();
      return journalAdmin.open(by(), balances);
    },
    reverse: async (original, terms) => {
      await ensureLedgerSeeded();
      return journalAdmin.reverse(by(), original, terms);
    },
  };

  const postingExceptions: PostingExceptionsOfRecord = {
    exceptions: async (listing) => {
      await ensureLedgerSeeded();
      return exceptionsRead.exceptions(by(), listing);
    },
    post: async (id, decision) => {
      await ensureLedgerSeeded();
      return exceptionsAdmin.post(by(), id, decision);
    },
  };

  const statements: StatementsOfRecord = {
    trialBalance: async (request) => {
      await ensureLedgerSeeded();
      return statementsRead.trialBalance(by(), request);
    },
    incomeStatement: async (request) => {
      await ensureLedgerSeeded();
      return statementsRead.incomeStatement(by(), request);
    },
    balanceSheet: async (request) => {
      await ensureLedgerSeeded();
      return statementsRead.balanceSheet(by(), request);
    },
    generalLedger: async (request) => {
      await ensureLedgerSeeded();
      return statementsRead.generalLedger(by(), request);
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
    catalogue: {
      categories: () => catRead.categories(by()),
      category: (id) => catRead.category(by(), id),
      items: () => catRead.items(by()),
      item: (id) => catRead.item(by(), id),
      units: (id) => catRead.units(by(), id),
      convert: (id, amount, from, to) => catRead.convert(by(), id, amount, from, to),
      stockQuantity: (id, amount, from) => catRead.stockQuantity(by(), id, amount, from),
      eligibility: (id, trade) => catRead.eligibility(by(), id, trade),
      createCategory: (input) => catAdmin.createCategory(by(), input),
      reviseCategory: (id, revision) => catAdmin.reviseCategory(by(), id, revision),
      moveCategory: (id, parent) => catAdmin.moveCategory(by(), id, parent),
      createItem: (input) => catAdmin.createItem(by(), input),
      addUnit: (id, input) => catAdmin.addUnit(by(), id, input),
      changeItemStatus: (id, status, reason) => catAdmin.changeItemStatus(by(), id, status, reason),
      scan: (code) => catRead.scan(by(), code),
      barcode: (code) => catRead.barcode(by(), code),
      search: (term, limit) => catRead.search(by(), term, limit),
      addBarcode: (id, input) => catAdmin.addBarcode(by(), id, input),
      deactivateBarcode: (code, reason) => catAdmin.deactivateBarcode(by(), code, reason),
      reactivateBarcode: (code, reason) => catAdmin.reactivateBarcode(by(), code, reason),
    },
    priceLists: {
      list: async () => {
        await ensurePriceLists();
        return priceRead.list(by());
      },
      get: async (id) => {
        await ensurePriceLists();
        return priceRead.get(by(), id);
      },
      subject: async (subject) => {
        await ensurePriceLists();
        return priceRead.subject(by(), subject);
      },
      create: async (name) => {
        await ensurePriceLists();
        return priceAdmin.create(by(), name);
      },
      rename: async (id, name) => {
        await ensurePriceLists();
        return priceAdmin.rename(by(), id, name);
      },
      deactivate: async (id) => {
        await ensurePriceLists();
        return priceAdmin.deactivate(by(), id);
      },
    },
    usdPrices: {
      get: (subject) => usdPrices.get(by(), subject),
      forItem: (item) => usdPrices.forItem(by(), item),
      history: (filter) => usdPrices.history(by(), filter),
      set: (command) => usdPrices.set(by(), command),
    },
    users: usersPort,
    currencies,
    rates,
    chart,
    calendar,
    journal,
    postingExceptions,
    statements,
  };
}
