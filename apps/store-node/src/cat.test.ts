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
  describe.skipIf(backend === 'postgres' && !pgUrl)(`CAT-01 ${backend} restart persistence`, () => {
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
        await store.close();
        store = await openStore();
        const read = registry().require(Catalogue);
        expect((await read.categories(by)).map((one) => one.name)).toEqual(['غذاء', 'معلبات']);
        expect(await read.item(by, item.id)).toEqual(item);
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
  });
}
