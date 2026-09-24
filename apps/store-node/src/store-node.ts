import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';

import type { TenantId } from '@vertex/contracts';
import { catModule, Catalogue, CatalogueAdministration, CAT_PERMISSIONS } from '@vertex/cat';
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
  FIN_PERMISSIONS,
  finModule,
  type AttachmentStore,
} from '@vertex/fin';
import {
  Currencies,
  CurrencyAdministration,
  ExchangeRates,
  RateAdministration,
  FX_PERMISSIONS,
  fxModule,
} from '@vertex/fx';
import { Dec, isDecimalString, isId, isOk, orThrow, systemClock } from '@vertex/kernel';
import {
  prcModule,
  PriceLists,
  PriceListAdministration,
  UsdPrices,
  PRC_PERMISSIONS,
} from '@vertex/prc';
import {
  ANYWHERE,
  commandContext,
  composeEdition,
  createEventBus,
  createRegistry,
  createTransactor,
  operationMailboxMigrations,
  receiveOperation,
  runMigrations,
  systemContext,
  untilCommitted,
  type CommandContext,
  type MemorySession,
  type OperationEnvelope,
  type Receipt,
  type UnitOfWork,
} from '@vertex/platform';
import {
  Authorisation,
  Credentials,
  RoleAdministration,
  RoleDirectory,
  SEC_PERMISSIONS,
  TENANT_WIDE,
  UserAdministration,
  UserDirectory,
  secModule,
  type Authenticated,
} from '@vertex/sec';
import { openPostgresStore, type PostgresStoreOptions } from '@vertex/storage';
import {
  DELIVER_ROUTE,
  DEVICE_CREDENTIAL_HEADER,
  REFUSAL_STATUS,
  SESSION_PATH,
} from '@vertex/store-link';
import {
  DocumentNumbering,
  Organisation,
  OrganisationAdministration,
  SYS_PERMISSIONS,
  sysModule,
} from '@vertex/sys';

import {
  IdentityConflictError,
  STOCK_OPERATION_KINDS,
  stockFixtureMigrations,
  stockOperation,
} from './stock-fixture.js';

interface Session {
  readonly authenticated: Authenticated;
}

export interface StoreNodeListener {
  address(): AddressInfo | string | null;
  close(): Promise<void>;
}

export interface StoreNode {
  provisionTenant(tenant: TenantId, handle: string, password: string): Promise<void>;
  listen(port: number, host?: string): Promise<StoreNodeListener>;
  close(): Promise<void>;
}

type Dispatch = (by: CommandContext, args: readonly unknown[]) => Promise<unknown>;
interface Route {
  readonly read: boolean;
  readonly dispatch: Dispatch;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Expected an object.');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected text.');
  return value;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(
    JSON.stringify(value, function (this: Record<string, unknown>, key, member: unknown) {
      const original = this[key];
      return original instanceof Uint8Array
        ? { $type: 'vertex.bytes', base64: Buffer.from(original).toString('base64') }
        : member;
    }),
  );
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  let length = 0;
  for await (const part of request) {
    if (!Buffer.isBuffer(part)) throw new TypeError('Expected request bytes.');
    length += part.length;
    if (length > 14_000_000) throw new TypeError('Request body is too large.');
    parts.push(part);
  }
  return object(
    JSON.parse(Buffer.concat(parts).toString('utf8') || '{}', (_key, member: unknown) => {
      if (typeof member !== 'object' || member === null || Array.isArray(member)) return member;
      const encoded = member as Record<string, unknown>;
      if (encoded['$type'] !== 'vertex.bytes') return member;
      const base64 = encoded['base64'];
      if (
        typeof base64 !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)
      )
        throw new TypeError('Invalid attachment bytes.');
      return Uint8Array.from(Buffer.from(base64, 'base64'));
    }) as unknown,
  );
}

/** The host composes contracts; HTTP dispatch only selects and guards them. */
export interface StoreNodeOptions extends PostgresStoreOptions {
  readonly attachmentsDirectory: string;
  /** Only the SYN-02 integration fixture enables this narrow test command. */
  readonly enableSyn02Fixture?: boolean;
  /** Only the SYN-03 and SYN-05 acceptance fixtures enable these narrow stock operations. */
  readonly enableStockFixture?: boolean;
}

function applySyn02Fixture(uow: UnitOfWork<MemorySession>, payload: unknown): Promise<void> {
  const input = object(payload);
  const document = input['document'];
  const amount = input['amount'];
  if (
    typeof document !== 'string' ||
    !isId(document) ||
    typeof amount !== 'string' ||
    !isDecimalString(amount) ||
    !new Dec(amount).greaterThan(0)
  )
    throw new TypeError('Invalid SYN-02 fixture posting.');
  const documentKey = `syn02.fixture.document.${uow.context.tenant}.${document}`;
  if (uow.session.get(documentKey) !== undefined)
    throw new TypeError('Fixture document already exists.');
  const balanceKey = `syn02.fixture.balance.${uow.context.tenant}`;
  const previous = uow.session.get(balanceKey) ?? '0';
  if (typeof previous !== 'string' || !isDecimalString(previous))
    throw new Error('Corrupted SYN-02 fixture balance.');
  uow.session.put(documentKey, { document, amount });
  uow.session.put(balanceKey, new Dec(previous).plus(amount).toString());
  return Promise.resolve();
}

