import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { newId, systemClock } from '@vertex/kernel';
import {
  createEventBus,
  createTransactor,
  runMigrations,
  systemContext,
  untilCommitted,
  SerialisationConflictError,
  type MigrationDeclaration,
  type MemorySession,
} from '@vertex/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { openPostgresStore, openSqliteStore, type PersistentStore } from './index.js';

const pgUrl = process.env['VERTEX_TEST_POSTGRES_URL'];
if (process.env['CI'] && !pgUrl)
  throw new Error('CI must provide VERTEX_TEST_POSTGRES_URL for the real PostgreSQL SYN-01 tests.');
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture(kind: 'store-node' | 'terminal') {
  const tenant = newId<'tenant'>();
  const other = newId<'tenant'>();
  const dir = await mkdtemp(join(tmpdir(), 'vertex-syn-01-'));
  const schema = `vertex_test_${newId<'schema'>().replaceAll('-', '')}`;
  const config =
    kind === 'terminal'
      ? { path: join(dir, 'terminal.sqlite') }
      : { connectionString: pgUrl!, schema };
  let store: PersistentStore;
  try {
    store =
      kind === 'terminal'
        ? await openSqliteStore(config.path!)
        : await openPostgresStore(config as { connectionString: string; schema: string });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  const close = async () => {
    await store.close();
    if (kind === 'store-node') {
      const admin = new Pool({ connectionString: pgUrl });
      try {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
    await rm(dir, { recursive: true, force: true });
  };
  cleanup.push(close);
  const reopen = async () => {
    await store.close();
    store =
      kind === 'terminal'
        ? await openSqliteStore(config.path!)
        : await openPostgresStore(config as { connectionString: string; schema: string });
    return store;
  };
  const peer = async (): Promise<PersistentStore> => {
    const another =
      kind === 'terminal'
        ? await openSqliteStore(config.path!)
        : await openPostgresStore(config as { connectionString: string; schema: string });
    cleanup.push(() => another.close());
    return another;
  };
  const context = systemContext(tenant);
  const byOther = systemContext(other);
  const transact = () =>
    createTransactor({
      driver: store.driver,
      bus: createEventBus({
        onHandlerFailure: (failure) => {
          throw failure.cause;
        },
      }),
      clock: systemClock,
      onEffectFailure: (failure) => {
        throw failure.cause;
      },
    });
  return {
    get store() {
      return store;
    },
    context,
    byOther,
    transact,
    reopen,
    peer,
    config,
  };
}

for (const kind of ['terminal', 'store-node'] as const) {
  describe.skipIf(kind === 'store-node' && !pgUrl)(`${kind} durable store — SYN-01`, () => {
    it('commits exact nested values and the journal before resolving, across a new process', async () => {
      const f = await fixture(kind);
      const value = {
        tenant: f.context.tenant,
        id: newId<'sale'>(),
        total: '100000000000000000.000001',
        nested: { lines: [{ qty: '0.000000001', tags: ['عربي', 'a/b'] }] },
      };
      await f.transact().run(f.context, (uow) => {
        uow.session.put(`sale/${f.context.tenant}/1`, value);
        return Promise.resolve();
      });
      const plan: MigrationDeclaration<MemorySession>[] = [
        {
          id: 'sys.0001-durable',
          target: 'both',
          up: (session) => {
            session.put('schema/proof', { version: '1' });
            return Promise.resolve();
          },
        },
      ];
      const first = await runMigrations({
        plan,
        transactor: f.transact(),
        context: f.context,
        journal: f.store.journal,
      });
      expect(first.applied).toEqual(['sys.0001-durable']);
      const code = `import { openSqliteStore, openPostgresStore } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
        const config = JSON.parse(process.env.VERTEX_STORE_CONFIG);
        const store = config.path ? await openSqliteStore(config.path) : await openPostgresStore(config);
        const session = await store.driver.begin({tenant:'read', actor:null, device:null, correlation:'read'});
        process.stdout.write(JSON.stringify([session.get(process.env.VERTEX_RECORD_KEY), session.get('schema/proof'), [...await store.journal.applied(session)]]));
        await store.driver.rollback(session); await store.close();`;
      await f.store.close();
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        encoding: 'utf8',
        env: {
          ...process.env,
          VERTEX_STORE_CONFIG: JSON.stringify(f.config),
          VERTEX_RECORD_KEY: `sale/${f.context.tenant}/1`,
        },
      });
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual([value, { version: '1' }, ['sys.0001-durable']]);
    });

    it('rolls back failed commands and failed migrations with no journal entry after restart', async () => {
      const f = await fixture(kind);
      await expect(
        f.transact().run(f.context, (uow) => {
          uow.session.put('partial', { yes: true });
          throw Error('failed');
        }),
      ).rejects.toThrow('failed');
      const plan: MigrationDeclaration<MemorySession>[] = [
        {
          id: 'sys.0001-fails',
          target: 'both',
          up: (session) => {
            session.put('migration/partial', 1);
            throw Error('no');
          },
        },
      ];
      await expect(
        runMigrations({
          plan,
          transactor: f.transact(),
          context: f.context,
          journal: f.store.journal,
        }),
      ).rejects.toThrow();
      await f.reopen();
      await f.transact().run(f.context, async (uow) => {
        expect(uow.session.get('partial')).toBeUndefined();
        expect(uow.session.get('migration/partial')).toBeUndefined();
        expect(await f.store.journal.applied(uow.session)).toEqual(new Set());
      });
    });

    it('does not repeat an applied migration after restart', async () => {
      const f = await fixture(kind);
      let calls = 0;
      const plan: MigrationDeclaration<MemorySession>[] = [
        {
          id: 'sys.0001-once',
          target: 'both',
          up: (session) => {
            calls++;
            session.put('once', calls);
            return Promise.resolve();
          },
        },
      ];
      await runMigrations({
        plan,
        transactor: f.transact(),
        context: f.context,
        journal: f.store.journal,
      });
      await f.reopen();
      const result = await runMigrations({
        plan,
        transactor: f.transact(),
        context: f.context,
        journal: f.store.journal,
      });
      expect(result.alreadyApplied).toEqual(['sys.0001-once']);
      expect(calls).toBe(1);
    });

    it('leaves both migration data and journal absent when the database rejects commit', async () => {
      const f = await fixture(kind);
      const rejected = 'platform.migration.sys.0001-blocked';
      if (kind === 'terminal') {
        const db = new DatabaseSync((f.config as { path: string }).path);
        try {
          db.exec(
            `CREATE TRIGGER reject_journal BEFORE INSERT ON vertex_records WHEN NEW.key = '${rejected}' BEGIN SELECT RAISE(ABORT, 'journal blocked'); END;`,
          );
        } finally {
          db.close();
        }
      } else {
        const schema = (f.config as { schema: string }).schema;
        const admin = new Pool({ connectionString: pgUrl });
        try {
          await admin.query(
            `CREATE FUNCTION "${schema}".reject_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'journal blocked'; END $$`,
          );
          await admin.query(
            `CREATE TRIGGER reject_journal BEFORE INSERT ON "${schema}".vertex_records FOR EACH ROW WHEN (NEW.key = '${rejected}') EXECUTE FUNCTION "${schema}".reject_journal()`,
          );
        } finally {
          await admin.end();
        }
      }
      const plan: MigrationDeclaration<MemorySession>[] = [
        {
          id: 'sys.0001-blocked',
          target: 'both',
          up: (session) => {
            session.put('migration/data', { yes: true });
            return Promise.resolve();
          },
        },
      ];
      await expect(
        runMigrations({
          plan,
          transactor: f.transact(),
          context: f.context,
          journal: f.store.journal,
        }),
      ).rejects.toThrow(/journal blocked/u);
      await f.reopen();
      await f.transact().run(f.context, async (uow) => {
        expect(uow.session.get('migration/data')).toBeUndefined();
        expect(await f.store.journal.applied(uow.session)).toEqual(new Set());
      });
    });

    it('rejects conflicting read/write decisions and key scans, then untilCommitted retries', async () => {
      const f = await fixture(kind);
      await f.transact().run(f.context, (uow) => {
        uow.session.put('counter', 0);
        return Promise.resolve();
      });
      const held = await f.store.driver.begin(f.context);
      expect(held.get('counter')).toBe(0);
      held.keys();
      await f.transact().run(f.context, (uow) => {
        uow.session.put('counter', 1);
        uow.session.put('new/key', true);
        return Promise.resolve();
      });
      held.put('counter', 1);
      held.put('decision', 0);
      await expect(f.store.driver.commit(held)).rejects.toBeInstanceOf(SerialisationConflictError);
      await untilCommitted(() =>
        f.transact().run(f.context, (uow) => {
          const n = uow.session.get('counter') as number;
          uow.session.put('counter', n + 1);
          return Promise.resolve();
        }),
      );
      await f.transact().run(f.context, (uow) => {
        expect(uow.session.get('counter')).toBe(2);
        expect(uow.session.get('decision')).toBeUndefined();
        return Promise.resolve();
      });
      const scan = await f.store.driver.begin(f.context);
      scan.keys();
      await f.transact().run(f.context, (uow) => {
        uow.session.put('newer/key', true);
        return Promise.resolve();
      });
      scan.put('scan/decision', true);
      await expect(f.store.driver.commit(scan)).rejects.toBeInstanceOf(SerialisationConflictError);
    });

    it('rejects a stale commit made through a second store connection', async () => {
      const f = await fixture(kind);
      const peer = await f.peer();
      const first = await f.store.driver.begin(f.context);
      first.keys();
      const second = await peer.driver.begin(f.context);
      second.put('serial/second', { id: '2' });
      await peer.driver.commit(second);
      first.put('serial/first', { id: '1' });
      await expect(f.store.driver.commit(first)).rejects.toBeInstanceOf(SerialisationConflictError);
      await f.transact().run(f.context, (uow) => {
        expect(uow.session.get('serial/second')).toEqual({ id: '2' });
        expect(uow.session.get('serial/first')).toBeUndefined();
        return Promise.resolve();
      });
    });

    it('rejects a corrupted persisted row instead of changing its value', async () => {
      const f = await fixture(kind);
      await f.transact().run(f.context, (uow) => {
        uow.session.put('integrity/1', { amount: '1.0001' });
        return Promise.resolve();
      });
      if (kind === 'terminal') {
        const db = new DatabaseSync((f.config as { path: string }).path);
        try {
          db.prepare('UPDATE vertex_records SET value = ? WHERE key = ?').run(
            '{"amount":"0"}',
            'integrity/1',
          );
        } finally {
          db.close();
        }
      } else {
        const schema = (f.config as { schema: string }).schema;
        const admin = new Pool({ connectionString: pgUrl });
        try {
          await admin.query(`UPDATE "${schema}".vertex_records SET value = $1 WHERE key = $2`, [
            '{"amount":"0"}',
            'integrity/1',
          ]);
        } finally {
          await admin.end();
        }
      }
      // A row is verified when it is loaded, not on every command. The store
      // already running serves the value it verified — never the damaged one —
      // and the next load of that row, here a restart, refuses it.
      await f.transact().run(f.context, (uow) => {
        expect(uow.session.get('integrity/1')).toEqual({ amount: '1.0001' });
        return Promise.resolve();
      });
      await expect(f.reopen()).resolves.toBeDefined();
      await expect(f.store.driver.begin(f.context)).rejects.toThrow(/Corrupted persisted record/u);
    });

    it('reads a revision it holds without reading the rows again, and a newer one in full', async () => {
      const f = await fixture(kind);
      const peer = await f.peer();
      await f.transact().run(f.context, (uow) => {
        uow.session.put('held/a', { n: '1' });
        uow.session.put('held/b', { n: '2' });
        return Promise.resolve();
      });
      // Begun before the next commits, and reading the revision it began at.
      const earlier = await f.store.driver.begin(f.context);
      await f.transact().run(f.context, (uow) => {
        uow.session.put('held/a', { n: '10' });
        uow.session.remove('held/b');
        uow.session.put('held/c', { n: '3' });
        return Promise.resolve();
      });
      expect(earlier.get('held/a')).toEqual({ n: '1' });
      expect(earlier.keys().filter((key) => key.startsWith('held/'))).toEqual(['held/a', 'held/b']);
      await f.store.driver.rollback(earlier);

      // What this store committed, it reads back from memory: the update, the
      // removal and the addition, with the listing re-sorted.
      await f.transact().run(f.context, (uow) => {
        expect(uow.session.get('held/a')).toEqual({ n: '10' });
        expect(uow.session.get('held/b')).toBeUndefined();
        expect(uow.session.keys().filter((key) => key.startsWith('held/'))).toEqual([
          'held/a',
          'held/c',
        ]);
        return Promise.resolve();
      });

      // What another connection committed moves the revision past the one
      // held, and the next command reads every row again.
      const theirs = await peer.driver.begin(f.context);
      theirs.put('held/d', { n: '4' });
      theirs.put('held/a', { n: '11' });
      await peer.driver.commit(theirs);
      await f.transact().run(f.context, (uow) => {
        expect(uow.session.get('held/a')).toEqual({ n: '11' });
        expect(uow.session.keys().filter((key) => key.startsWith('held/'))).toEqual([
          'held/a',
          'held/c',
          'held/d',
        ]);
        return Promise.resolve();
      });
    });

    it('hands every command its own copy of what it reads', async () => {
      const f = await fixture(kind);
      await f.transact().run(f.context, (uow) => {
        uow.session.put('copy/1', { lines: ['a'] });
        return Promise.resolve();
      });
      await f.transact().run(f.context, (uow) => {
        (uow.session.get('copy/1') as { lines: string[] }).lines.push('edited, never put');
        return Promise.resolve();
      });
      await f.transact().run(f.context, (uow) => {
        expect(uow.session.get('copy/1')).toEqual({ lines: ['a'] });
        return Promise.resolve();
      });
    });

    it('commits a write of thousands of records in one command', async () => {
      const f = await fixture(kind);
      const count = 2500;
      await f.transact().run(f.context, (uow) => {
        for (let at = 0; at < count; at += 1)
          uow.session.put(`bulk/${String(at).padStart(5, '0')}`, { at });
        return Promise.resolve();
      });
      await f.transact().run(f.context, (uow) => {
        for (let at = 0; at < count; at += 2)
          uow.session.remove(`bulk/${String(at).padStart(5, '0')}`);
        return Promise.resolve();
      });
      const reopened = await f.reopen();
      const session = await reopened.driver.begin(f.context);
      const kept = session.keys().filter((key) => key.startsWith('bulk/'));
      expect(kept).toHaveLength(count / 2);
      expect(session.get(kept.at(-1)!)).toEqual({ at: count - 1 });
      await reopened.driver.rollback(session);
    });

    it('keeps tenant records separate and rejects unsupported values', async () => {
      const f = await fixture(kind);
      await f.transact().run(f.context, (uow) => {
        uow.session.put(`sys/branch/${f.context.tenant}/1`, {
          tenant: f.context.tenant,
          amount: '1.001',
        });
        return Promise.resolve();
      });
      await f.transact().run(f.byOther, (uow) => {
        expect(
          uow.session.keys().filter((key) => key.startsWith(`sys/branch/${f.byOther.tenant}/`)),
        ).toEqual([]);
        expect(uow.session.get(`sys/branch/${f.byOther.tenant}/1`)).toBeUndefined();
        return Promise.resolve();
      });
      await expect(
        f.transact().run(f.context, (uow) => {
          uow.session.put('bad', { omitted: undefined });
          return Promise.resolve();
        }),
      ).rejects.toThrow(/unsupported|undefined/u);
    });
  });
}
