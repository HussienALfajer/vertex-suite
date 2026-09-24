import { mkdtemp, rm } from 'node:fs/promises';
import { availableParallelism, cpus, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  catModule,
  Catalogue,
  CatalogueAdministration,
  type CategoryId,
  type ItemSearch,
} from '@vertex/cat';
import type { TenantId } from '@vertex/contracts';
import { newId, orThrow, systemClock, type Result } from '@vertex/kernel';
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
  runMigrations,
  systemContext,
  type Authoriser,
  type MemorySession,
  type SessionDriver,
} from '@vertex/platform';
import { openPostgresStore, openSqliteStore, type PersistentStore } from '@vertex/storage';

import { composeStoreNode } from './store-node.js';

/**
 * `CAT-15`'s number, measured where a cashier would feel it.
 *
 * Thirty thousand items — the size `CAT` is specified for, half of them with
 * no manufacturer's barcode — created through `CAT`'s own commands, so that
 * what is measured is what those commands write, then carried into a durable
 * store and read back through a restart. Timed from the request to the answer:
 * over authenticated HTTP on the store node, and through the contract on the
 * register's SQLite, which has no HTTP in front of it. Each backend is timed
 * warm and as the first search after a restart, once the node has started —
 * which, like the real one, runs its migrations and so has read the store.
 *
 * Budgeted on the median of repeated runs of each term, and on the single
 * first search after a restart. A median, because a shared CI runner pauses
 * for reasons that have nothing to do with this code, and one pause is not a
 * slow search; the first search is one sample because there is only one.
 * Every figure is printed with the machine it was measured on.
 */

const pgUrl = process.env['VERTEX_TEST_POSTGRES_URL'];
if (process.env['CI'] && !pgUrl)
  throw new Error('CI must provide VERTEX_TEST_POSTGRES_URL for the CAT-15 measurement.');

const SKUS = 30_000;
const BUDGET_MS = 150;
const RUNS = 7;
const unwrap = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));

// CAT-01's ten departments, three shelves each.
const DEPARTMENTS = [
  ['بقالة', ['أرز وحبوب', 'زيوت', 'معلبات']],
  ['أغذية طازجة', ['ألبان', 'خضار', 'لحوم']],
  ['منظفات', ['غسيل', 'أواني', 'أرضيات']],
  ['أدوات منزلية', ['مطبخ', 'تخزين', 'إنارة']],
  ['عناية شخصية', ['شعر', 'أسنان', 'بشرة']],
  ['ملابس', ['رجالي', 'نسائي', 'أطفال']],
  ['إلكترونيات', ['هواتف', 'بطاريات', 'كابلات']],
  ['عطور', ['رجالية', 'نسائية', 'بخور']],
  ['قرطاسية', ['دفاتر', 'أقلام', 'مكتب']],
  ['ألعاب', ['تعليمية', 'دمى', 'خارجية']],
] as const;
// Written as labels are: some with every vowel, some with none, the hamza
// and the taa marbuta as they come.
const NOUNS = [
  'حَلِيب',
  'أرز',
  'إسفنجة',
  'آنية',
  'زيت زيتون',
  'جبنة',
  'زبدة',
  'شاي',
  'قهوة',
  'سكر',
  'معكرونة',
  'صابون',
  'شامبو',
  'معجون أسنان',
  'عطر',
  'دفتر',
  'قلم',
  'لعبة',
  'بطارية',
  'مصباح',
  'مِنْشَفَة',
  'كوب',
  'مسحوق غسيل',
  'بسكويت',
  'تمر',
  'عصير',
  'ماء',
  'حلوى',
  'مؤشر',
  'كابل شاحن',
] as const;
const BRANDS = ['الأصيل', 'المراعي', 'النخبة', 'إيفا', 'الوادي', 'السنبلة', 'نور', 'الريم'];
const SIZES = ['250 غرام', '500 غرام', '1 كغ', '1 لتر', '6 قطع', '12 قطعة', 'حجم عائلي'];

/** An EAN-13 with a valid check digit, so the index keys it as the GTIN it is. */
function ean(n: number): string {
  const body = `621${String(n).padStart(9, '0')}`;
  let sum = 0;
  for (let at = 0; at < 12; at += 1) sum += Number(body[at]) * (at % 2 === 0 ? 1 : 3);
  return `${body}${String((10 - (sum % 10)) % 10)}`;
}

const Authority = contractKey<Authoriser>('sec.authorisation');
const standIns = [
  defineModule<MemorySession>({ code: 'SYS', labelKey: 'module.sys' }),
  defineModule<MemorySession>({
    code: 'SEC',
    labelKey: 'module.sec',
    provides: [provideContract(Authority, () => ({ may: () => Promise.resolve(true) }))],
  }),
  defineModule<MemorySession>({ code: 'FX', labelKey: 'module.fx' }),
  catModule<MemorySession>(),
];
const plan = unwrap(composeEdition(standIns, { modules: ['SYS', 'SEC', 'FX', 'CAT'] }));