function deviceCredentialKey(tenant: TenantId, device: string): string {
  return `platform.device-credential.${tenant}.${device}`;
}

function credentialDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function credentialMatches(stored: unknown, token: string): boolean {
  if (typeof stored !== 'string' || !/^[0-9a-f]{64}$/u.test(stored)) return false;
  return timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(credentialDigest(token), 'hex'));
}

export async function composeStoreNode(options: StoreNodeOptions): Promise<StoreNode> {
  if (!options.attachmentsDirectory) throw new TypeError('An attachment directory is required.');
  await mkdir(options.attachmentsDirectory, { recursive: true });
  const attachments: AttachmentStore = {
    async put(key, bytes) {
      if (!/^fin\/attachment\/[0-9a-f-]{36}\/[0-9a-f]{64}$/u.test(key))
        throw new TypeError('Invalid attachment key.');
      const target = join(options.attachmentsDirectory, ...key.split('/'));
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomBytes(12).toString('hex')}.tmp`;
      try {
        const file = await open(temporary, 'wx');
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async get(key) {
      if (!/^fin\/attachment\/[0-9a-f-]{36}\/[0-9a-f]{64}$/u.test(key))
        throw new TypeError('Invalid attachment key.');
      try {
        return await readFile(join(options.attachmentsDirectory, ...key.split('/')));
      } catch (cause) {
        if (
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          cause.code === 'ENOENT'
        )
          return null;
        throw cause;
      }
    },
  };
  const catalogue = [
    sysModule<MemorySession>(),
    secModule<MemorySession>(),
    fxModule<MemorySession>(),
    finModule<MemorySession>({ attachments }),
    catModule<MemorySession>(),
    prcModule<MemorySession>(),
  ];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['SYS', 'SEC', 'FX', 'FIN', 'CAT', 'PRC'] }),
    (refusal) => new Error(`Store-node edition refused: ${refusal.code}`),
  );
  const store = await openPostgresStore(options);
  try {
    const bus = createEventBus({
      onHandlerFailure: (failure) => {
        throw new Error('Event handler failed.', { cause: failure.cause });
      },
    });
    const transactor = createTransactor({
      driver: store.driver,
      bus,
      clock: systemClock,
      onEffectFailure: (failure) => {
        throw new Error('Effect failed.', { cause: failure.cause });
      },
    });
    const registry = createRegistry({
      catalogue,
      plan,
      bus,
      transactor,
      clock: systemClock,
      authorisedBy: Authorisation,
    });
    await runMigrations({
      plan: [
        ...operationMailboxMigrations<MemorySession>(),
        ...(options.enableStockFixture ? stockFixtureMigrations() : []),
        ...registry.migrationPlan('store-node'),
      ],
      transactor,
      context: systemContext('00000000-0000-7000-8000-000000000000' as TenantId),
      journal: store.journal,
    });

    const organisation = registry.require(Organisation);
    const admin = registry.require(OrganisationAdministration);
    const numbering = registry.require(DocumentNumbering);
    const credentials = registry.require(Credentials);
    const users = registry.require(UserDirectory);
    const userAdmin = registry.require(UserAdministration);
    const roles = registry.require(RoleDirectory);
    const roleAdmin = registry.require(RoleAdministration);
    const authority = registry.require(Authorisation);
    const currencyRead = registry.require(Currencies);
    const currencyAdmin = registry.require(CurrencyAdministration);
    const rateRead = registry.require(ExchangeRates);
    const rateAdmin = registry.require(RateAdministration);
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
    const priceLists = registry.require(PriceLists);
    const priceAdmin = registry.require(PriceListAdministration);
    const usdPrices = registry.require(UsdPrices);
    const sessions = new Map<string, Session>();
    const servers = new Set<Server>();

    const routes = new Map<string, Route>();
    const write = (path: string, dispatch: Dispatch): void => {
      routes.set(path, { read: false, dispatch });
    };
    const securedWrite = (path: string, right: string, dispatch: Dispatch): void => {
      write(path, async (by, args) =>
        (await authority.may(by, right as Parameters<typeof authority.may>[1]))
          ? dispatch(by, args)
          : { forbidden: true },
      );
    };
    const read = (
      path: string,
      right: string,
      dispatch: Dispatch,
      scope?: (args: readonly unknown[]) => { branch?: string } | typeof ANYWHERE,
    ): void => {
      routes.set(path, {
        read: true,
        dispatch: async (by, args) => {
          const where = scope?.(args);
          if (
            !(await authority.may(
              by,
              right as Parameters<typeof authority.may>[1],
              where as Parameters<typeof authority.may>[2],
            ))
          )
            return { forbidden: true };
          return dispatch(by, args);
        },
      });
    };
    const tenantWide = async (by: CommandContext, right: string): Promise<boolean> =>
      authority.may(by, right as Parameters<typeof authority.may>[1]);
    // The catalogue is one set of records for every branch, and CAT asks its
    // reads wherever the right is held; the gate in front of it asks the same,
    // or a manager confined to one branch would be refused here what CAT would
    // answer them. Its writes stay behind the tenant-wide place.
    const shared = (path: string, right: string, dispatch: Dispatch): void => {
      read(path, right, dispatch, () => ANYWHERE);
    };

    shared('catalogue.categories', CAT_PERMISSIONS.category.view, (by) => catRead.categories(by));
    shared('catalogue.category', CAT_PERMISSIONS.category.view, (by, args) =>
      catRead.category(by, string(args[0]) as Parameters<typeof catRead.category>[1]),
    );
    shared('catalogue.items', CAT_PERMISSIONS.item.view, (by) => catRead.items(by));
    shared('catalogue.item', CAT_PERMISSIONS.item.view, (by, args) =>
      catRead.item(by, string(args[0]) as Parameters<typeof catRead.item>[1]),
    );
    shared('catalogue.units', CAT_PERMISSIONS.item.view, (by, args) =>
      catRead.units(by, string(args[0]) as Parameters<typeof catRead.units>[1]),
    );
    shared('catalogue.convert', CAT_PERMISSIONS.item.view, (by, args) =>
      catRead.convert(
        by,
        string(args[0]) as Parameters<typeof catRead.convert>[1],
        string(args[1]),
        string(args[2]) as Parameters<typeof catRead.convert>[3],
        string(args[3]) as Parameters<typeof catRead.convert>[4],
      ),
    );
    shared('catalogue.stockQuantity', CAT_PERMISSIONS.item.view, (by, args) =>
      catRead.stockQuantity(
        by,
        string(args[0]) as Parameters<typeof catRead.stockQuantity>[1],
        string(args[1]),
        string(args[2]) as Parameters<typeof catRead.stockQuantity>[3],
      ),
    );
    shared('catalogue.eligibility', CAT_PERMISSIONS.item.view, (by, args) =>
      catRead.eligibility(
        by,
        args[0] as Parameters<typeof catRead.eligibility>[1],
        args[1] as Parameters<typeof catRead.eligibility>[2],
      ),
    );
    shared('catalogue.scan', CAT_PERMISSIONS.item.view, (by, args) =>
      catRead.scan(by, string(args[0])),
    );
    shared('catalogue.barcode', CAT_PERMISSIONS.item.view, (by, args) =>
      catRead.barcode(by, string(args[0])),
    );
    // Passed as sent: a term or a limit of the wrong shape is refused by CAT
    // with a code a screen can say, rather than failed here as a bad request.
    shared('catalogue.search', CAT_PERMISSIONS.item.view, (by, args) =>
      catRead.search(by, args[0] as string, args[1] as number | undefined),
    );
    write('catalogue.createCategory', (by, args) =>
      catAdmin.createCategory(
        by,
        object(args[0]) as unknown as Parameters<typeof catAdmin.createCategory>[1],
      ),
    );
    write('catalogue.reviseCategory', (by, args) =>
      catAdmin.reviseCategory(
        by,
        string(args[0]) as Parameters<typeof catAdmin.reviseCategory>[1],
        object(args[1]),
      ),
    );
    write('catalogue.moveCategory', (by, args) =>
      catAdmin.moveCategory(
        by,
        string(args[0]) as Parameters<typeof catAdmin.moveCategory>[1],
        args[1] as Parameters<typeof catAdmin.moveCategory>[2],
      ),
    );
    write('catalogue.createItem', (by, args) =>
      catAdmin.createItem(
        by,
        object(args[0]) as unknown as Parameters<typeof catAdmin.createItem>[1],
      ),
    );
    securedWrite('catalogue.addUnit', CAT_PERMISSIONS.item.edit, (by, args) =>
      catAdmin.addUnit(
        by,
        string(args[0]) as Parameters<typeof catAdmin.addUnit>[1],
        object(args[1]) as unknown as Parameters<typeof catAdmin.addUnit>[2],
      ),
    );
    securedWrite('catalogue.changeItemStatus', CAT_PERMISSIONS.item.edit, (by, args) =>
      catAdmin.changeItemStatus(
        by,
        args[0] as Parameters<typeof catAdmin.changeItemStatus>[1],
        args[1] as Parameters<typeof catAdmin.changeItemStatus>[2],
        args[2] as Parameters<typeof catAdmin.changeItemStatus>[3],
      ),
    );
    securedWrite('catalogue.addBarcode', CAT_PERMISSIONS.item.edit, (by, args) =>
      catAdmin.addBarcode(
        by,
        string(args[0]) as Parameters<typeof catAdmin.addBarcode>[1],
        object(args[1]) as unknown as Parameters<typeof catAdmin.addBarcode>[2],
      ),
    );
    securedWrite('catalogue.deactivateBarcode', CAT_PERMISSIONS.item.edit, (by, args) =>
      catAdmin.deactivateBarcode(by, string(args[0]), string(args[1])),
    );
    securedWrite('catalogue.reactivateBarcode', CAT_PERMISSIONS.item.edit, (by, args) =>
      catAdmin.reactivateBarcode(by, string(args[0]), string(args[1])),
    );

    read('priceLists.list', PRC_PERMISSIONS.list.view, (by) => priceLists.list(by));
    read('priceLists.get', PRC_PERMISSIONS.list.view, (by, args) =>
      priceLists.get(by, args[0] as Parameters<typeof priceLists.get>[1]),
    );
    read('priceLists.subject', PRC_PERMISSIONS.list.view, (by, args) =>
      priceLists.subject(by, args[0] as Parameters<typeof priceLists.subject>[1]),
    );
    securedWrite('priceLists.create', PRC_PERMISSIONS.list.create, (by, args) =>
      priceAdmin.create(by, args[0] as string),
    );
    securedWrite('priceLists.rename', PRC_PERMISSIONS.list.edit, (by, args) =>
      priceAdmin.rename(by, args[0] as Parameters<typeof priceAdmin.rename>[1], args[1] as string),
    );
    securedWrite('priceLists.deactivate', PRC_PERMISSIONS.list.edit, (by, args) =>
      priceAdmin.deactivate(by, args[0] as Parameters<typeof priceAdmin.deactivate>[1]),
    );
    read('usdPrices.get', PRC_PERMISSIONS.price.view, (by, args) =>
      usdPrices.get(by, args[0] as Parameters<typeof usdPrices.get>[1]),
    );
    read('usdPrices.forItem', PRC_PERMISSIONS.price.view, (by, args) =>
      usdPrices.forItem(by, args[0] as Parameters<typeof usdPrices.forItem>[1]),
    );
    read('usdPrices.history', PRC_PERMISSIONS.price.history, (by, args) =>
      usdPrices.history(by, args[0] as Parameters<typeof usdPrices.history>[1]),
    );
    securedWrite('usdPrices.set', PRC_PERMISSIONS.price.edit, (by, args) =>
      usdPrices.set(by, args[0] as Parameters<typeof usdPrices.set>[1]),
    );

    read('companies.list', SYS_PERMISSIONS.company.view, (by, args) =>
      organisation.companies(by, args[0] as Parameters<typeof organisation.companies>[1]),
    );
    write('companies.register', (by, args) =>
      admin.companies.register(
        by,
        object(args[0]) as unknown as Parameters<typeof admin.companies.register>[1],
      ),
    );
    write('companies.rename', (by, args) =>
      admin.companies.rename(
        by,
        string(args[0]) as Parameters<typeof admin.companies.rename>[1],
        string(args[1]),
      ),
    );
    write('companies.deactivate', (by, args) =>
      admin.companies.deactivate(
        by,
        string(args[0]) as Parameters<typeof admin.companies.deactivate>[1],
      ),
    );
    write('companies.reactivate', (by, args) =>
      admin.companies.reactivate(
        by,
        string(args[0]) as Parameters<typeof admin.companies.reactivate>[1],
      ),
    );

    // A tenant-wide branch list is narrowed to the branches this actor may see.
    routes.set('branches.list', {
      read: true,
      dispatch: async (by, args) => {
        const branches = await organisation.branches(
          by,
          args[0] as Parameters<typeof organisation.branches>[1],
        );
        if (await tenantWide(by, SYS_PERMISSIONS.branch.view)) return branches;
        const visible = await Promise.all(
          branches.map(async (branch) => ({
            branch,
            allowed: await authority.may(by, SYS_PERMISSIONS.branch.view, { branch: branch.id }),
          })),
        );
        return visible.filter((one) => one.allowed).map((one) => one.branch);
      },
    });
    write('branches.open', (by, args) =>
      admin.branches.open(
        by,
        object(args[0]) as unknown as Parameters<typeof admin.branches.open>[1],
      ),
    );
    write('branches.rename', (by, args) =>
      admin.branches.rename(
        by,
        string(args[0]) as Parameters<typeof admin.branches.rename>[1],
        string(args[1]),
      ),
    );
    write('branches.readdress', (by, args) =>
      admin.branches.readdress(
        by,
        string(args[0]) as Parameters<typeof admin.branches.readdress>[1],
        string(args[1]),
      ),
    );
    write('branches.locate', (by, args) =>
      admin.branches.locate(
        by,
        string(args[0]) as Parameters<typeof admin.branches.locate>[1],
        args[1] as Parameters<typeof admin.branches.locate>[2],
      ),
    );
    write('branches.deactivate', (by, args) =>
      admin.branches.deactivate(
        by,
        string(args[0]) as Parameters<typeof admin.branches.deactivate>[1],
      ),
    );
    write('branches.reactivate', (by, args) =>
      admin.branches.reactivate(
        by,
        string(args[0]) as Parameters<typeof admin.branches.reactivate>[1],
      ),
    );

    routes.set('locations.list', {
      read: true,
      dispatch: async (by, args) => {
        const branch = string(args[0]);
        const locations = await organisation.locations(
          by,
          branch as Parameters<typeof organisation.locations>[1],
          args[1] as Parameters<typeof organisation.locations>[2],
        );
        const visible = await Promise.all(
          locations.map(async (location) => ({
            location,
            allowed: await authority.may(by, SYS_PERMISSIONS.location.view, {
              branch: location.branch,
              location: location.id,
            }),
          })),
        );
        return visible.filter((one) => one.allowed).map((one) => one.location);
      },
    });
    write('locations.open', (by, args) =>
      admin.locations.open(
        by,
        object(args[0]) as unknown as Parameters<typeof admin.locations.open>[1],
      ),
    );
    write('locations.rename', (by, args) =>
      admin.locations.rename(
        by,
        string(args[0]) as Parameters<typeof admin.locations.rename>[1],
        string(args[1]),
      ),
    );
    write('locations.readdress', (by, args) =>
      admin.locations.readdress(
        by,
        string(args[0]) as Parameters<typeof admin.locations.readdress>[1],
        string(args[1]),
      ),
    );
    write('locations.locate', (by, args) =>
      admin.locations.locate(
        by,
        string(args[0]) as Parameters<typeof admin.locations.locate>[1],
        args[1] as Parameters<typeof admin.locations.locate>[2],
      ),
    );
    write('locations.deactivate', (by, args) =>
      admin.locations.deactivate(
        by,
        string(args[0]) as Parameters<typeof admin.locations.deactivate>[1],
      ),
    );
    write('locations.reactivate', (by, args) =>
      admin.locations.reactivate(
        by,
        string(args[0]) as Parameters<typeof admin.locations.reactivate>[1],
      ),
    );

    read(
      'registers.list',
      SYS_PERMISSIONS.register.view,
      (by, args) =>
        organisation.registers(
          by,
          string(args[0]) as Parameters<typeof organisation.registers>[1],
          args[1] as Parameters<typeof organisation.registers>[2],
        ),
      (args) => ({ branch: string(args[0]) }),
    );
    write('registers.open', (by, args) =>
      admin.registers.open(
        by,
        object(args[0]) as unknown as Parameters<typeof admin.registers.open>[1],
      ),
    );
    write('registers.rename', (by, args) =>
      admin.registers.rename(
        by,
        string(args[0]) as Parameters<typeof admin.registers.rename>[1],
        string(args[1]),
      ),
    );
    write('registers.assignDevice', (by, args) =>
      admin.registers.assignDevice(
        by,
        string(args[0]) as Parameters<typeof admin.registers.assignDevice>[1],
        string(args[1]) as Parameters<typeof admin.registers.assignDevice>[2],
      ),
    );
    write('registers.deactivate', (by, args) =>
      admin.registers.deactivate(
        by,
        string(args[0]) as Parameters<typeof admin.registers.deactivate>[1],
      ),
    );
    write('registers.reactivate', (by, args) =>
      admin.registers.reactivate(
        by,
        string(args[0]) as Parameters<typeof admin.registers.reactivate>[1],
      ),
    );

    read(
      'numbering.configured',
      SYS_PERMISSIONS.numberingSeries.view,
      (by, args) =>
        numbering.configured(by, string(args[0]) as Parameters<typeof numbering.configured>[1]),
      (args) => ({ branch: string(args[0]) }),
    );
    read(
      'numbering.preview',
      SYS_PERMISSIONS.numberingSeries.view,
      (by, args) =>
        numbering.preview(
          by,
          object(args[0]) as unknown as Parameters<typeof numbering.preview>[1],
          args[1] as Parameters<typeof numbering.preview>[2],
        ),
      (args) => ({ branch: string(object(args[0])['branch']) }),
    );
    write('numbering.define', (by, args) =>
      admin.numbering.define(
        by,
        object(args[0]) as unknown as Parameters<typeof admin.numbering.define>[1],
        string(args[1]),
      ),
    );
    read('profile.read', SYS_PERMISSIONS.businessProfile.view, (by, args) =>
      organisation.profile(by, string(args[0]) as Parameters<typeof organisation.profile>[1]),
    );
    write('profile.revise', (by, args) =>
      admin.profile.revise(
        by,
        string(args[0]) as Parameters<typeof admin.profile.revise>[1],
        object(args[1]),
      ),
    );

    read('users.list', SEC_PERMISSIONS.user.view, (by, args) =>
      users.users(by, args[0] as Parameters<typeof users.users>[1]),
    );
    read('users.roles.list', SEC_PERMISSIONS.role.view, (by, args) =>
      roles.roles(by, args[0] as Parameters<typeof roles.roles>[1]),
    );
    read('users.roles.rights', SEC_PERMISSIONS.role.view, () =>
      Promise.resolve(
        registry.permissions.map((one) => ({ id: one.id, sensitive: one.sensitive ?? false })),
      ),
    );
    read('users.assignments.of', SEC_PERMISSIONS.assignment.view, (by, args) =>
      roles.assignmentsOf(by, string(args[0]) as Parameters<typeof roles.assignmentsOf>[1]),
    );
    read('users.assignments.holdersOf', SEC_PERMISSIONS.assignment.view, (by, args) =>
      roles.holdersOf(by, string(args[0]) as Parameters<typeof roles.holdersOf>[1]),
    );
    write('users.enrol', (by, args) =>
      userAdmin.enrol(by, object(args[0]) as unknown as Parameters<typeof userAdmin.enrol>[1]),
    );
    write('users.rename', (by, args) =>
      userAdmin.rename(
        by,
        string(args[0]) as Parameters<typeof userAdmin.rename>[1],
        string(args[1]),
      ),
    );
    write('users.deactivate', (by, args) =>
      userAdmin.deactivate(by, string(args[0]) as Parameters<typeof userAdmin.deactivate>[1]),
    );
    write('users.reactivate', (by, args) =>
      userAdmin.reactivate(by, string(args[0]) as Parameters<typeof userAdmin.reactivate>[1]),
    );
    write('users.resetPassword', (by, args) =>
      userAdmin.resetPassword(
        by,
        string(args[0]) as Parameters<typeof userAdmin.resetPassword>[1],
        string(args[1]),
      ),
    );
    write('users.forceSignOut', (by, args) =>
      userAdmin.forceSignOut(by, string(args[0]) as Parameters<typeof userAdmin.forceSignOut>[1]),
    );
    write('users.roles.define', (by, args) =>
      roleAdmin.roles.define(
        by,
        object(args[0]) as unknown as Parameters<typeof roleAdmin.roles.define>[1],
      ),
    );
    write('users.roles.rename', (by, args) =>
      roleAdmin.roles.rename(
        by,
        string(args[0]) as Parameters<typeof roleAdmin.roles.rename>[1],
        string(args[1]),
      ),
    );
    write('users.roles.grant', (by, args) =>
      roleAdmin.roles.grant(
        by,
        string(args[0]) as Parameters<typeof roleAdmin.roles.grant>[1],
        args[1] as Parameters<typeof roleAdmin.roles.grant>[2],
      ),
    );
    write('users.roles.revoke', (by, args) =>
      roleAdmin.roles.revoke(
        by,
        string(args[0]) as Parameters<typeof roleAdmin.roles.revoke>[1],
        args[1] as Parameters<typeof roleAdmin.roles.revoke>[2],
      ),
    );
    write('users.roles.withdraw', (by, args) =>
      roleAdmin.roles.withdraw(
        by,
        string(args[0]) as Parameters<typeof roleAdmin.roles.withdraw>[1],
      ),
    );
    write('users.roles.restore', (by, args) =>
      roleAdmin.roles.restore(by, string(args[0]) as Parameters<typeof roleAdmin.roles.restore>[1]),
    );
    write('users.assignments.assign', (by, args) =>
      roleAdmin.assignments.assign(
        by,
        object(args[0]) as unknown as Parameters<typeof roleAdmin.assignments.assign>[1],
      ),
    );
    write('users.assignments.withdraw', (by, args) =>
      roleAdmin.assignments.withdraw(
        by,
        string(args[0]) as Parameters<typeof roleAdmin.assignments.withdraw>[1],
        string(args[1]) as Parameters<typeof roleAdmin.assignments.withdraw>[2],
      ),
    );
    write('changeOwnPassword', (by, args) =>
      credentials.changeOwnPassword(by, string(args[0]), string(args[1])),
    );

    // Each published operation is named here. Reflect only binds known contract
    // methods; an HTTP path never chooses a module or an arbitrary property.
    const expose = (
      path: string,
      contract: object,
      method: string,
      right?: string,
      where?: (args: readonly unknown[]) => { branch?: string },
    ): void => {
      const member: unknown = Reflect.get(contract, method);
      if (typeof member !== 'function')
        throw new Error(`Missing store-node contract method ${path}.`);
      const invoke: Dispatch = (by, args) =>
        Promise.resolve(Reflect.apply(member, contract, [by, ...args]) as unknown);
      if (right) read(path, right, invoke, where);
      else write(path, invoke);
    };
    expose('currencies.list', currencyRead, 'currencies', FX_PERMISSIONS.currency.view);
    expose(
      'currencies.functional',
      currencyRead,
      'functional',
      FX_PERMISSIONS.functionalCurrency.view,
    );
    for (const method of ['define', 'revise', 'disable', 'enable', 'makeFunctional'] as const)
      expose(`currencies.${method}`, currencyAdmin, method);
    expose('rates.board', rateRead, 'board', FX_PERMISSIONS.rate.view, (args) => ({
      branch: string(args[0]),
    }));
    for (const method of ['record', 'suggest', 'adopt'] as const)
      expose(`rates.${method}`, rateAdmin, method);

    expose('chart.tree', chartRead, 'tree', FIN_PERMISSIONS.account.view);
    for (const method of ['add', 'rename', 'move', 'withdraw', 'restore'] as const)
      expose(`chart.${method}`, chartAdmin, method);
    expose('calendar.years', calendarRead, 'years', FIN_PERMISSIONS.fiscalYear.view);
    expose('calendar.reopenings', calendarRead, 'reopenings', FIN_PERMISSIONS.fiscalYear.view);
    for (const method of ['append', 'redefine', 'close', 'reopen'] as const)
      expose(`calendar.${method}`, calendarAdmin, method);

    for (const method of ['entries', 'entry', 'reversalOf', 'attachment'] as const)
      expose(`journal.${method}`, journalRead, method, FIN_PERMISSIONS.journalEntry.view);
    for (const method of ['record', 'open', 'reverse'] as const)
      expose(`journal.${method}`, journalAdmin, method);
    expose(
      'postingExceptions.exceptions',
      exceptionsRead,
      'exceptions',
      FIN_PERMISSIONS.postingException.view,
    );
    expose('postingExceptions.post', exceptionsAdmin, 'post');
    for (const method of [
      'trialBalance',
      'incomeStatement',
      'balanceSheet',
      'generalLedger',
    ] as const)
      expose(`statements.${method}`, statementsRead, method, FIN_PERMISSIONS.statement.view);

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
      try {
        const path = new URL(request.url ?? '/', 'http://store-node').pathname;
        if (path === '/v1/sign-in' && request.method === 'POST') {
          const input = await bodyOf(request);
          const tenant = string(input['tenant']) as TenantId;
          const result = await credentials.authenticate(
            systemContext(tenant),
            string(input['handle']),
            string(input['password']),
          );
          if (!isOk(result)) {
            send(response, 401, result);
            return;
          }
          // A tenant created before PRC was enabled receives the same seed on
          // first sign-in; the idempotent command also covers every restart.
          orThrow(
            await priceAdmin.seed(systemContext(tenant)),
            (refusal) => new Error(`Price-list seed refused: ${refusal.code}`),
          );
          const token = randomBytes(32).toString('base64url');
          sessions.set(token, { authenticated: result.value });
          send(response, 200, { token, authenticated: result.value });
          return;
        }
        const bearer = request.headers.authorization;
        const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : '';
        const session = sessions.get(token);
        if (!session) {
          send(response, 401, { error: 'unauthenticated' });
          return;
        }
        const { authenticated } = session;
        const by = commandContext({ tenant: authenticated.tenant, actor: authenticated.user });
        const person = await users.user(by, authenticated.user);
        if (
          !person?.active ||
          (person.sessionsVoidBefore !== null && person.sessionsVoidBefore >= authenticated.at)
        ) {
          sessions.delete(token);
          send(response, 401, { error: 'unauthenticated' });
          return;
        }
        // What a register asks when it has nothing to deliver: is the store
        // node there, and does it still know this session (SYN-06)?
        if (path === SESSION_PATH && request.method === 'GET') {
          send(response, 200, { ok: true });
          return;
        }
        if (path === '/v1/sign-out' && request.method === 'POST') {
          sessions.delete(token);
          send(response, 200, { ok: true });
          return;
        }
        const parts = path.split('/');
        if (parts.length !== 5 || parts[1] !== 'v1' || parts[2] !== 'tenants') {
          send(response, 404, { error: 'not-found' });
          return;
        }
        if (parts[3] !== authenticated.tenant) {
          send(response, 403, { error: 'forbidden' });
          return;
        }
        if (parts[4] === 'devices.pair' && request.method === 'POST') {
          const input = await bodyOf(request);
          const registerId = input['register'];
          const device = input['device'];
          if (
            typeof registerId !== 'string' ||
            !isId(registerId) ||
            typeof device !== 'string' ||
            !isId(device)
          )
            throw new TypeError('Invalid register or device.');
          const credential = randomBytes(32).toString('base64url');
          const paired = await untilCommitted(() =>
            transactor.run(by, async (uow) => {
              const register = await organisation.register(
                by,
                registerId as Parameters<typeof organisation.register>[1],
              );
              if (
                !register?.active ||
                register.heldBy !== device ||
                !(await authority.may(by, SYS_PERMISSIONS.register.edit, {
                  branch: register.branch,
                }))
              )
                return false;
              uow.session.put(
                deviceCredentialKey(authenticated.tenant, device),
                credentialDigest(credential),
              );
              return true;
            }),
          );
          if (!paired) {
            send(response, 403, { error: 'forbidden' });
            return;
          }
          send(response, 200, { credential });
          return;
        }
        if (parts[4] === DELIVER_ROUTE && request.method === 'POST') {
          const input = await bodyOf(request);
          const envelope = object(input['envelope']) as unknown as OperationEnvelope;
          if (envelope.tenant !== authenticated.tenant || envelope.actor !== authenticated.user) {
            send(response, REFUSAL_STATUS.forbidden, { error: 'forbidden' });
            return;
          }
          const registerId = input['register'];
          if (
            typeof registerId !== 'string' ||
            !isId(registerId) ||
            typeof envelope.device !== 'string' ||
            !isId(envelope.device)
          )
            throw new TypeError('Invalid register or device.');
          const operationBy = commandContext({
            tenant: authenticated.tenant,
            actor: authenticated.user,
            device: envelope.device,
            correlation: envelope.correlation,
          });
          const syn02 = options.enableSyn02Fixture && envelope.kind === 'syn02.fixture-post';
          const stock = options.enableStockFixture && STOCK_OPERATION_KINDS.has(envelope.kind);
          if (!syn02 && !stock) {
            send(response, REFUSAL_STATUS.unsupported, { error: 'unsupported-operation' });
            return;
          }
          const credential = request.headers[DEVICE_CREDENTIAL_HEADER];
          if (typeof credential !== 'string') {
            send(response, REFUSAL_STATUS.forbidden, { error: 'forbidden' });
            return;
          }
          const receipt = await untilCommitted(() =>
            transactor.run<Receipt | { status: 'forbidden' }>(operationBy, async (uow) => {
              const register = await organisation.register(
                operationBy,
                registerId as Parameters<typeof organisation.register>[1],
              );
              if (
                !register?.active ||
                register.heldBy !== envelope.device ||
                !(await authority.may(operationBy, SYS_PERMISSIONS.register.view, {
                  branch: register.branch,
                }))
              )
                return { status: 'forbidden' };
              if (
                !credentialMatches(
                  uow.session.get(deviceCredentialKey(authenticated.tenant, envelope.device)),
                  credential,
                )
              )
                return { status: 'forbidden' };
              if (stock) {
                const operation = stockOperation(envelope);
                // Every line of a sale answers to the same check as a lone
                // movement: a register moves stock only where its own branch is.
                for (const id of operation.locations) {
                  const location = await organisation.location(
                    operationBy,
                    id as Parameters<typeof organisation.location>[1],
                  );
                  if (
                    !location?.active ||
                    location.branch !== register.branch ||
                    !(await authority.may(operationBy, SYS_PERMISSIONS.location.view, {
                      branch: register.branch,
                      location: location.id,
                    }))
                  )
                    return { status: 'forbidden' };
                }
                return receiveOperation(uow, envelope, () => {
                  operation.apply(uow);
                  return Promise.resolve();
                });
              }
              return receiveOperation(uow, envelope, () =>
                applySyn02Fixture(uow, envelope.payload),
              );
            }),
          );
          if (receipt.status === 'forbidden') {
            send(response, REFUSAL_STATUS.forbidden, { error: 'forbidden' });
            return;
          }
          send(
            response,
            receipt.status === 'applied' || receipt.status === 'duplicate' ? 200 : 409,
            receipt,
          );
          return;
        }
        const route = routes.get(parts[4] ?? '');
        if (!route || request.method !== (route.read ? 'GET' : 'POST')) {
          send(response, 404, { error: 'not-found' });
          return;
        }
        const input = route.read
          ? new URL(request.url ?? '/', 'http://store-node').searchParams.get('args')
          : (await bodyOf(request))['args'];
        const args = route.read
          ? (JSON.parse(typeof input === 'string' ? input : '[]') as unknown)
          : input;
        if (!Array.isArray(args)) throw new TypeError('Expected arguments.');
        const value = await route.dispatch(by, args);
        if (typeof value === 'object' && value !== null && 'forbidden' in value) {
          send(response, 403, { error: 'forbidden' });
          return;
        }
        send(response, 200, { value });
      } catch (cause) {
        if (cause instanceof IdentityConflictError) {
          send(response, 409, { status: 'conflict' });
          return;
        }
        // For a delivery, this is the wire's `invalid` refusal: the store node
        // could not read what arrived as an operation it applies. The register
        // records it against the operation and keeps retrying — a body cut off
        // on the way clears on the next attempt, and one that never will is
        // exactly what its escalation is for.
        if (cause instanceof SyntaxError || cause instanceof TypeError) {
          send(response, REFUSAL_STATUS.invalid, { error: 'bad-request' });
          return;
        }
        console.error('Store-node request failed:', cause);
        send(response, 500, { error: 'internal-error' });
      }
    }

    return {
      async provisionTenant(tenant, handle, password) {
        const by = systemContext(tenant);
        const seeded = orThrow(
          await untilCommitted(() => roleAdmin.roles.seed(by)),
          (refusal) => new Error(`Role seed refused: ${refusal.code}`),
        );
        const owner = seeded.find((one) => one.seeded === 'owner');
        if (!owner) throw new Error('Owner role was not seeded.');
        const existing = await users.byHandle(by, handle);
        const person =
          existing ??
          orThrow(
            await untilCommitted(() => userAdmin.enrol(by, { handle, name: handle, password })),
            (refusal) => new Error(`Owner enrollment refused: ${refusal.code}`),
          );
        orThrow(
          await untilCommitted(() =>
            roleAdmin.assignments.assign(by, {
              user: person.id,
              role: owner.id,
              confinement: TENANT_WIDE,
            }),
          ),
          (refusal) => new Error(`Owner assignment refused: ${refusal.code}`),
        );
        orThrow(
          await untilCommitted(() => currencyAdmin.seed(by)),
          (refusal) => new Error(`Currency seed refused: ${refusal.code}`),
        );
        orThrow(
          await untilCommitted(() => chartAdmin.seed(by)),
          (refusal) => new Error(`Chart seed refused: ${refusal.code}`),
        );
        orThrow(
          await untilCommitted(() => calendarAdmin.seed(by)),
          (refusal) => new Error(`Calendar seed refused: ${refusal.code}`),
        );
        orThrow(
          await priceAdmin.seed(by),
          (refusal) => new Error(`Price-list seed refused: ${refusal.code}`),
        );
      },
      async listen(port, host = '127.0.0.1') {
        const server = createServer((request, response) => {
          void handle(request, response);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, resolve);
          });
        } catch (cause) {
          server.close();
          throw cause;
        }
        servers.add(server);
        return {
          address: () => server.address(),
          close: async () => {
            if (!servers.delete(server)) return;
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => {
                if (error) reject(error);
                else resolve();
              }),
            );
          },
        };
      },
      async close() {
        sessions.clear();
        await Promise.all(
          [...servers].map(
            (server) =>
              new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => {
                  resolve();
                });
              }),
          ),
        );
        servers.clear();
        await store.close();
      },
    };
  } catch (cause) {
    await store.close();
    throw cause;
  }
}
