import { appendFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { availableParallelism, cpus, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { catModule, CatalogueAdministration, type Item } from '@vertex/cat';
import type { TenantId } from '@vertex/contracts';
import { Dec, newId, orThrow, systemClock, type Result } from '@vertex/kernel';
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
  type Authoriser,
  type MemorySession,
} from '@vertex/platform';
import { openPostgresStore } from '@vertex/storage';

import { composeStoreNode } from './store-node.js';

/**
 * `PRC-03`'s review at the size the specification names: thirty thousand
 * items, a third of them sold by the carton too, priced in the three standard
 * lists — 120,000 frozen display prices at one branch, every one of them moved
 * past the threshold by one rate, listed, reviewed a page at a time, approved
 * and published over PostgreSQL through the store node's own transport.
 *
 * **Measured, not budgeted.** It prints what each phase took and what the
 * process held, with the machine it ran on, and asserts only what must be true
 * whatever the machine: every price listed once, every included price
 * published once with one audit entry, nothing staged left behind, no read
 * page larger than asked, and no write of a person's refused while the batch
 * ran. A wall-clock limit would fail on a slow runner for reasons that are
 * not this code.
 *
 * Minutes, not seconds, so it runs when asked: `VERTEX_MEASURE_RATE_REVIEW=1`
 * with `VERTEX_TEST_POSTGRES_URL`.
 *
 * The catalogue is made through `CAT`'s own commands in memory and carried to
 * PostgreSQL, as `CAT-15`'s measurement does. The dollar and frozen prices are
 * written in the layout `PRC` keeps them in, directly: 240,000 commands through
 * the transport would measure the seeding, and the prices are then read back
 * through `PRC`'s own contract before anything is measured.
 */

const database = process.env['VERTEX_TEST_POSTGRES_URL'];
const measure = process.env['VERTEX_MEASURE_RATE_REVIEW'] === '1';
const ITEMS = 30_000;
const unwrap = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));

const cleanup: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

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

async function catalogue(tenant: TenantId): Promise<{
  records: ReadonlyMap<string, unknown>;
  items: readonly Item[];
}> {
  const memory = createMemoryStore();
  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw failure.cause;
    },
  });
  const transactor = createTransactor({
    driver: memory.driver,
    bus,
    clock: systemClock,
    onEffectFailure: (failure) => {
      throw failure.cause;
    },
  });
  const registry = createRegistry({
    catalogue: standIns,
    plan: unwrap(composeEdition(standIns, { modules: ['SYS', 'SEC', 'FX', 'CAT'] })),
    bus,
    transactor,
    clock: systemClock,
    authorisedBy: Authority,
  });
  const admin = registry.require(CatalogueAdministration);
  const by = commandContext({ tenant, actor: newId<'user'>() });
  const category = unwrap(
    await admin.createCategory(by, {
      name: 'بقالة',
      parent: null,
      defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
    }),
  );
  const items: Item[] = [];
  for (let n = 0; n < ITEMS; n += 1) {
    const item = unwrap(
      await admin.createItem(by, {
        name: `صنف ${String(n)}`,
        category: category.id,
        code: `SKU-${String(n).padStart(5, '0')}`,
      }),
    );
    if (n % 3 === 0) {
      const carton = unwrap(
        await admin.addUnit(by, item.id, {
          unit: { code: 'carton', kind: 'count', decimals: 0 },
          basePerUnit: '12',
        }),
      );
      items.push({ ...item, units: [...item.units, carton] });
    } else items.push(item);
  }
  return { records: memory.committed(), items };
}

const phase = async <T>(timings: Map<string, number>, name: string, work: () => Promise<T>) => {
  const started = performance.now();
  const result = await work();
  timings.set(name, performance.now() - started);
  const usage = process.memoryUsage();
  const line = `U09.4 measure: ${name} ${((performance.now() - started) / 1000).toFixed(2)} s; rss ${megabytes(usage.rss)}, heap ${megabytes(usage.heapUsed)}`;
  console.info(line);
  if (process.env['VERTEX_MEASURE_LOG'])
    appendFileSync(process.env['VERTEX_MEASURE_LOG'], `${line}\n`);
  return result;
};

const megabytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(0)} MB`;

describe.runIf(measure && database)(
  'PRC-03 PRC-11 a rate review of 30,000 items on PostgreSQL',
  () => {
    it('lists, pages, approves and publishes 120,000 frozen prices, each once', async () => {
      if (!database) throw new Error('A PostgreSQL test URL is required.');
      const timings = new Map<string, number>();
      const tenant = newId<'tenant'>();
      const schema = `vertex_measure_${newId<'schema'>().replaceAll('-', '')}`;
      const attachmentsDirectory = await mkdtemp(join(tmpdir(), 'vertex-u094-'));
      const admin = new Pool({ connectionString: database });
      cleanup.push(async () => {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
        await rm(attachmentsDirectory, { recursive: true, force: true });
      });

      const { records, items } = await phase(timings, 'catalogue (memory)', () =>
        catalogue(tenant),
      );
      const seed = await openPostgresStore({ connectionString: database, schema });
      await phase(timings, 'catalogue to PostgreSQL', async () => {
        const session = await seed.driver.begin(systemContext(tenant));
        for (const [key, value] of records) session.put(key, value);
        await seed.driver.commit(session);
      });

      const chunk = Number(process.env['VERTEX_MEASURE_CHUNK'] ?? '1000');
      const node = await composeStoreNode({
        connectionString: database,
        schema,
        attachmentsDirectory,
        rateReviewInterval: 0,
        rateReviewChunk: chunk,
      });
      cleanup.push(() => node.close());
      await node.provisionTenant(tenant, 'owner', 'till-morning-1');
      const server = await node.listen(0);
      cleanup.push(() => server.close());
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP address.');
      const base = `http://127.0.0.1:${String(address.port)}/v1/tenants/${tenant}`;
      const login = await fetch(`http://127.0.0.1:${String(address.port)}/v1/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, handle: 'owner', password: 'till-morning-1' }),
      });
      const token = ((await login.json()) as { token: string }).token;
      const headers = { authorization: `Bearer ${token}` };
      interface Answer {
        value: { ok: boolean; value: Record<string, unknown>; error?: { code: string } };
      }
      const post = async (method: string, args: unknown[]) => {
        const response = await fetch(`${base}/${method}`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ args }),
        });
        expect(response.status, method).toBe(200);
        const answer = (await response.json()) as Answer;
        expect(answer.value.ok, `${method} ${JSON.stringify(answer)}`).toBe(true);
        return answer.value.value;
      };
      const get = async (method: string, args: unknown[]) => {
        const response = await fetch(
          `${base}/${method}?args=${encodeURIComponent(JSON.stringify(args))}`,
          { headers },
        );
        expect(response.status, method).toBe(200);
        return {
          answer: (await response.json()) as Answer,
          bytes: Number(response.headers.get('content-length') ?? 0),
        };
      };

      const company = await post('companies.register', [{ name: 'Shop' }]);
      const aleppo = (await post('branches.open', [{ company: company['id'], name: 'Aleppo' }]))[
        'id'
      ] as string;
      const damascus = (
        await post('branches.open', [{ company: company['id'], name: 'Damascus' }])
      )['id'] as string;
      const quote = (buy: string) => ({ form: 'units-per-functional', buy, sell: '9000' });
      const first = await post('rates.record', [aleppo, 'SYP', quote('10000')]);
      await post('rates.record', [damascus, 'SYP', quote('10000')]);
      const lists = (await get('priceLists.list', [])).answer.value as unknown as {
        id: string;
      }[];

      // 120,000 dollar prices and the SYP prices frozen from them at 10,000.
      const rate = {
        currency: 'SYP',
        functional: first['functional'],
        side: 'buy',
        rate: '10000',
        revision: first['id'],
        sequence: first['sequence'],
        day: first['day'],
        recordedAt: first['recordedAt'],
      };
      const t = encodeURIComponent(tenant);
      const prices = await openPostgresStore({ connectionString: database, schema });
      const writing = await prices.driver.begin(systemContext(tenant));
      let frozen = 0;
      for (const [n, item] of items.entries())
        for (const unit of item.units)
          for (const list of lists) {
            // n % 50 + 1 dollars and n % 100 cents: frozen at 10,000 pounds
            // to the dollar, that is the same digits and two noughts.
            const whole = String((n % 50) + 1);
            const cents = String(n % 100).padStart(2, '0');
            const usd = new Dec(`${whole}.${cents}`).toFixed();
            const subject = { list: list.id, item: item.id, unit: unit.id };
            const path = `${item.id}/${list.id}/${unit.id}`;
            const amount = `${whole}${cents}00`;
            writing.put(`prc/usd/${t}/price/${path}`, {
              tenant,
              subject,
              amount: usd,
              currency: 'USD',
              revision: 1,
            });
            writing.put(`prc/display/${t}/price/${aleppo}/${path}`, {
              tenant,
              branch: aleppo,
              subject,
              amount,
              currency: 'SYP',
              revision: 1,
              basis: {
                usdAmount: usd,
                usdRevision: 1,
                rate,
                exact: amount,
                residual: '0',
                rounding: { increment: '10', mode: 'half-up' },
              },
              approvedBy: null,
              approvedAt: 1_780_000_000_000,
              reason: 'Seeded',
            });
            frozen += 1;
          }
      await phase(timings, 'seed prices (one transaction)', () => prices.driver.commit(writing));
      await prices.close();
      await seed.close();
      expect(frozen).toBe(120_000);
      const sample = items[4242]!;
      expect(
        (
          await get('displayPrices.get', [
            {
              branch: aleppo,
              subject: { list: lists[0]!.id, item: sample.id, unit: sample.units[0]!.id },
            },
          ])
        ).answer.value,
      ).toMatchObject({ ok: true, value: { status: 'frozen', price: { amount: '434200' } } });

      const memory: string[] = [];
      const sampleMemory = (label: string) => {
        const usage = process.memoryUsage();
        memory.push(`${label}: rss ${megabytes(usage.rss)}, heap ${megabytes(usage.heapUsed)}`);
      };
      sampleMemory('before');

      // Detection and listing.
      const policy = (await get('rateReviews.policy', [])).answer.value.value as {
        revision: number;
      };
      await post('rateReviews.setPolicy', [
        {
          threshold: '5',
          expectedRevision: policy.revision,
          operation: newId<'price-operation'>(),
        },
      ]);
      await node.settleReviews();
      await post('rates.record', [aleppo, 'SYP', quote('11000')]);
      await phase(timings, 'scan and list 120,000 prices', () => node.settleReviews());
      sampleMemory('after listing');
      const tasks = (await get('rateReviews.tasks', [{ branch: aleppo, open: true }])).answer.value
        .value as { tasks: { id: string; review: number; counts: { entries: number } }[] };
      const [task] = tasks.tasks;
      expect(task?.counts.entries).toBe(120_000);
      const ref = { branch: aleppo, task: task!.id };

      // Reading it: a bounded page wherever the reader is.
      const firstPage = await phase(timings, 'first page of 100', () =>
        get('rateReviews.entries', [{ ...ref, limit: 100 }]),
      );
      const listed = firstPage.answer.value.value as {
        entries: { subject: { item: string; list: string; unit: string } }[];
        next: string;
      };
      expect(listed.entries).toHaveLength(100);
      const middle = items[20_000]!;
      const deep = await phase(timings, 'page of 100 two thirds in', () =>
        get('rateReviews.entries', [
          { ...ref, limit: 100, after: `${middle.id}/${lists[0]!.id}/${middle.units[0]!.id}` },
        ]),
      );
      expect((deep.answer.value.value as { entries: unknown[] }).entries).toHaveLength(100);

      // A person excludes a page, and approves the rest.
      const excluded = await post('rateReviews.exclude', [
        {
          ...ref,
          subjects: listed.entries.map((one) => one.subject),
          excluded: true,
          expectedReview: 0,
        },
      ]);
      await phase(timings, 'approval accepted', () =>
        post('rateReviews.approve', [
          {
            ...ref,
            expectedReview: excluded['review'],
            reason: 'Rate moved past 5%',
            operation: newId<'price-operation'>(),
          },
        ]),
      );
      // A cashier's-worth of writes while it publishes: none refused, and the
      // longest any waited is what a step costs the shop. Each write nudges
      // the monitor, so they stop once the batch is published; folding is
      // then timed on its own.
      const started = performance.now();
      let longest = 0;
      let writes = 0;
      for (;;) {
        const before = performance.now();
        await post('rates.record', [damascus, 'SYP', quote(String(10_000 + writes + 1))]);
        longest = Math.max(longest, performance.now() - before);
        writes += 1;
        const now = (await get('rateReviews.task', [ref])).answer.value.value as { state: string };
        if (now.state !== 'approving') break;
      }
      timings.set('stage and publish 119,900 prices', performance.now() - started);
      await phase(timings, 'fold the published batch', () => node.settleReviews());
      sampleMemory('after publishing');

      const settled = (await get('rateReviews.task', [ref])).answer.value.value as {
        state: string;
        batch: { id: string; staged: number; total: number };
      };
      expect(settled).toMatchObject({ state: 'approved', batch: { staged: 119_900 } });
      const batch = settled.batch.id;
      const counted = await admin.query<{ audit: string; staged: string; moved: string }>(
        `SELECT
           count(*) FILTER (WHERE key LIKE $1) AS audit,
           count(*) FILTER (WHERE key LIKE $2) AS staged,
           count(*) FILTER (WHERE key LIKE $3 AND value LIKE $4) AS moved
         FROM "${schema}".vertex_records`,
        [
          `prc/display/${t}/history/%/${batch}`,
          `prc/display/${t}/staged/%`,
          `prc/display/${t}/price/${aleppo}/%`,
          `%"batch":"${batch}"%`,
        ],
      );
      expect(counted.rows[0]).toEqual({ audit: '119900', staged: '0', moved: '119900' });
      const excludedOne = listed.entries[0]!.subject;
      expect(
        (await get('displayPrices.get', [{ branch: aleppo, subject: excludedOne }])).answer.value,
      ).toMatchObject({ value: { price: { revision: 1 } } });

      const figures = [...timings].map(([name, ms]) => `${name} ${(ms / 1000).toFixed(2)} s`);
      const summary = [
        `U09.4 rate review, ${String(ITEMS)} items, ${String(frozen)} frozen prices, chunk ${String(chunk)}:`,
        ...figures,
        `first page ${String(firstPage.bytes)} bytes`,
        `${String(writes)} rate writes during publication, none refused, longest ${longest.toFixed(0)} ms`,
        ...memory,
        `${platform()} ${cpus()[0]?.model ?? ''} ×${String(availableParallelism())}, node ${process.version}`,
      ].join('\n  ');
      console.info(summary);
      if (process.env['VERTEX_MEASURE_LOG'])
        appendFileSync(process.env['VERTEX_MEASURE_LOG'], `${summary}\n`);
    }, 3_600_000);
  },
);
