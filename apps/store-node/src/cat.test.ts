import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { catModule, Catalogue, CatalogueAdministration } from '@vertex/cat';
import { newId, orThrow, systemClock, type Result } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  contractKey,
  createEventBus,
  createRegistry,
  createTransactor,
  defineModule,
  provideContract,
  type Authoriser,
  type MemorySession,
} from '@vertex/platform';
import { openPostgresStore, openSqliteStore, type PersistentStore } from '@vertex/storage';

const pgUrl = process.env['VERTEX_TEST_POSTGRES_URL'];
const unwrap = <T, E>(result: Result<T, E>): T =>
  orThrow(result, (error) => new Error(JSON.stringify(error)));
if (process.env['CI'] && !pgUrl)
  throw new Error('CI must provide VERTEX_TEST_POSTGRES_URL for CAT-01 PostgreSQL persistence.');

for (const backend of ['sqlite', 'postgres'] as const) {
  describe.skipIf(backend === 'postgres' && !pgUrl)(
    `CAT-01 CAT-02 CAT-12 ${backend} restart persistence`,
    () => {
      it('reads the category tree and its item after reopening the durable store', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'vertex-cat-'));
        const schema = `vertex_cat_${newId<'schema'>().replaceAll('-', '')}`;
        const path = join(directory, 'catalogue.sqlite');
        const openStore = (): Promise<PersistentStore> =>
          backend === 'sqlite'
            ? openSqliteStore(path)
            : openPostgresStore({ connectionString: pgUrl!, schema });
        let store = await openStore();
        const Authority = contractKey<Authoriser>('sec.authorisation');
        const modules = [
          defineModule<MemorySession>({ code: 'SYS', labelKey: 'module.sys' }),
          defineModule<MemorySession>({
            code: 'SEC',
            labelKey: 'module.sec',
            provides: [provideContract(Authority, () => ({ may: () => Promise.resolve(true) }))],
          }),
          defineModule<MemorySession>({ code: 'FX', labelKey: 'module.fx' }),
          catModule<MemorySession>(),
        ];
        const plan = unwrap(composeEdition(modules, { modules: ['SYS', 'SEC', 'FX', 'CAT'] }));
        const by = commandContext({ tenant: newId<'tenant'>(), actor: newId<'user'>() });
        const registry = () => {
          const bus = createEventBus({
            onHandlerFailure: (failure) => {
              throw failure.cause;
            },
          });
          return createRegistry({
            catalogue: modules,
            plan,
            bus,
            transactor: createTransactor({
              driver: store.driver,
              bus,
              clock: systemClock,
              onEffectFailure: (failure) => {
                throw failure.cause;
              },
            }),
            clock: systemClock,
            authorisedBy: Authority,
          });
        };
        try {
          const admin = registry().require(CatalogueAdministration);
          const root = unwrap(
            await admin.createCategory(by, {
              name: 'غذاء',
              parent: null,
              defaultBaseUnit: { code: 'pc', kind: 'count', decimals: 0 },
            }),
          );
          const child = unwrap(await admin.createCategory(by, { name: 'معلبات', parent: root.id }));
          const item = unwrap(await admin.createItem(by, { name: 'فول', category: child.id }));
          const pack = unwrap(
            await admin.addUnit(by, item.id, {
              unit: { code: 'pack', kind: 'count', decimals: 0 },
              basePerUnit: '6',
            }),
          );
          const carton = unwrap(
            await admin.addUnit(by, item.id, {
              unit: { code: 'carton', kind: 'count', decimals: 0 },
              basePerUnit: '24',
            }),
          );
          const variants = [];
          for (const kind of ['weighed', 'batch-tracked', 'variant-bearing'] as const) {
            variants.push(
              unwrap(
                await admin.createItem(by, {
                  name: kind,
                  category: child.id,
                  kind,
                  ...(kind === 'weighed'
                    ? { baseUnit: { code: 'kg', kind: 'weight' as const, decimals: 3 } }
                    : {}),
                }),
              ),
            );
          }
          unwrap(await admin.changeItemStatus(by, item.id, 'suspended', 'Stock check'));
          unwrap(await admin.changeItemStatus(by, item.id, 'active', 'Checked'));
          unwrap(await admin.changeItemStatus(by, item.id, 'discontinued', 'No replenishment'));
          const legacyId = newId<'item'>();
          const legacySession = await store.driver.begin(by);
          legacySession.put(
            `cat/item/${encodeURIComponent(by.tenant)}/${encodeURIComponent(legacyId)}`,
            {
              tenant: by.tenant,
              id: legacyId,
              name: 'Earlier',
              category: child.id,
              kind: 'standard',
              baseUnit: item.baseUnit,
            },
          );
          await store.driver.commit(legacySession);
          await store.close();
          store = await openStore();
          const read = registry().require(Catalogue);
          expect(unwrap(await read.convert(by, item.id, '4', carton.id, pack.id)).amount).toBe(
            '16',
          );
          expect(unwrap(await read.units(by, item.id)).map((one) => one.id)).toEqual([
            item.id,
            pack.id,
            carton.id,
          ]);
          expect(unwrap(await read.units(by, legacyId))).toMatchObject([
            { id: legacyId, basePerUnit: '1', unit: item.baseUnit },
          ]);
          expect((await read.categories(by)).map((one) => one.name)).toEqual(['غذاء', 'معلبات']);
          expect(
            (await read.item(by, item.id))?.statusHistory.map((change) => change.reason),
          ).toEqual(['Stock check', 'Checked', 'No replenishment']);
          expect((await read.item(by, item.id))?.baseUnit).toEqual(item.baseUnit);
          expect((await read.item(by, item.id))?.category).toBe(item.category);
          expect((await read.items(by)).map((one) => one.kind).sort()).toEqual(
            ['standard', ...variants.map((one) => one.kind), 'standard'].sort(),
          );
          expect(await read.item(by, legacyId)).toMatchObject({
            id: legacyId,
            category: child.id,
            baseUnit: item.baseUnit,
            status: 'active',
            statusHistory: [],
          });
          expect((await read.eligibility(by, item.id, 'purchase')).ok).toBe(false);
        } finally {
          await store.close();
          if (backend === 'postgres') {
            const pool = new Pool({ connectionString: pgUrl });
            try {
              await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
            } finally {
              await pool.end();
            }
          }
          await rm(directory, { recursive: true, force: true });
        }
      });
    },
  );
}
