import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { newId, systemClock, type Id } from '@vertex/kernel';
import { openPostgresStore, openSqliteStore } from '@vertex/storage';
import {
  commandContext,
  createEventBus,
  createTransactor,
  deliverOutbox,
  operationMailboxMigrations,
  outboxEntries,
  runMigrations,
  type MemorySession,
  type Receipt,
} from '@vertex/platform';
import { afterEach, describe, expect, it } from 'vitest';

import {
  fixtureQuantity,
  fixtureMovements,
  openFixtureStock,
  stageFixtureSale,
  stockFixtureMigrations,
} from './stock-fixture.js';
import { composeStoreNode } from './store-node.js';

const database = process.env['VERTEX_TEST_POSTGRES_URL'];
if (process.env['CI'] && !database)
  throw new Error('CI must provide VERTEX_TEST_POSTGRES_URL for SYN-03 persistence tests.');

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function tx(store: Awaited<ReturnType<typeof openSqliteStore>>) {
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

async function shop() {
  if (!database) throw new Error('PostgreSQL is required.');
  const schema = `vertex_syn03_${newId<'schema'>().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'vertex-syn03-'));
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
  const foreignTenant = newId<'tenant'>();
  let node = await composeStoreNode(options);
  let listener = await node.listen(0);
  cleanup.push(async () => {
    await listener.close();
    await node.close();
  });
  await node.provisionTenant(tenant, 'owner', 'stock-fixture-1');
  await node.provisionTenant(foreignTenant, 'other', 'stock-fixture-2');
  const base = () => {
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address.');
    return `http://127.0.0.1:${String(address.port)}`;
  };
  const request = (path: string, token: string, body: unknown, deviceToken?: string) =>
    fetch(`${base()}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(deviceToken ? { 'x-vertex-device-token': deviceToken } : {}),
      },
      body: JSON.stringify(body),
    });
  const login = async (which = tenant, handle = 'owner', password = 'stock-fixture-1') => {
    const response = await request('/v1/sign-in', '', { tenant: which, handle, password });
    expect(response.status).toBe(200);
    return (await response.json()) as { token: string; authenticated: { user: string } };
  };
  let identity = await login();
  const write = async (route: string, args: unknown[]) => {
    const response = await request(`/v1/tenants/${tenant}/${route}`, identity.token, { args });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { value: { ok: boolean; value: { id: string } } };
    expect(result.value.ok).toBe(true);
    return result.value.value.id;
  };
  const company = await write('companies.register', [{ name: 'Shop' }]);
  const branch = await write('branches.open', [{ company, name: 'Aleppo' }]);
  const location = await write('locations.open', [{ branch, name: 'Floor', kind: 'shop-floor' }]);
  const otherBranch = await write('branches.open', [{ company, name: 'Damascus' }]);
  const otherLocation = await write('locations.open', [
    { branch: otherBranch, name: 'Other floor', kind: 'shop-floor' },
  ]);
  const item = newId<'item'>();
  const serverStore = await openPostgresStore(options);
  cleanup.push(() => serverStore.close());
  const by = commandContext({
    tenant,
    actor: identity.authenticated.user as Parameters<typeof commandContext>[0]['actor'],
  });
  await tx(serverStore).run(by, (uow) => {
    openFixtureStock(uow, { item, location, movement: newId<'movement'>(), quantity: '10' });
    return Promise.resolve();
  });
  const terminals: {
    register: string;
    device: Id<'device'>;
    credential: string;
    context: ReturnType<typeof commandContext>;
    movement: string;
    delta: string;
    envelope: ReturnType<typeof stageFixtureSale>;
    readonly store: Awaited<ReturnType<typeof openSqliteStore>>;
    restart(): Promise<void>;
  }[] = [];
  for (const [name, delta] of [
    ['A', '-2'],
    ['B', '-3'],
  ] as const) {
    const register = await write('registers.open', [
      { branch, name, prefix: name === 'A' ? 'AA1' : 'BB1' },
    ]);
    const device = newId<'device'>();
    await write('registers.assignDevice', [register, device]);
    const pair = await request(`/v1/tenants/${tenant}/devices.pair`, identity.token, {
      register,
      device,
    });
    expect(pair.status).toBe(200);
    const credential = ((await pair.json()) as { credential: string }).credential;
    const file = join(directory, `${name}.sqlite`);
    let store = await openSqliteStore(file);
    cleanup.push(() => store.close());
    const context = commandContext({ tenant, actor: by.actor, device });
    await runMigrations({
      plan: [...operationMailboxMigrations<MemorySession>(), ...stockFixtureMigrations()],
      transactor: tx(store),
      context,
      journal: store.journal,
    });
    const movement = newId<'movement'>();
    const envelope = await tx(store).run(context, (uow) =>
      Promise.resolve(stageFixtureSale(uow, { movement, item, location, delta })),
    );
    await store.close();
    store = await openSqliteStore(file);
    terminals.push({
      register,
      device,
      credential,
      context,
      movement,
      delta,
      envelope,
      get store() {
        return store;
      },
      async restart() {
        await store.close();
        store = await openSqliteStore(file);
      },
    });
  }
  const deliver = (
    terminal: (typeof terminals)[number],
    candidate: unknown = terminal.envelope,
    token = identity.token,
    pathTenant = tenant,
    credential = terminal.credential,
    register = terminal.register,
  ) =>
    request(
      `/v1/tenants/${pathTenant}/operations.deliver`,
      token,
      { register, envelope: candidate },
      credential,
    );
  const state = async () =>
    tx(serverStore).run(by, (uow) =>
      Promise.resolve({
        quantity: fixtureQuantity(uow.session, tenant, item, location),
        movements: fixtureMovements(uow.session, tenant, item, location),
      }),
    );
  return {
    tenant,
    foreignTenant,
    identity,
    item,
    location,
    otherLocation,
    terminals,
    deliver,
    state,
    login,
    request,
    write,
    async restart() {
      await listener.close();
      await node.close();
      node = await composeStoreNode(options);
      listener = await node.listen(0);
      identity = await login();
    },
  };
}

describe.skipIf(!database)('SYN-03 delta-based stock synchronization', () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ] as const) {
    it(`SYN-03 reconciles two offline terminals in delivery order ${order.join(',')}`, async () => {
      const s = await shop();
      const [a, b] = s.terminals;
      expect(a && b).toBeTruthy();
      expect(await s.state()).toMatchObject({ quantity: '10', movements: [expect.anything()] });
      for (const index of order) {
        const terminal = s.terminals[index]!;
        const response = await s.deliver(terminal);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'applied' });
      }
      expect(await s.state()).toMatchObject({
        quantity: '5',
        movements: [expect.anything(), expect.anything(), expect.anything()],
      });
      await s.restart();
      for (const terminal of s.terminals) {
        expect(
          await tx(terminal.store).run(terminal.context, (uow) =>
            Promise.resolve(outboxEntries(uow.session, s.tenant, terminal.device)),
          ),
        ).toEqual([{ envelope: terminal.envelope, acknowledged: false }]);
        expect((await s.deliver(terminal)).status).toBe(200);
        expect(
          await Promise.all([s.deliver(terminal), s.deliver(terminal)]).then((responses) =>
            responses.map((r) => r.status),
          ),
        ).toEqual([200, 200]);
        expect(
          await deliverOutbox(
            tx(terminal.store),
            terminal.context,
            async (envelope) => (await (await s.deliver(terminal, envelope)).json()) as Receipt,
          ),
        ).toEqual({ acknowledged: 1, halted: null });
        await terminal.restart();
        expect(
          await tx(terminal.store).run(terminal.context, (uow) =>
            Promise.resolve(outboxEntries(uow.session, s.tenant, terminal.device)),
          ),
        ).toEqual([{ envelope: terminal.envelope, acknowledged: true }]);
      }
      expect((await s.state()).quantity).toBe('5');
      expect((await s.state()).movements).toHaveLength(3);
    });
  }

  it('SYN-03 keeps fractional deltas exact and records server-validated provenance', async () => {
    const s = await shop();
    const a = s.terminals[0]!;
    const next = await tx(a.store).run(a.context, (uow) =>
      Promise.resolve(
        stageFixtureSale(uow, {
          movement: newId<'movement'>(),
          item: s.item,
          location: s.location,
          delta: '-0.125',
        }),
      ),
    );
    expect(next.sequence).toBe(2);
    expect((await s.deliver(a)).status).toBe(200);
    expect((await s.deliver(a, next)).status).toBe(200);
    const state = await s.state();
    expect(state.quantity).toBe('7.875');
    expect(state.movements).toHaveLength(3);
    expect(state.movements.find((one) => one.movement === next.payload.movement)).toMatchObject({
      tenant: s.tenant,
      item: s.item,
      location: s.location,
      delta: '-0.125',
      actor: s.identity.authenticated.user,
      device: a.device,
      sequence: 2,
      source: 'sale-fixture',
    });
  });

  it('SYN-03 rejects forged authority, malformed deltas, identity reuse, gaps, and rollback without changing stock', async () => {
    const s = await shop();
    const a = s.terminals[0]!;
    const foreign = await s.login(s.foreignTenant, 'other', 'stock-fixture-2');
    const candidate = a.envelope;
    await expect(
      tx(a.store).run(a.context, (uow) => {
        stageFixtureSale(uow, {
          movement: newId<'movement'>(),
          item: s.item,
          location: s.location,
          delta: '-1',
        });
        return Promise.reject(new Error('interrupted before local commit'));
      }),
    ).rejects.toThrow('interrupted before local commit');
    expect(
      await tx(a.store).run(a.context, (uow) =>
        Promise.resolve({
          movements: fixtureMovements(uow.session, s.tenant, s.item, s.location).length,
          outbox: outboxEntries(uow.session, s.tenant, a.device).length,
        }),
      ),
    ).toEqual({ movements: 1, outbox: 1 });
    expect((await s.deliver(a, candidate, '')).status).toBe(401);
    expect((await s.deliver(a, { ...candidate, kind: 'danger.execute' })).status).toBe(422);
    expect((await s.deliver(a, candidate, s.identity.token, s.tenant, 'wrong')).status).toBe(403);
    expect((await s.deliver(a, candidate, foreign.token)).status).toBe(403);
    expect((await s.deliver(a, candidate, s.identity.token, s.foreignTenant)).status).toBe(403);
    expect((await s.deliver(a, { ...candidate, actor: newId<'user'>() })).status).toBe(403);
    expect((await s.deliver(a, { ...candidate, device: newId<'device'>() })).status).toBe(403);
    expect(
      (
        await s.deliver(a, {
          ...candidate,
          payload: { ...(candidate.payload as object), location: s.otherLocation },
        })
      ).status,
    ).toBe(403);
    for (const delta of ['NaN', '0', '2', '-0', '-0.1234567890123', '1e3', 0.1])
      expect(
        (await s.deliver(a, { ...candidate, payload: { ...(candidate.payload as object), delta } }))
          .status,
      ).toBe(400);
    expect(
      (
        await s.deliver(a, {
          ...candidate,
          payload: { ...candidate.payload, item: newId<'item'>() },
        })
      ).status,
    ).toBe(400);
    expect((await s.deliver(a, { ...candidate, sequence: 2 })).status).toBe(409);
    expect((await s.state()).quantity).toBe('10');
    expect((await s.state()).movements).toHaveLength(1);
    expect((await s.deliver(a)).status).toBe(200);
    expect(
      (
        await s.deliver(a, {
          ...candidate,
          payload: { ...(candidate.payload as object), delta: '-4' },
        })
      ).status,
    ).toBe(409);
    expect(
      (await s.deliver(a, { ...candidate, key: newId<'operation'>(), sequence: 2 })).status,
    ).toBe(409);
    expect((await s.deliver(a, { ...candidate, key: newId<'operation'>() })).status).toBe(409);
    await s.write('registers.assignDevice', [a.register, newId<'device'>()]);
    expect((await s.deliver(a)).status).toBe(403);
    expect(
      await tx(a.store).run(a.context, (uow) =>
        Promise.resolve(outboxEntries(uow.session, s.tenant, a.device)),
      ),
    ).toEqual([{ envelope: a.envelope, acknowledged: false }]);
    expect((await s.state()).quantity).toBe('8');
    expect((await s.state()).movements).toHaveLength(2);
  });
});
