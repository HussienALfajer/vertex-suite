import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { newId, systemClock } from '@vertex/kernel';
import {
  commandContext,
  createEventBus,
  createMemoryStore,
  createTransactor,
  deliverOutbox,
  operationMailboxMigrations,
  outboxEntries,
  receiveOperation,
  recordJournal,
  runMigrations,
  untilCommitted,
  type CommandContext,
  type MemorySession,
  type OperationEnvelope,
  type Receipt,
  type SessionDriver,
} from '@vertex/platform';
import { openPostgresStore, openSqliteStore, type PersistentStore } from '@vertex/storage';
import { afterEach, describe, expect, it } from 'vitest';

import type { PowerCutPlan, PowerCutReport } from './power-cut.fixture.js';
import {
  applyFixtureSaleDocument,
  fixtureMovements,
  fixtureQuantity,
  fixtureSale,
  IdentityConflictError,
  openFixtureStock,
  parseFixtureSale,
  recordFixtureSale,
  SALE_FIXTURE_KIND,
  stockFixtureMigrations,
  type FixtureReceipt,
  type FixtureSalePayload,
} from './stock-fixture.js';
import { composeStoreNode } from './store-node.js';

const database = process.env['VERTEX_TEST_POSTGRES_URL'];
if (process.env['CI'] && !database)
  throw new Error('CI must provide VERTEX_TEST_POSTGRES_URL for SYN-05 persistence tests.');

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function transactor(driver: SessionDriver<MemorySession>) {
  return createTransactor({
    driver,
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

const migrations = () => [
  ...operationMailboxMigrations<MemorySession>(),
  ...stockFixtureMigrations(),
];

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'vertex-syn05-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

/** A till: a migrated terminal store at a path that outlives any one process. */
async function till(path: string, context: CommandContext): Promise<PersistentStore> {
  const store = await openSqliteStore(path);
  await runMigrations({
    plan: migrations(),
    transactor: transactor(store.driver),
    context,
    journal: store.journal,
  });
  return store;
}

function saleOf(lines: number): FixtureSalePayload {
  const location = newId<'location'>();
  const deltas = ['-2', '-0.125', '-1', '-3.5'];
  return {
    sale: newId<'sale'>(),
    lines: Array.from({ length: lines }, (_, index) => ({
      movement: newId<'movement'>(),
      item: newId<'item'>(),
      location,
      delta: deltas[index % deltas.length] ?? '-1',
    })),
  };
}

function receiptOf(sale: FixtureSalePayload, device: string, sequence = 1): FixtureReceipt {
  return {
    sale: sale.sale,
    device,
    sequence,
    lines: sale.lines.map(({ item, delta }) => ({ item, delta })),
  };
}

/** Everything a sale could have left behind, read in a transaction of its own. */
async function remains(store: PersistentStore, context: CommandContext, sale: FixtureSalePayload) {
  return transactor(store.driver).run(context, (uow) =>
    Promise.resolve({
      document: fixtureSale(uow.session, context.tenant, sale.sale),
      movements: sale.lines.flatMap((line) =>
        fixtureMovements(uow.session, context.tenant, line.item, line.location).filter(
          (movement) => movement.movement === line.movement,
        ),
      ),
      outbox: outboxEntries(uow.session, context.tenant, context.device!).map(
        ({ envelope, acknowledged }) => ({
          kind: envelope.kind,
          sequence: envelope.sequence,
          payload: envelope.payload,
          acknowledged,
        }),
      ),
    }),
  );
}

const NOTHING = { document: undefined, movements: [], outbox: [] };

function everything(sale: FixtureSalePayload, context: CommandContext) {
  return {
    document: {
      ...sale,
      tenant: context.tenant,
      actor: context.actor,
      device: context.device,
      sequence: 1,
    },
    movements: sale.lines.map((line) => ({
      ...line,
      tenant: context.tenant,
      source: 'sale-fixture',
      actor: context.actor,
      device: context.device,
      sequence: 1,
    })),
    outbox: [{ kind: SALE_FIXTURE_KIND, sequence: 1, payload: sale, acknowledged: false }],
  };
}

async function printed(spool: string): Promise<string[]> {
  const text = await readFile(spool, 'utf8').catch((cause: unknown) => {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT')
      return '';
    throw cause;
  });
  return text.split('\n').filter((line) => line !== '');
}

/** Runs the power-cut fixture once and reads what it said before it stopped. */
function powerCut(
  plan: PowerCutPlan,
): Promise<PowerCutReport & { readonly exitCode: number | null }> {
  const fixture = fileURLToPath(new URL('./power-cut.fixture.ts', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fixture], {
      env: { ...process.env, VERTEX_POWER_CUT_PLAN: JSON.stringify(plan) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      const lines = stdout.split('\n').filter((line) => line !== '');
      if (lines.length !== 1) {
        reject(new Error(`The power-cut fixture said ${stdout || 'nothing'}: ${stderr}`));
        return;
      }
      resolve({ ...(JSON.parse(lines[0]!) as PowerCutReport), exitCode });
    });
  });
}

/**
 * The zero-based position of the COMMIT that makes the operation durable: the
 * one closing the last transaction to open with `opens`. Opening a store writes
 * its own tables first, and that transaction is not the sale.
 */
function commitOf(trace: readonly string[], opens: string, commit: string): number {
  const start = trace.lastIndexOf(opens);
  const end = trace.indexOf(commit, start);
  expect(start, trace.join('\n')).toBeGreaterThanOrEqual(0);
  expect(end, trace.join('\n')).toBeGreaterThan(start);
  return end;
}

describe('SYN-05 power-loss durability — the receipt waits for the sale', () => {
  it('SYN-05 prints the receipt only once the whole sale is committed, as another connection sees it', async () => {
    const path = join(await directory(), 'till.sqlite');
    const context = commandContext({
      tenant: newId<'tenant'>(),
      actor: newId<'user'>(),
      device: newId<'device'>(),
    });
    const store = await till(path, context);
    cleanup.push(() => store.close());
    // Another connection to the same file: what a process started after a
    // power cut would read. If the sale is there when the paper starts, the
    // receipt can never outlive it.
    const reader = await openSqliteStore(path);
    cleanup.push(() => reader.close());
    const sale = saleOf(3);
    const seen: unknown[] = [];
    const envelope = await transactor(store.driver).run(context, (uow) =>
      Promise.resolve(
        recordFixtureSale(uow, sale, async (receipt) => {
          seen.push({ receipt, stored: await remains(reader, context, sale) });
        }),
      ),
    );
    expect(envelope).toMatchObject({ kind: SALE_FIXTURE_KIND, sequence: 1, payload: sale });
    expect(seen).toEqual([
      { receipt: receiptOf(sale, context.device!), stored: everything(sale, context) },
    ]);
  });

  it('SYN-05 prints nothing and stores nothing for a sale interrupted after some of it was written', async () => {
    const context = commandContext({
      tenant: newId<'tenant'>(),
      actor: newId<'user'>(),
      device: newId<'device'>(),
    });
    const store = await till(join(await directory(), 'till.sqlite'), context);
    cleanup.push(() => store.close());
    const first = saleOf(1);
    const receipts: FixtureReceipt[] = [];
    const print = (receipt: FixtureReceipt) => {
      receipts.push(receipt);
      return Promise.resolve();
    };
    await transactor(store.driver).run(context, (uow) =>
      Promise.resolve(recordFixtureSale(uow, first, print)),
    );
    // The third line reuses the first sale's movement, so the command fails
    // after the document, two movements and the operation are all written.
    const second = saleOf(2);
    const clash = {
      ...second,
      lines: [...second.lines, { ...second.lines[0]!, movement: first.lines[0]!.movement }],
    };
    await expect(
      transactor(store.driver).run(context, (uow) =>
        Promise.resolve(recordFixtureSale(uow, clash, print)),
      ),
    ).rejects.toThrow(IdentityConflictError);
    // And a failure of the command's own, after every write, is no different.
    await expect(
      transactor(store.driver).run(context, (uow) => {
        recordFixtureSale(uow, second, print);
        return Promise.reject(new Error('the drawer jammed before the sale was confirmed'));
      }),
    ).rejects.toThrow('the drawer jammed');
    expect(receipts).toEqual([receiptOf(first, context.device!)]);
    expect(await remains(store, context, clash)).toEqual({
      ...NOTHING,
      outbox: [expect.objectContaining({ sequence: 1, payload: first })],
    });
  });

  it('SYN-05 prints once for a sale that lost a race and was rung again', async () => {
    const context = commandContext({
      tenant: newId<'tenant'>(),
      actor: newId<'user'>(),
      device: newId<'device'>(),
    });
    const store = await till(join(await directory(), 'till.sqlite'), context);
    cleanup.push(() => store.close());
    const sale = saleOf(2);
    const receipts: FixtureReceipt[] = [];
    let attempts = 0;
    await untilCommitted(() =>
      transactor(store.driver).run(context, async (uow) => {
        attempts += 1;
        const envelope = recordFixtureSale(uow, sale, (receipt) => {
          receipts.push(receipt);
          return Promise.resolve();
        });
        // The first attempt loses to a commit made while it ran; the store
        // refuses it at commit, and its receipt must go with it.
        if (attempts === 1)
          await transactor(store.driver).run(context, (other) => {
            other.session.put('syn05.fixture.elsewhere', attempts);
            return Promise.resolve();
          });
        return envelope;
      }),
    );
    expect(attempts).toBe(2);
    expect(receipts).toEqual([receiptOf(sale, context.device!)]);
    expect(await remains(store, context, sale)).toEqual(everything(sale, context));
  });

  it('SYN-05 refuses a sale the wire could make partial: no lines, too many, or one movement twice', () => {
    const sale = saleOf(2);
    const [line] = sale.lines;
    for (const candidate of [
      { ...sale, lines: [] },
      {
        ...sale,
        lines: Array.from({ length: 101 }, () => ({ ...line, movement: newId<'movement'>() })),
      },
      { ...sale, lines: [line, line] },
      { ...sale, lines: [{ ...line, delta: '2' }] },
      { ...sale, lines: [{ ...line, delta: -2 }] },
      { ...sale, lines: [{ ...line, price: '1' }] },
      { ...sale, total: '3' },
      { ...sale, sale: 'not-an-id' },
    ])
      expect(() => parseFixtureSale(candidate)).toThrow(TypeError);
    expect(parseFixtureSale(sale)).toEqual(sale);
  });
});

describe('SYN-05 power-loss durability — the till killed at every boundary', () => {
  it('SYN-05 leaves the whole sale or none at every SQL and print boundary, never a receipt without the sale, and rings again after', async () => {
    const context = commandContext({
      tenant: newId<'tenant'>(),
      actor: newId<'user'>(),
      device: newId<'device'>(),
    });
    const sale = saleOf(2);

    const run = async (crashAt: number) => {
      const root = await directory();
      const path = join(root, 'till.sqlite');
      await (await till(path, context)).close();
      const spool = join(root, 'printer.spool');
      const report = await powerCut({ role: 'register', crashAt, path, spool, context, sale });
      return { path, spool, report };
    };

    // Once with the power on, for the list of boundaries and the settings the
    // live connection runs with.
    const whole = await run(0);
    if (!('completed' in whole.report)) throw new Error('The uninterrupted sale did not complete.');
    const { trace, durability } = whole.report;
    expect(durability).toEqual({ journal_mode: 'wal', synchronous: '2' });
    const committed = commitOf(trace, 'exec BEGIN IMMEDIATE', 'exec COMMIT');
    const firstSheet = trace.indexOf('print');
    expect(firstSheet, 'the receipt starts only after the sale commits').toBeGreaterThan(committed);
    // A header, a sheet per line and a footer, each on the device before the next.
    const receipt = await printed(whole.spool);
    expect(receipt).toHaveLength(sale.lines.length + 2);
    expect(receipt[0]).toContain(sale.sale);
    expect(trace.filter((step) => step === 'print')).toHaveLength(receipt.length);

    const outcomes = new Set<string>();
    for (let crashAt = 1; crashAt <= trace.length; crashAt += 1) {
      const { path, spool, report } = await run(crashAt);
      const step = trace[crashAt - 1];
      expect(report, `killed before step ${String(crashAt)}: ${String(step)}`).toEqual({
        crashedAt: step,
        exitCode: report.exitCode,
      });
      const store = await openSqliteStore(path);
      try {
        const left = await remains(store, context, sale);
        const paperOut = await printed(spool);
        // Killed before the COMMIT ran, the sale is gone; killed after, it is
        // all there. There is no third state to find.
        if (crashAt - 1 <= committed) {
          expect(left, `killed before ${String(step)}`).toEqual(NOTHING);
          expect(paperOut).toEqual([]);
          outcomes.add('none');
        } else {
          expect(left, `killed before ${String(step)}`).toEqual(everything(sale, context));
          const sheets = trace.slice(0, crashAt - 1).filter((one) => one === 'print').length;
          expect(paperOut).toEqual(receipt.slice(0, sheets));
          outcomes.add(sheets === 0 ? 'stored, unprinted' : 'stored, part printed');
        }

        // The power comes back and the cashier rings the same sale: a till
        // that kept it refuses the second, one that lost it takes it now.
        const again: FixtureReceipt[] = [];
        const ring = transactor(store.driver).run(context, (uow) =>
          Promise.resolve(
            recordFixtureSale(uow, sale, (one) => {
              again.push(one);
              return Promise.resolve();
            }),
          ),
        );
        if (left.document === undefined) {
          await ring;
          expect(again).toEqual([receiptOf(sale, context.device!)]);
        } else {
          await expect(ring).rejects.toThrow(IdentityConflictError);
          expect(again).toEqual([]);
        }
        expect(await remains(store, context, sale)).toEqual(everything(sale, context));
      } finally {
        await store.close();
      }
    }
    expect([...outcomes].sort()).toEqual(['none', 'stored, part printed', 'stored, unprinted']);
  }, 180_000);
});

describe.skipIf(!database)(
  'SYN-05 power-loss durability — the store node killed at every boundary',
  () => {
    it('SYN-05 applies a delivered sale whole or not at all at every query, and a redelivery applies it once', async () => {
      if (!database) throw new Error('PostgreSQL is required.');
      const context = commandContext({
        tenant: newId<'tenant'>(),
        actor: newId<'user'>(),
        device: newId<'device'>(),
      });
      const sale = saleOf(3);
      // The operation exactly as a till would send it.
      const register = createMemoryStore();
      await runMigrations({
        plan: migrations(),
        transactor: transactor(register.driver),
        context,
        journal: recordJournal(),
      });
      const envelope: OperationEnvelope = await transactor(register.driver).run(context, (uow) =>
        Promise.resolve(recordFixtureSale(uow, sale, () => Promise.resolve())),
      );
      const by = commandContext({
        tenant: context.tenant,
        actor: context.actor,
        device: context.device,
        correlation: envelope.correlation,
      });

      const node = async () => {
        const schema = `vertex_syn05_${newId<'schema'>().replaceAll('-', '')}`;
        cleanup.push(async () => {
          const pool = new Pool({ connectionString: database });
          try {
            await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          } finally {
            await pool.end();
          }
        });
        const store = await openPostgresStore({ connectionString: database, schema });
        await runMigrations({
          plan: migrations(),
          transactor: transactor(store.driver),
          context: by,
          journal: store.journal,
        });
        await transactor(store.driver).run(by, (uow) => {
          for (const line of sale.lines)
            openFixtureStock(uow, {
              movement: newId<'movement'>(),
              item: line.item,
              location: line.location,
              quantity: '10',
            });
          return Promise.resolve();
        });
        await store.close();
        return schema;
      };
      const quantities = (store: PersistentStore) =>
        transactor(store.driver).run(by, (uow) =>
          Promise.resolve(
            sale.lines.map((line) =>
              fixtureQuantity(uow.session, by.tenant, line.item, line.location),
            ),
          ),
        );
      const after = ['8', '9.875', '9'];
      const before = ['10', '10', '10'];

      const run = async (crashAt: number) => {
        const schema = await node();
        const report = await powerCut({
          role: 'store-node',
          crashAt,
          connectionString: database,
          schema,
          context: by,
          envelope,
        });
        return { schema, report };
      };

      const whole = await run(0);
      if (!('completed' in whole.report))
        throw new Error('The uninterrupted apply did not complete.');
      const { trace } = whole.report;
      expect(whole.report.outcome).toEqual({ status: 'applied' });
      const committed = commitOf(trace, 'query SET LOCAL synchronous_commit = on', 'query COMMIT');
      expect(trace.at(-1)).toBe('acknowledge');

      const outcomes = new Set<string>();
      for (let crashAt = 1; crashAt <= trace.length; crashAt += 1) {
        const { schema, report } = await run(crashAt);
        const step = trace[crashAt - 1];
        expect(report, `killed before step ${String(crashAt)}: ${String(step)}`).toEqual({
          crashedAt: step,
          exitCode: report.exitCode,
        });
        const store = await openPostgresStore({ connectionString: database, schema });
        try {
          const stored = crashAt - 1 > committed;
          const read = () =>
            transactor(store.driver).run(by, (uow) =>
              Promise.resolve(fixtureSale(uow.session, by.tenant, sale.sale)),
            );
          expect(await read(), `killed before ${String(step)}`).toEqual(
            stored
              ? { ...sale, tenant: by.tenant, actor: by.actor, device: by.device, sequence: 1 }
              : undefined,
          );
          expect(await quantities(store)).toEqual(stored ? after : before);
          outcomes.add(stored ? 'applied, unacknowledged' : 'none');

          // The till never heard back, so it delivers again.
          const receipt: Receipt = await untilCommitted(() =>
            transactor(store.driver).run(by, (uow) =>
              receiveOperation(uow, envelope, () => {
                applyFixtureSaleDocument(uow, envelope, parseFixtureSale(envelope.payload));
                return Promise.resolve();
              }),
            ),
          );
          expect(receipt).toEqual({ status: stored ? 'duplicate' : 'applied' });
          expect(await quantities(store)).toEqual(after);
        } finally {
          await store.close();
        }
      }
      expect([...outcomes].sort()).toEqual(['applied, unacknowledged', 'none']);
    }, 300_000);
  },
);

describe.skipIf(!database)('SYN-05 power-loss durability — through the store node', () => {
  it('SYN-05 syncs a sale that survived a power cut once, and refuses a sale reaching past its branch', async () => {
    if (!database) throw new Error('PostgreSQL is required.');
    const root = await directory();
    const schema = `vertex_syn05_${newId<'schema'>().replaceAll('-', '')}`;
    const options = {
      connectionString: database,
      schema,
      attachmentsDirectory: join(root, 'attachments'),
      enableStockFixture: true,
    };
    cleanup.push(async () => {
      const pool = new Pool({ connectionString: database });
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    });
    const tenant = newId<'tenant'>();
    const node = await composeStoreNode(options);
    cleanup.push(() => node.close());
    await node.provisionTenant(tenant, 'owner', 'power-cut-1');
    const listener = await node.listen(0);
    cleanup.push(() => listener.close());
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address.');
    const post = (path: string, body: unknown, token = '', device = '') =>
      fetch(`http://127.0.0.1:${String(address.port)}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(device ? { 'x-vertex-device-token': device } : {}),
        },
        body: JSON.stringify(body),
      });
    const signIn = await post('/v1/sign-in', { tenant, handle: 'owner', password: 'power-cut-1' });
    const { token, authenticated } = (await signIn.json()) as {
      token: string;
      authenticated: { user: string };
    };
    const write = async (route: string, args: unknown[]) => {
      const response = await post(`/v1/tenants/${tenant}/${route}`, { args }, token);
      const result = (await response.json()) as { value: { ok: boolean; value: { id: string } } };
      expect(result.value.ok).toBe(true);
      return result.value.value.id;
    };
    const company = await write('companies.register', [{ name: 'Shop' }]);
    const branch = await write('branches.open', [{ company, name: 'Aleppo' }]);
    const floor = await write('locations.open', [{ branch, name: 'Floor', kind: 'shop-floor' }]);
    const elsewhere = await write('locations.open', [
      {
        branch: await write('branches.open', [{ company, name: 'Damascus' }]),
        name: 'Other floor',
        kind: 'shop-floor',
      },
    ]);
    const register = await write('registers.open', [{ branch, name: 'A', prefix: 'AA1' }]);
    const device = newId<'device'>();
    await write('registers.assignDevice', [register, device]);
    const pairing = await post(`/v1/tenants/${tenant}/devices.pair`, { register, device }, token);
    const { credential } = (await pairing.json()) as { credential: string };
    const context = commandContext({
      tenant,
      actor: authenticated.user as NonNullable<CommandContext['actor']>,
      device,
    });

    const sale = saleOf(2);
    const lines = sale.lines.map((line) => ({ ...line, location: floor }));
    const onFloor = { ...sale, lines };
    const server = await openPostgresStore({ connectionString: database, schema });
    cleanup.push(() => server.close());
    await transactor(server.driver).run(context, (uow) => {
      for (const line of lines)
        openFixtureStock(uow, {
          movement: newId<'movement'>(),
          item: line.item,
          location: floor,
          quantity: '10',
        });
      return Promise.resolve();
    });
    const shelf = () =>
      transactor(server.driver).run(context, (uow) =>
        Promise.resolve({
          document: fixtureSale(uow.session, tenant, onFloor.sale),
          quantities: lines.map((line) =>
            fixtureQuantity(uow.session, tenant, line.item, line.location),
          ),
        }),
      );

    // The till rings the sale and the power goes as the first line of the
    // receipt reaches the printer: stored, never printed, never sent.
    const path = join(root, 'till.sqlite');
    const spool = join(root, 'printer.spool');
    await (await till(path, context)).close();
    const probe = join(root, 'probe.sqlite');
    await (await till(probe, context)).close();
    const whole = await powerCut({
      role: 'register',
      crashAt: 0,
      path: probe,
      spool: join(root, 'probe.spool'),
      context,
      sale: onFloor,
    });
    if (!('completed' in whole)) throw new Error('The probe sale did not complete.');
    const crashed = await powerCut({
      role: 'register',
      crashAt: whole.trace.indexOf('print') + 1,
      path,
      spool,
      context,
      sale: onFloor,
    });
    expect(crashed).toMatchObject({ crashedAt: 'print' });
    expect(await printed(spool)).toEqual([]);

    const store = await openSqliteStore(path);
    cleanup.push(() => store.close());
    const [pending] = await transactor(store.driver).run(context, (uow) =>
      Promise.resolve(outboxEntries(uow.session, tenant, device)),
    );
    if (!pending) throw new Error('The stored sale has no operation to send.');
    const deliver = (envelope: unknown) =>
      post(`/v1/tenants/${tenant}/operations.deliver`, { register, envelope }, token, credential);

    // Before the real one: a sale whose second line reaches another branch's
    // floor, one that is malformed, and one naming stock the store never had.
    const reaching = {
      ...pending.envelope,
      payload: { ...onFloor, lines: [lines[0], { ...lines[1], location: elsewhere }] },
    };
    expect((await deliver(reaching)).status).toBe(403);
    expect(
      (await deliver({ ...pending.envelope, payload: { ...onFloor, lines: [] } })).status,
    ).toBe(400);
    expect(
      (
        await deliver({
          ...pending.envelope,
          payload: { ...onFloor, lines: [{ ...lines[0], item: newId<'item'>() }] },
        })
      ).status,
    ).toBe(400);
    expect(await shelf()).toEqual({ document: undefined, quantities: ['10', '10'] });

    expect(
      await deliverOutbox(
        transactor(store.driver),
        context,
        async (envelope) => (await (await deliver(envelope)).json()) as Receipt,
      ),
    ).toEqual({ acknowledged: 1, halted: null });
    expect(await shelf()).toEqual({
      document: { ...onFloor, tenant, actor: context.actor, device, sequence: 1 },
      quantities: ['8', '9.875'],
    });
    const replay = await deliver(pending.envelope);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ status: 'duplicate' });
    expect((await shelf()).quantities).toEqual(['8', '9.875']);
  }, 120_000);
});
