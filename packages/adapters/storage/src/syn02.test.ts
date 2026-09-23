import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { newId, systemClock } from '@vertex/kernel';
import {
  commandContext,
  createEventBus,
  createTransactor,
  operationMailboxMigrations,
  runMigrations,
  stageOperation,
  receiveOperation,
  deliverOutbox,
  outboxEntries,
  untilCommitted,
  type MemorySession,
  type OperationEnvelope,
} from '@vertex/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { openPostgresStore, openSqliteStore, type PersistentStore } from './index.js';

const postgres = process.env['VERTEX_TEST_POSTGRES_URL'];
if (process.env['CI'] && !postgres)
  throw new Error('CI must provide VERTEX_TEST_POSTGRES_URL for SYN-02 persistence tests.');

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function transactor(store: PersistentStore) {
  return createTransactor({
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
}

async function fixture(kind: 'sqlite' | 'postgres') {
  const tenant = newId<'tenant'>();
  const actor = newId<'user'>();
  const device = newId<'device'>();
  const by = commandContext({ tenant, actor, device });
  let open: () => Promise<PersistentStore>;
  if (kind === 'sqlite') {
    const directory = await mkdtemp(join(tmpdir(), 'vertex-syn02-'));
    const path = join(directory, 'terminal.sqlite');
    open = () => openSqliteStore(path);
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
  } else {
    if (!postgres) throw new Error('PostgreSQL test URL is required.');
    const schema = `vertex_syn02_${newId<'schema'>().replaceAll('-', '')}`;
    open = () => openPostgresStore({ connectionString: postgres, schema });
    cleanup.push(async () => {
      const pool = new Pool({ connectionString: postgres });
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    });
  }
  let store = await open();
  cleanup.push(() => store.close());
  let tx = transactor(store);
  const migrate = () =>
    runMigrations({
      plan: operationMailboxMigrations<MemorySession>(),
      transactor: tx,
      context: by,
      journal: store.journal,
    });
  await migrate();
  return {
    by,
    get tx() {
      return tx;
    },
    async restart() {
      await store.close();
      store = await open();
      tx = transactor(store);
      await migrate();
    },
  };
}

for (const kind of ['sqlite', 'postgres'] as const) {
  describe.skipIf(kind === 'postgres' && !postgres)(`SYN-02 ${kind} mailboxes`, () => {
    it('numbers each device independently and refuses non-exact operation values', async () => {
      const shop = await fixture(kind);
      const other = commandContext({
        tenant: shop.by.tenant,
        actor: shop.by.actor,
        device: newId<'device'>(),
      });
      const first = await shop.tx.run(shop.by, (uow) =>
        Promise.resolve(stageOperation(uow, 'syn02.fixture-post', { amount: '10.005' })),
      );
      const anotherDevice = await shop.tx.run(other, (uow) =>
        Promise.resolve(stageOperation(uow, 'syn02.fixture-post', { amount: '2.500' })),
      );
      const second = await shop.tx.run(shop.by, (uow) =>
        Promise.resolve(stageOperation(uow, 'syn02.fixture-post', { amount: '0.010' })),
      );
      expect([first.sequence, anotherDevice.sequence, second.sequence]).toEqual([1, 1, 2]);
      await expect(
        shop.tx.run(shop.by, (uow) => {
          uow.session.put('local.invalid', true);
          return Promise.resolve(stageOperation(uow, 'syn02.fixture-post', { amount: 0.1 }));
        }),
      ).rejects.toThrow('decimal strings');
      expect(
        await shop.tx.run(shop.by, (uow) => Promise.resolve(uow.session.get('local.invalid'))),
      ).toBeUndefined();
      await shop.restart();
      expect(
        await shop.tx.run(other, (uow) =>
          Promise.resolve(outboxEntries(uow.session, other.tenant, other.device!)),
        ),
      ).toEqual([{ envelope: anotherDevice, acknowledged: false }]);
      for (const [by, envelope] of [
        [shop.by, first],
        [other, anotherDevice],
        [shop.by, second],
      ] as const)
        expect(
          await shop.tx.run(by, (uow) => receiveOperation(uow, envelope, () => Promise.resolve())),
        ).toEqual({ status: 'applied' });
    });

    it('rolls back local data and outbox together, then survives restart after commit', async () => {
      const shop = await fixture(kind);
      await expect(
        shop.tx.run(shop.by, (uow) => {
          uow.session.put('fixture.document', { amount: '12.3400' });
          stageOperation(uow, 'syn02.fixture-post', { document: 'doc-1', amount: '12.3400' });
          return Promise.reject(new Error('power lost before commit'));
        }),
      ).rejects.toThrow('power lost before commit');
      expect(
        await shop.tx.run(shop.by, (uow) =>
          Promise.resolve({
            document: uow.session.get('fixture.document'),
            entries: outboxEntries(uow.session, shop.by.tenant, shop.by.device!),
          }),
        ),
      ).toEqual({ document: undefined, entries: [] });

      const first = await shop.tx.run(shop.by, (uow) => {
        uow.session.put('fixture.document', { amount: '12.3400' });
        return Promise.resolve(
          stageOperation(uow, 'syn02.fixture-post', { document: 'doc-1', amount: '12.3400' }),
        );
      });
      await shop.restart();
      expect(
        await shop.tx.run(shop.by, (uow) =>
          Promise.resolve({
            document: uow.session.get('fixture.document'),
            entries: outboxEntries(uow.session, shop.by.tenant, shop.by.device!),
          }),
        ),
      ).toEqual({
        document: { amount: '12.3400' },
        entries: [{ envelope: first, acknowledged: false }],
      });
    });

    it('applies once across lost acknowledgement, full replay, conflict, gaps and concurrent duplicates', async () => {
      const terminal = await fixture(kind);
      const server = await fixture(kind);
      const envelope = await terminal.tx.run(terminal.by, (uow) => {
        uow.session.put('local.document', { amount: '12.3400' });
        return Promise.resolve(
          stageOperation(uow, 'syn02.fixture-post', { document: 'doc-1', amount: '12.3400' }),
        );
      });
      const apply = (candidate: OperationEnvelope) =>
        untilCommitted(() =>
          server.tx.run(terminal.by, async (uow) =>
            receiveOperation(uow, candidate, () => {
              const count = (uow.session.get('server.count') as number | undefined) ?? 0;
              uow.session.put('server.count', count + 1);
              uow.session.put('server.balance', candidate.payload);
              return Promise.resolve();
            }),
          ),
        );
      expect(await apply(envelope)).toEqual({ status: 'applied' });
      await server.restart(); // Server applied; acknowledgement was lost.
      expect(await apply(envelope)).toEqual({ status: 'duplicate' });
      expect(await Promise.all([apply(envelope), apply(envelope)])).toEqual([
        { status: 'duplicate' },
        { status: 'duplicate' },
      ]);
      expect(await apply({ ...envelope, payload: { document: 'doc-1', amount: '99.00' } })).toEqual(
        { status: 'conflict' },
      );
      expect(await apply({ ...envelope, key: newId<'operation'>(), sequence: 3 })).toEqual({
        status: 'sequence-gap',
        expected: 2,
      });
      const second = await terminal.tx.run(terminal.by, (uow) =>
        Promise.resolve(
          stageOperation(uow, 'syn02.fixture-post', { document: 'doc-2', amount: '0.0100' }),
        ),
      );
      await expect(
        server.tx.run(terminal.by, async (uow) =>
          receiveOperation(uow, second, () => {
            uow.session.put('server.count', 99);
            return Promise.reject(new Error('interrupted during apply'));
          }),
        ),
      ).rejects.toThrow('interrupted during apply');
      expect(
        await server.tx.run(terminal.by, (uow) => Promise.resolve(uow.session.get('server.count'))),
      ).toBe(1);
      expect(
        (await Promise.all([apply(second), apply(second)])).map((one) => one.status).sort(),
      ).toEqual(['applied', 'duplicate']);
      expect(await apply({ ...envelope, key: newId<'operation'>() })).toEqual({
        status: 'out-of-order',
        expected: 3,
      });
      expect(await deliverOutbox(terminal.tx, terminal.by, apply)).toEqual({
        acknowledged: 2,
        halted: null,
      });
      await terminal.restart();
      expect(
        await terminal.tx.run(terminal.by, (uow) =>
          Promise.resolve(outboxEntries(uow.session, terminal.by.tenant, terminal.by.device!)),
        ),
      ).toEqual([
        { envelope, acknowledged: true },
        { envelope: second, acknowledged: true },
      ]);
      for (const entry of await terminal.tx.run(terminal.by, (uow) =>
        Promise.resolve(outboxEntries(uow.session, terminal.by.tenant, terminal.by.device!)),
      ))
        expect(await apply(entry.envelope)).toEqual({ status: 'duplicate' });
      expect(
        await server.tx.run(terminal.by, (uow) => Promise.resolve(uow.session.get('server.count'))),
      ).toBe(2);
      expect(
        await server.tx.run(terminal.by, (uow) =>
          Promise.resolve(uow.session.get('server.balance')),
        ),
      ).toEqual({ document: 'doc-2', amount: '0.0100' });
    });
  });
}
