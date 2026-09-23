import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { newId, systemClock } from '@vertex/kernel';
import {
  commandContext,
  createCourier,
  createEventBus,
  createTransactor,
  operationMailboxMigrations,
  outboxEntries,
  runMigrations,
  type CommandContext,
  type Courier,
  type MemorySession,
  type Timer,
} from '@vertex/platform';
import { openPostgresStore, openSqliteStore, type PersistentStore } from '@vertex/storage';
import { storeLink } from '@vertex/store-link';
import { afterEach, describe, expect, it } from 'vitest';

import {
  fixtureQuantity,
  openFixtureStock,
  stageFixtureSale,
  stockFixtureMigrations,
} from './stock-fixture.js';
import { composeStoreNode, type StoreNode, type StoreNodeListener } from './store-node.js';

const database = process.env['VERTEX_TEST_POSTGRES_URL'];
if (process.env['CI'] && !database)
  throw new Error('CI must provide VERTEX_TEST_POSTGRES_URL for SYN-06 persistence tests.');

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function tx(store: PersistentStore) {
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

/**
 * A timer that waits for the test. Every attempt the courier makes on its own
 * is one the test chose to let happen, so a journey over a real network reads
 * as the sequence it is rather than as a race against a backoff.
 */
function handTimer() {
  let waiting: (() => Promise<void>) | null = null;
  const timer: Timer = {
    after(_delay, run) {
      waiting = run;
      return () => {
        if (waiting === run) waiting = null;
      };
    },
  };
  return {
    timer,
    fire(): Promise<void> {
      const run = waiting;
      if (run === null) throw new Error('The courier is not waiting.');
      waiting = null;
      return run();
    },
  };
}

/**
 * A shop over the real wire: a store node on PostgreSQL, one register paired
 * to it, the register's own SQLite store, and a courier delivering from it
 * through the HTTP link.
 */
async function shop() {
  if (!database) throw new Error('PostgreSQL is required.');
  const schema = `vertex_syn06_${newId<'schema'>().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'vertex-syn06-'));
  const options = {
    connectionString: database,
    schema,
    attachmentsDirectory: directory,
    enableStockFixture: true,
  };
  cleanup.push(async () => {
    const pool = new Pool({ connectionString: database });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  });

  const tenant = newId<'tenant'>();
  let node: StoreNode = await composeStoreNode(options);
  let listener: StoreNodeListener | null = await node.listen(0);
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address.');
  const port = address.port;
  const base = `http://127.0.0.1:${String(port)}`;
  cleanup.push(async () => {
    await listener?.close();
    await node.close();
  });
  await node.provisionTenant(tenant, 'owner', 'syn06-owner-1');

  const post = async (path: string, body: unknown, token = '') =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const signIn = async () => {
    const response = await post('/v1/sign-in', {
      tenant,
      handle: 'owner',
      password: 'syn06-owner-1',
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { token: string; authenticated: { user: string } };
  };
  let identity = await signIn();
  const write = async (route: string, args: unknown[]) => {
    const response = await post(`/v1/tenants/${tenant}/${route}`, { args }, identity.token);
    expect(response.status).toBe(200);
    const result = (await response.json()) as { value: { ok: boolean; value: { id: string } } };
    expect(result.value.ok).toBe(true);
    return result.value.value.id;
  };

  const company = await write('companies.register', [{ name: 'Shop' }]);
  const branch = await write('branches.open', [{ company, name: 'Aleppo' }]);
  const location = await write('locations.open', [{ branch, name: 'Floor', kind: 'shop-floor' }]);
  const register = await write('registers.open', [{ branch, name: 'Till', prefix: 'TL1' }]);
  const device = newId<'device'>();
  await write('registers.assignDevice', [register, device]);
  const pairing = await post(
    `/v1/tenants/${tenant}/devices.pair`,
    { register, device },
    identity.token,
  );
  expect(pairing.status).toBe(200);
  const credential = ((await pairing.json()) as { credential: string }).credential;

  const item = newId<'item'>();
  const actor = identity.authenticated.user as CommandContext['actor'];
  const server = await openPostgresStore(options);
  cleanup.push(() => server.close());
  await tx(server).run(commandContext({ tenant, actor }), (uow) => {
    openFixtureStock(uow, { item, location, movement: newId<'movement'>(), quantity: '20' });
    return Promise.resolve();
  });

  const context = commandContext({ tenant, actor, device });
  const file = join(directory, 'till.sqlite');
  let till = await openSqliteStore(file);
  cleanup.push(() => till.close());
  await runMigrations({
    plan: [...operationMailboxMigrations<MemorySession>(), ...stockFixtureMigrations()],
    transactor: tx(till),
    context,
    journal: till.journal,
  });

  const hand = handTimer();
  const faults: unknown[] = [];
  const link = storeLink({
    baseUrl: base,
    tenant,
    register,
    credential,
    session: () => identity.token,
    timeout: 5_000,
  });
  const courierOver = (store: PersistentStore): Courier => {
    const courier = createCourier({
      transactor: tx(store),
      context,
      link,
      clock: systemClock,
      timer: hand.timer,
      onFault: (cause) => faults.push(cause),
    });
    cleanup.push(() => courier.stop());
    return courier;
  };

  return {
    hand,
    faults,
    courier: courierOver(till),
    /** A sale rung at the till: its movement and its outgoing operation, in one transaction. */
    async sell(delta: string) {
      return tx(till).run(context, (uow) =>
        Promise.resolve(
          stageFixtureSale(uow, { movement: newId<'movement'>(), item, location, delta }),
        ),
      );
    },
    /** The quantity the store node holds, derived from the movements it applied. */
    async quantity() {
      return tx(server).run(commandContext({ tenant, actor }), (uow) =>
        Promise.resolve(fixtureQuantity(uow.session, tenant, item, location)),
      );
    },
    async outbox() {
      return tx(till).run(context, (uow) =>
        Promise.resolve(outboxEntries(uow.session, tenant, device)),
      );
    },
    /** The store node's network goes away; the process, its sessions and its data do not. */
    async unplug() {
      await listener?.close();
      listener = null;
    },
    async plugIn() {
      listener = await node.listen(port);
    },
    /** The store node process restarts: its data survives and its sessions do not. */
    async restartNode() {
      await listener?.close();
      await node.close();
      node = await composeStoreNode(options);
      listener = await node.listen(port);
    },
    async signIn() {
      identity = await signIn();
    },
    write,
    register,
    /** The till restarts: a new courier over the same file. */
    async restartTill() {
      await till.close();
      till = await openSqliteStore(file);
      return courierOver(till);
    },
  };
}

describe.skipIf(!database)('SYN-06 sync status and failure handling, over the real wire', () => {
  it('SYN-06 POS-18 connected, offline, pending and recovered: a register that lost its store node', async () => {
    const s = await shop();
    await s.courier.start();
    expect(s.courier.status()).toMatchObject({ connection: 'online', queue: [] });
    expect(s.courier.status().lastContact).not.toBeNull();

    // The shop's network drops. The till keeps selling; the store node hears nothing.
    await s.unplug();
    const first = await s.sell('-2');
    await s.courier.nudge();
    const second = await s.sell('-3');
    await s.courier.nudge();
    expect(s.courier.status()).toMatchObject({
      connection: 'offline',
      queue: [
        { key: first.key, sequence: 1 },
        { key: second.key, sequence: 2 },
      ],
    });
    expect(s.courier.status().nextAttempt).not.toBeNull();
    // Waiting for a line is not a failure of either sale.
    expect((await s.outbox()).some((entry) => entry.failure !== undefined)).toBe(false);
    expect(await s.quantity()).toBe('20');

    // Still down when the backoff runs out: it waits again, longer.
    await s.hand.fire();
    expect(s.courier.status().connection).toBe('offline');

    // Back. The courier finds it on its own, and the queue drains in order.
    await s.plugIn();
    await s.hand.fire();
    expect(s.courier.status()).toMatchObject({
      connection: 'online',
      queue: [],
      nextAttempt: null,
    });
    expect(await s.quantity()).toBe('15');
    expect((await s.outbox()).every((entry) => entry.acknowledged)).toBe(true);
    expect(s.faults).toEqual([]);
  });

  it('SYN-06 POS-18 failed, escalated and recovered: an operation the store node refuses', async () => {
    const s = await shop();
    await s.courier.start();

    // A manager withdraws the register while it is trading. What it rings now
    // is refused: the store node answers, and says no to this register.
    await s.write('registers.deactivate', [s.register]);
    const refused = await s.sell('-1');
    await s.courier.nudge();
    const behind = await s.sell('-4');
    await s.courier.nudge();
    const status = s.courier.status();
    expect(status.connection).toBe('online');
    expect(status.queue).toMatchObject([
      { key: refused.key, failure: { reason: 'forbidden', attempts: 1 } },
      { key: behind.key },
    ]);
    // Only the head is failed: the sale behind it is waiting its turn, not refused.
    expect(status.queue[1]).not.toHaveProperty('failure');
    expect(await s.quantity()).toBe('20');

    // Somebody at the till hands it on.
    const escalated = await s.courier.escalate(refused.key);
    expect(escalated.ok).toBe(true);

    // The till is switched off and on. The failure and who escalated it were
    // on its own disk: the first attempt after the restart is counted onto the
    // same failure, dated from the first refusal, rather than starting afresh.
    await s.courier.stop();
    const restarted = await s.restartTill();
    await restarted.start();
    const again = restarted.status().queue[0];
    expect(again).toMatchObject({
      key: refused.key,
      failure: { reason: 'forbidden', attempts: 2 },
      escalation: { by: expect.any(String) as unknown },
    });
    expect(again?.failure?.since).toBe(status.queue[0]?.failure?.since);

    // The manager puts the register back, and a person asks for a retry now
    // rather than waiting out the backoff.
    await s.write('registers.reactivate', [s.register]);
    await restarted.retry();
    expect(restarted.status()).toMatchObject({ connection: 'online', queue: [] });
    expect(await s.quantity()).toBe('15');
    const [settled] = await s.outbox();
    expect(settled).toMatchObject({
      acknowledged: true,
      escalation: { by: expect.any(String) as unknown },
    });
    expect(settled).not.toHaveProperty('failure');
  });

  it('SYN-06 POS-18 signed out: a store node that restarted and forgot the session', async () => {
    const s = await shop();
    await s.courier.start();
    const sale = await s.sell('-2');

    await s.restartNode();
    await s.courier.nudge();
    expect(s.courier.status()).toMatchObject({
      connection: 'signed-out',
      queue: [{ key: sale.key }],
    });
    // Not the sale's fault: nothing is recorded against it.
    expect((await s.outbox())[0]).not.toHaveProperty('failure');

    await s.signIn();
    await s.courier.retry();
    expect(s.courier.status()).toMatchObject({ connection: 'online', queue: [] });
    expect(await s.quantity()).toBe('18');
  });
});