function compose(driver: SessionDriver<MemorySession>) {
  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw failure.cause;
    },
  });
  const transactor = createTransactor({
    driver,
    bus,
    clock: systemClock,
    onEffectFailure: (failure) => {
      throw failure.cause;
    },
  });
  const registry = createRegistry({
    catalogue: standIns,
    plan,
    bus,
    transactor,
    clock: systemClock,
    authorisedBy: Authority,
  });
  return { registry, transactor };
}

interface Shop {
  readonly tenant: TenantId;
  /** Every record the catalogue wrote, as committed. */
  readonly records: ReadonlyMap<string, unknown>;
  /** What each measured term must find, counted while the shop was built. */
  readonly expected: ReadonlyMap<string, number>;
}

/** Terms a cashier types, with what each exercises. */
const TERMS = [
  'حليب', // a diacritised name, typed bare
  'اسفنجه', // an alef form and a taa marbuta, both typed the other way
  'زيت زيتون', // two words
  'SKU-01234', // an item code, exactly — and ranked first
  ean(4242), // a barcode, exactly
  '4242', // part of a code and of a barcode
  'منظفات', // a department, through every shelf under it
  'قلم النخبة', // a name word and a brand
  'غيرموجود', // nothing at all
  '', // the list before anybody types: every item, sorted
] as const;

async function buildShop(): Promise<Shop> {
  const memory = createMemoryStore();
  const { registry } = compose(memory.driver);
  const admin = registry.require(CatalogueAdministration);
  const tenant = newId<'tenant'>();
  const by = commandContext({ tenant, actor: newId<'user'>() });
  const shelves: { id: CategoryId; department: string }[] = [];
  for (const [department, children] of DEPARTMENTS) {
    const parent = unwrap(
      await admin.createCategory(by, {
        name: department,
        parent: null,
        defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
      }),
    );
    for (const name of children)
      shelves.push({
        id: unwrap(await admin.createCategory(by, { name, parent: parent.id })).id,
        department,
      });
  }
  const expected = new Map<string, number>(TERMS.map((term) => [term, 0]));
  const count = (term: string, hit: boolean) => {
    if (hit) expected.set(term, (expected.get(term) ?? 0) + 1);
  };
  for (let n = 0; n < SKUS; n += 1) {
    const noun = NOUNS[n % NOUNS.length] ?? '';
    const brand = BRANDS[Math.floor(n / NOUNS.length) % BRANDS.length] ?? '';
    const size = SIZES[n % SIZES.length] ?? '';
    const shelf = shelves[n % shelves.length];
    if (shelf === undefined) throw new Error('No shelf.');
    const code = `SKU-${String(n).padStart(5, '0')}`;
    const item = unwrap(
      await admin.createItem(by, { name: `${noun} ${brand} ${size}`, category: shelf.id, code }),
    );
    // Half the catalogue carries a manufacturer's code, as CAT specifies.
    const barcode = n % 2 === 0 ? ean(n) : null;
    if (barcode !== null) unwrap(await admin.addBarcode(by, item.id, { code: barcode }));
    count('حليب', noun === 'حَلِيب');
    count('اسفنجه', noun === 'إسفنجة');
    count('زيت زيتون', noun === 'زيت زيتون');
    // Every word must be found: `sku` is in every code, `01234` in one code and
    // in any barcode that happens to contain it — the exact code ranks first.
    count('SKU-01234', code.includes('01234') || (barcode?.includes('01234') ?? false));
    count(ean(4242), barcode === ean(4242));
    count('4242', code.includes('4242') || (barcode?.includes('4242') ?? false));
    count('منظفات', shelf.department === 'منظفات');
    count('قلم النخبة', noun === 'قلم' && brand === 'النخبة');
    count('', true);
  }
  return { tenant, records: memory.committed(), expected };
}

async function persist(store: PersistentStore, shop: Shop): Promise<void> {
  const session = await store.driver.begin(systemContext(shop.tenant));
  for (const [key, value] of shop.records) session.put(key, value);
  await store.driver.commit(session);
}

interface Timed {
  readonly first: number;
  readonly medians: ReadonlyMap<string, number>;
}

async function measure(
  search: (term: string) => Promise<ItemSearch>,
  expected: ReadonlyMap<string, number>,
): Promise<Timed> {
  const clock = () => performance.now();
  const started = clock();
  const opening = await search(TERMS[0]);
  const first = clock() - started;
  expect(opening.total).toBe(expected.get(TERMS[0]));
  expect((await search('SKU-01234')).items[0]?.code).toBe('SKU-01234');
  expect((await search(ean(4242))).items[0]?.barcodes[0]?.code).toBe(ean(4242));
  const medians = new Map<string, number>();
  for (const term of TERMS) {
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const at = clock();
      const found = await search(term);
      samples.push(clock() - at);
      expect(found.total, term).toBe(expected.get(term));
      expect(found.items.length, term).toBe(Math.min(found.total, 50));
    }
    samples.sort((a, b) => a - b);
    medians.set(term, samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY);
  }
  return { first, medians };
}

