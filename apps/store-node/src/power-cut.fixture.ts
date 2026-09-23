/**
 * SYN-05's power cut: one operation, run in a process of its own, killed at a
 * chosen I/O boundary.
 *
 * Every SQL statement, every PostgreSQL query and every chunk of paper passes
 * through `boundary`. It records the step and, when the step is the one the
 * test named, kills this process before that step is carried out. Between two
 * boundaries there is only memory, and a crash cannot leave memory half
 * written. So a test that dies once before each boundary has died at every
 * point that could leave anything behind — which is what "at any point during a
 * sale" has to mean for a claim that is proven rather than sampled.
 *
 * `SIGKILL` rather than an exception or an exit: nothing runs after it — no
 * `finally`, no rollback, no close — which is the one property a power cut
 * has that a thrown error does not. It does not take the page cache with it,
 * which a power cut does; that half is SQLite's `synchronous=FULL` and
 * PostgreSQL's `synchronous_commit`, and the test reads both back.
 *
 * Run by Node directly, from source, and never built into `dist`.
 */
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import pg from 'pg';
import { systemClock } from '@vertex/kernel';
import {
  createEventBus,
  createTransactor,
  receiveOperation,
  untilCommitted,
  type CommandContext,
  type MemorySession,
  type OperationEnvelope,
} from '@vertex/platform';
import { openPostgresStore, openSqliteStore, type PersistentStore } from '@vertex/storage';

// The built fixture, because Node runs this file without a compiler to map
// `./stock-fixture.js` onto its source. `pnpm verify` builds before it tests.
import {
  applyFixtureSaleDocument,
  parseFixtureSale,
  recordFixtureSale,
  type FixtureReceipt,
  type FixtureSalePayload,
} from '../dist/stock-fixture.js';

export type PowerCutPlan =
  | {
      readonly role: 'register';
      readonly crashAt: number;
      readonly path: string;
      readonly spool: string;
      readonly context: CommandContext;
      readonly sale: FixtureSalePayload;
    }
  | {
      readonly role: 'store-node';
      readonly crashAt: number;
      readonly connectionString: string;
      readonly schema: string;
      readonly context: CommandContext;
      readonly envelope: OperationEnvelope;
    };

/** One line of stdout per outcome; a killed process writes only the first kind. */
export type PowerCutReport =
  | { readonly crashedAt: string }
  | {
      readonly completed: true;
      readonly trace: readonly string[];
      readonly durability: Readonly<Record<string, string>>;
      readonly outcome: unknown;
    };

/** The receipt as paper: one chunk per line, each one on the device before the next begins. */
function receiptLines(receipt: FixtureReceipt): readonly string[] {
  return [
    `SALE ${receipt.sale} #${String(receipt.sequence)}`,
    ...receipt.lines.map((line) => `${line.item} ${line.delta}`),
    `END ${receipt.sale}`,
  ];
}

const plan = JSON.parse(process.env['VERTEX_POWER_CUT_PLAN'] ?? 'null') as PowerCutPlan | null;
if (plan === null) throw new Error('VERTEX_POWER_CUT_PLAN is required.');

const trace: string[] = [];
let armed = true;

function report(line: PowerCutReport): void {
  // Synchronous, so the line is in the pipe before the kill that follows it.
  writeSync(1, `${JSON.stringify(line)}\n`);
}

function boundary(step: string): void {
  if (!armed || plan === null) return;
  trace.push(step);
  if (trace.length === plan.crashAt) {
    report({ crashedAt: step });
    process.kill(process.pid, 'SIGKILL');
  }
}

/** Wraps one method of a driver class so every call first passes a boundary. */
function intercept(
  owner: object,
  method: string,
  step: (self: unknown, args: unknown[]) => string,
) {
  const original = Reflect.get(owner, method) as (...args: unknown[]) => unknown;
  Reflect.set(owner, method, function (this: unknown, ...args: unknown[]): unknown {
    boundary(step(this, args));
    return Reflect.apply(original, this, args);
  });
}

let database: DatabaseSync | null = null;
intercept(DatabaseSync.prototype, 'exec', (self, args) => {
  database = self as DatabaseSync;
  return `exec ${String(args[0])}`;
});
for (const method of ['run', 'get', 'all', 'iterate'])
  intercept(StatementSync.prototype, method, (self) => {
    const statement = self as StatementSync;
    return `${method} ${statement.sourceSQL}`;
  });
intercept(pg.Client.prototype, 'query', (_self, args) => {
  const query = args[0];
  const text = typeof query === 'object' && query !== null && 'text' in query ? query.text : query;
  // Each run gets a schema of its own; the step is the same one whatever it is called.
  const schema = plan.role === 'store-node' ? plan.schema : null;
  const step = String(text);
  return `query ${schema === null ? step : step.replaceAll(schema, '<schema>')}`;
});

const print = (receipt: FixtureReceipt): Promise<void> => {
  if (plan.role !== 'register') throw new Error('Only a register prints.');
  const device = openSync(plan.spool, 'a');
  try {
    for (const line of receiptLines(receipt)) {
      boundary('print');
      writeSync(device, `${line}\n`);
      fsyncSync(device);
    }
  } finally {
    closeSync(device);
  }
  return Promise.resolve();
};

function transactor(store: PersistentStore) {
  return createTransactor<MemorySession>({
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
 * What the live SQLite connection was actually set to, read from the connection
 * the store opened rather than from its source. A power cut, unlike a kill,
 * takes the page cache with it; only `synchronous=FULL` makes a committed WAL
 * frame survive that. The store node's half is in the trace itself: its commit
 * sets `synchronous_commit` on before it says COMMIT.
 */
function durability(): Record<string, string> {
  if (database === null) return {};
  const connection = database;
  const read = (pragma: string): string =>
    String(Object.values(connection.prepare(`PRAGMA ${pragma}`).get() ?? {})[0]);
  return { journal_mode: read('journal_mode'), synchronous: read('synchronous') };
}

let store: PersistentStore;
let outcome: unknown;
if (plan.role === 'register') {
  store = await openSqliteStore(plan.path);
  const sale = plan.sale;
  outcome = await untilCommitted(() =>
    transactor(store).run(plan.context, (uow) =>
      Promise.resolve(recordFixtureSale(uow, sale, print)),
    ),
  );
} else {
  store = await openPostgresStore({ connectionString: plan.connectionString, schema: plan.schema });
  const envelope = plan.envelope;
  const sale = parseFixtureSale(envelope.payload);
  outcome = await untilCommitted(() =>
    transactor(store).run(plan.context, (uow) =>
      receiveOperation(uow, envelope, () => {
        applyFixtureSaleDocument(uow, envelope, sale);
        return Promise.resolve();
      }),
    ),
  );
  // The acknowledgement a delivering register waits for. Dying here is the
  // lost reply: the server applied the sale and the register never heard.
  boundary('acknowledge');
}
armed = false;
report({ completed: true, trace, durability: durability(), outcome });
await store.close();