function report(backend: string, phase: string, timed: Timed): void {
  const figures = [...timed.medians]
    .map(([term, ms]) => `${term === '' ? '(empty)' : term}=${ms.toFixed(1)}`)
    .join(' ');
  console.info(
    `CAT-15 ${backend} ${phase}: ${String(SKUS)} SKUs, first ${timed.first.toFixed(1)} ms; ` +
      `medians of ${String(RUNS)} (ms): ${figures} — ${platform()} ${cpus()[0]?.model ?? ''} ×${String(availableParallelism())}, node ${process.version}`,
  );
}

function withinBudget(timed: Timed): void {
  expect(timed.first).toBeLessThan(BUDGET_MS);
  for (const [term, ms] of timed.medians) expect(ms, term).toBeLessThan(BUDGET_MS);
}

describe('CAT-15 Arabic search at 30,000 SKUs', () => {
  let shop: Shop;
  const cleanup: (() => Promise<void>)[] = [];
  beforeAll(async () => {
    shop = await buildShop();
  }, 300_000);
  afterAll(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  it('answers on the register’s SQLite within 150 ms, warm and after a restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vertex-cat-15-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'register.sqlite');
    const by = systemContext(shop.tenant);
    let store = await openSqliteStore(path);
    await persist(store, shop);
    await store.close();

    // A register starts as the store node does: it runs its migrations, which
    // index what an earlier version stored — here, all thirty thousand items.
    const start = async () => {
      store = await openSqliteStore(path);
      const { registry, transactor } = compose(store.driver);
      await runMigrations({
        plan: registry.migrationPlan('terminal'),
        transactor,
        context: by,
        journal: store.journal,
      });
      const read = registry.require(Catalogue);
      return (term: string) => read.search(by, term).then(unwrap);
    };
    try {
      const warm = await measure(await start(), shop.expected);
      report('sqlite', 'warm', warm);
      withinBudget(warm);
      await store.close();
      const restarted = await measure(await start(), shop.expected);
      report('sqlite', 'after restart', restarted);
      withinBudget(restarted);
    } finally {
      await store.close();
    }
  }, 300_000);

  it.skipIf(!pgUrl)(
    'answers over the store node’s HTTP within 150 ms, warm and after a restart',
    async () => {
      const schema = `vertex_cat15_${newId<'schema'>().replaceAll('-', '')}`;
      const attachmentsDirectory = await mkdtemp(join(tmpdir(), 'vertex-cat-15-attachments-'));
      cleanup.push(async () => {
        const admin = new Pool({ connectionString: pgUrl });
        try {
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await admin.end();
          await rm(attachmentsDirectory, { recursive: true, force: true });
        }
      });
      const seeded = await openPostgresStore({ connectionString: pgUrl!, schema });
      try {
        await persist(seeded, shop);
      } finally {
        await seeded.close();
      }

      // The shop's owner is provisioned once, as in a real store; a restart
      // signs in against what the first start stored.
      const start = async (provision: boolean) => {
        const node = await composeStoreNode({
          connectionString: pgUrl!,
          schema,
          attachmentsDirectory,
        });
        if (provision) await node.provisionTenant(shop.tenant, 'owner', 'till-morning-1');
        const server = await node.listen(0);
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
        const base = `http://127.0.0.1:${String(address.port)}`;
        const signedIn = await fetch(`${base}/v1/sign-in`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenant: shop.tenant,
            handle: 'owner',
            password: 'till-morning-1',
          }),
        });
        expect(signedIn.status).toBe(200);
        const { token } = (await signedIn.json()) as { token: string };
        const search = async (term: string): Promise<ItemSearch> => {
          const response = await fetch(
            `${base}/v1/tenants/${shop.tenant}/catalogue.search?args=${encodeURIComponent(JSON.stringify([term]))}`,
            { headers: { authorization: `Bearer ${token}` } },
          );
          expect(response.status, term).toBe(200);
          const body = (await response.json()) as { value: Result<ItemSearch, unknown> };
          return unwrap(body.value);
        };
        const stop = async () => {
          await server.close();
          await node.close();
        };
        return { search, stop };
      };
      const first = await start(true);
      try {
        const warm = await measure(first.search, shop.expected);
        report('postgres http', 'warm', warm);
        withinBudget(warm);
      } finally {
        await first.stop();
      }
      const second = await start(false);
      try {
        const restarted = await measure(second.search, shop.expected);
        report('postgres http', 'after restart', restarted);
        withinBudget(restarted);
      } finally {
        await second.stop();
      }
    },
    300_000,
  );
});
