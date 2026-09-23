import { instant, manualClock, newId, timeOf } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import { commandContext, type CommandContext } from './context.js';
import { backoffDelay, createCourier, type Reach, type StoreLink, type Timer } from './courier.js';
import { createEventBus } from './events.js';
import {
  deliverOutbox,
  escalateOperation,
  operationMailboxMigrations,
  outboxEntries,
  stageOperation,
  type DeliveryAnswer,
  type OperationEnvelope,
} from './mailboxes.js';
import { recordJournal, runMigrations } from './migrations.js';
import {
  createMemoryStore,
  createTransactor,
  type MemorySession,
  type Transactor,
} from './unit-of-work.js';

const START = instant(Date.UTC(2026, 8, 23, 9, 0));
const BACKOFF = { first: 1_000, ceiling: 8_000 };
const HEARTBEAT = 15_000;

/** A timer the test fires by hand: what is waiting, and for how long, is a fact it can state. */
function handTimer() {
  const waiting: { delay: number; run: () => Promise<void>; cancelled: boolean }[] = [];
  const timer: Timer = {
    after(delay, run) {
      const one = { delay, run, cancelled: false };
      waiting.push(one);
      return () => {
        one.cancelled = true;
      };
    },
  };
  return {
    timer,
    /** The one wait still armed, or null. */
    armed(): number | null {
      const live = waiting.filter((one) => !one.cancelled);
      expect(live.length).toBeLessThanOrEqual(1);
      return live[0]?.delay ?? null;
    },
    /** Runs what is waiting, and resolves when the attempt it began has finished. */
    fire(): Promise<void> {
      const live = waiting.filter((one) => !one.cancelled);
      const next = live[0];
      if (next === undefined) throw new Error('Nothing is waiting.');
      next.cancelled = true;
      return next.run();
    },
  };
}

/**
 * A store node the test answers for: every delivery and every question asked
 * of it is written down, and what it says next is set by the test.
 */
function scriptedLink() {
  const delivered: OperationEnvelope[] = [];
  let reach: Reach = 'reachable';
  let answer: (envelope: OperationEnvelope) => DeliveryAnswer | Promise<DeliveryAnswer> = () => ({
    status: 'applied',
  });
  let asked = 0;
  const link: StoreLink = {
    deliver(envelope) {
      delivered.push(envelope);
      return Promise.resolve(answer(envelope));
    },
    reach() {
      asked += 1;
      return Promise.resolve(reach);
    },
  };
  return {
    link,
    delivered,
    asked: () => asked,
    offline() {
      reach = 'unreachable';
      answer = () => ({ status: 'unreachable' });
    },
    online() {
      reach = 'reachable';
      answer = () => ({ status: 'applied' });
    },
    answer(next: typeof answer) {
      answer = next;
    },
    reach(next: Reach) {
      reach = next;
    },
  };
}

async function register() {
  const store = createMemoryStore();
  const clock = manualClock(START);
  const transactor = createTransactor({
    driver: store.driver,
    bus: createEventBus({
      onHandlerFailure: (failure) => {
        throw failure.cause;
      },
    }),
    clock,
    onEffectFailure: (failure) => {
      throw failure.cause;
    },
  });
  const context = commandContext({
    tenant: newId<'tenant'>(),
    actor: newId<'user'>(),
    device: newId<'device'>(),
  });
  await runMigrations({
    plan: operationMailboxMigrations<MemorySession>(),
    transactor,
    context,
    journal: recordJournal(),
  });
  const faults: unknown[] = [];
  const hand = handTimer();
  const node = scriptedLink();
  // The next transaction the courier runs reads at once and answers late, when
  // the test says so: a read overtaken by everything that happens meanwhile.
  let late: Promise<void> | null = null;
  const holdNextRead = (): (() => void) => {
    let release: () => void = () => undefined;
    late = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  };
  const courierTransactor: Transactor<MemorySession> = {
    async run(by, work) {
      const wait = late;
      late = null;
      const result = await transactor.run(by, work);
      if (wait !== null) await wait;
      return result;
    },
  };
  const courier = (by: CommandContext = context) =>
    createCourier({
      transactor: courierTransactor,
      context: by,
      link: node.link,
      clock,
      backoff: BACKOFF,
      heartbeat: HEARTBEAT,
      timer: hand.timer,
      onFault: (cause) => faults.push(cause),
    });
  const sell = (amount: string) =>
    transactor.run(context, (uow) => {
      uow.session.put(`till.sale.${amount}`, { amount });
      return Promise.resolve(stageOperation(uow, 'test.sale', { amount }));
    });
  const entries = () =>
    transactor.run(context, (uow) =>
      Promise.resolve(outboxEntries(uow.session, context.tenant, context.device!)),
    );
  return {
    store,
    clock,
    transactor,
    context,
    faults,
    hand,
    node,
    courier,
    sell,
    entries,
    holdNextRead,
  };
}

describe('backoff — SYN-06', () => {
  const device = newId<'device'>();

  it('SYN-06 doubles from the first step to the ceiling, and stays there', () => {
    const steps = [1_000, 2_000, 4_000, 8_000, 8_000, 8_000];
    steps.forEach((step, index) => {
      const delay = backoffDelay(BACKOFF, index + 1, device);
      // The first half of each step is always waited; the device decides how
      // much of the second.
      expect(delay).toBeGreaterThanOrEqual(step / 2);
      expect(delay).toBeLessThan(step);
    });
    expect(backoffDelay(BACKOFF, 10_000, device)).toBe(backoffDelay(BACKOFF, 4, device));
  });

  it('SYN-06 spreads registers apart, so a shop does not come back in one burst', () => {
    // Every till loses the store node at the same moment when it restarts.
    // If they all waited the same, they would all knock together, doubling in step.
    const delays = new Set(
      Array.from({ length: 12 }, () => backoffDelay(BACKOFF, 3, newId<'device'>())),
    );
    expect(delays.size).toBeGreaterThan(6);
    // And the same register always waits the same: the spread is a property
    // of the device, which is what makes it something a test can state.
    expect(backoffDelay(BACKOFF, 3, device)).toBe(backoffDelay(BACKOFF, 3, device));
  });
});

describe('Courier — SYN-06 visible sync state', () => {
  it('SYN-06 says nothing about the connection until the store node has answered', async () => {
    const shop = await register();
    const courier = shop.courier();
    expect(courier.status()).toEqual({
      connection: 'unknown',
      queue: [],
      lastContact: null,
      nextAttempt: null,
    });
    await courier.start();
    expect(courier.status()).toEqual({
      connection: 'online',
      queue: [],
      lastContact: START,
      nextAttempt: null,
    });
    // Idle, it keeps asking, so that "online" stays true rather than stays said.
    expect(shop.hand.armed()).toBe(HEARTBEAT);
    shop.node.offline();
    shop.clock.advance(HEARTBEAT);
    await shop.hand.fire();
    expect(courier.status().connection).toBe('offline');
    expect(courier.status().lastContact).toBe(START);
  });

  it('SYN-06 lists what is waiting while offline, and does not knock with every sale', async () => {
    const shop = await register();
    const courier = shop.courier();
    shop.node.offline();
    await courier.start();
    const wait = shop.hand.armed();
    expect(wait).toBe(backoffDelay(BACKOFF, 1, shop.context.device!));
    expect(courier.status()).toMatchObject({
      connection: 'offline',
      queue: [],
      lastContact: null,
      nextAttempt: START + wait!,
    });

    const first = await shop.sell('10.00');
    await courier.nudge();
    const second = await shop.sell('2.50');
    await courier.nudge();
    expect(courier.status().queue).toEqual([
      { key: first.key, sequence: 1, kind: 'test.sale', stagedAt: timeOf(first.key) },
      { key: second.key, sequence: 2, kind: 'test.sale', stagedAt: timeOf(second.key) },
    ]);
    // The courier is waiting out its backoff; a sale refreshes the list and
    // asks nothing of a store node it already knows is not there.
    expect(shop.node.delivered).toEqual([]);
    expect(shop.hand.armed()).toBe(wait);
  });

  it('SYN-06 recovers on its own when the store node returns, and delivers in order', async () => {
    const shop = await register();
    const courier = shop.courier();
    shop.node.offline();
    await courier.start();
    const first = await shop.sell('10.00');
    const second = await shop.sell('2.50');
    await courier.nudge();

    // Still gone at the first retry: the wait doubles.
    await shop.hand.fire();
    expect(shop.hand.armed()).toBe(backoffDelay(BACKOFF, 2, shop.context.device!));

    shop.node.online();
    shop.clock.advance(5_000);
    await shop.hand.fire();
    // The retry that found the line still down offered only the head; the one
    // that found it up delivered both, in the order they were staged.
    expect(shop.node.delivered.map((one) => one.key)).toEqual([first.key, first.key, second.key]);
    expect(courier.status()).toEqual({
      connection: 'online',
      queue: [],
      lastContact: START + 5_000,
      nextAttempt: null,
    });
    expect((await shop.entries()).every((entry) => entry.acknowledged)).toBe(true);
    // Recovered is a fresh start: the next failure waits the first step again.
    expect(shop.hand.armed()).toBe(HEARTBEAT);
    shop.node.offline();
    await shop.hand.fire();
    expect(shop.hand.armed()).toBe(backoffDelay(BACKOFF, 1, shop.context.device!));
  });

  it('SYN-06 delivers a sale as soon as it is staged when the line is up', async () => {
    const shop = await register();
    const courier = shop.courier();
    await courier.start();
    const sale = await shop.sell('7.25');
    await courier.nudge();
    expect(shop.node.delivered.map((one) => one.key)).toEqual([sale.key]);
    expect(courier.status().queue).toEqual([]);
  });

  it('SYN-06 tells a session the store node no longer knows from a line that is down', async () => {
    const shop = await register();
    const courier = shop.courier();
    await shop.sell('1.00');
    shop.node.answer(() => ({ status: 'unauthenticated' }));
    shop.clock.advance(60_000);
    await courier.start();
    expect(courier.status()).toMatchObject({
      connection: 'signed-out',
      lastContact: START + 60_000,
    });
    expect(courier.status().queue).toHaveLength(1);
    // Nothing was wrong with the sale, so nothing is written against it.
    expect((await shop.entries())[0]).not.toHaveProperty('failure');
  });

  it('SYN-06 keeps the status object while nothing in it changes', async () => {
    const shop = await register();
    const courier = shop.courier();
    let told = 0;
    courier.subscribe(() => (told += 1));
    await courier.start();
    const seen = courier.status();
    expect(told).toBe(1);
    await courier.nudge();
    await shop.hand.fire();
    // A screen reading this re-renders on a new object, and only then.
    expect(courier.status()).toBe(seen);
    expect(told).toBe(1);
  });
});

describe('Courier — SYN-06 failed operations and escalation', () => {
  it('SYN-06 records why the store node declined an operation, and holds the queue behind it', async () => {
    const shop = await register();
    const courier = shop.courier();
    const first = await shop.sell('10.00');
    const second = await shop.sell('2.50');
    shop.node.answer((envelope) =>
      envelope.key === first.key
        ? { status: 'refused', reason: 'forbidden' }
        : { status: 'applied' },
    );
    await courier.start();

    // Only the head was offered: anything past it would be a gap at the store node.
    expect(shop.node.delivered.map((one) => one.key)).toEqual([first.key]);
    const failure = { reason: 'forbidden', since: START, latest: START, attempts: 1 };
    expect(courier.status()).toMatchObject({
      connection: 'online',
      lastContact: START,
      queue: [
        { key: first.key, failure },
        { key: second.key, sequence: 2 },
      ],
    });
    expect(courier.status().queue[1]).not.toHaveProperty('failure');
    expect((await shop.entries())[0]).toEqual({ envelope: first, acknowledged: false, failure });

    // Declined again, later: counted, and still dated from the first time.
    shop.clock.advance(2_000);
    await shop.hand.fire();
    expect(courier.status().queue[0]?.failure).toEqual({
      reason: 'forbidden',
      since: START,
      latest: START + 2_000,
      attempts: 2,
    });
  });

  it('SYN-06 records the sequence a store node expected when it reports a gap', async () => {
    const shop = await register();
    await shop.sell('1.00');
    const progress = await deliverOutbox(shop.transactor, shop.context, () =>
      Promise.resolve({ status: 'sequence-gap', expected: 7 }),
    );
    expect(progress).toEqual({ acknowledged: 0, halted: { status: 'sequence-gap', expected: 7 } });
    expect((await shop.entries())[0]?.failure).toEqual({
      reason: 'sequence-gap',
      expected: 7,
      since: START,
      latest: START,
      attempts: 1,
    });
  });

  it('SYN-06 escalates a failed operation once, and only a failed one', async () => {
    const shop = await register();
    const courier = shop.courier();
    const first = await shop.sell('10.00');
    const second = await shop.sell('2.50');
    shop.node.answer((envelope) =>
      envelope.key === first.key ? { status: 'conflict' } : { status: 'applied' },
    );
    await courier.start();

    // Waiting for its turn is not a failure; there is nothing for anyone to look at.
    const waiting = await courier.escalate(second.key);
    expect(waiting).toEqual({
      ok: false,
      error: { code: 'syn.operation-not-failed', values: {} },
    });

    shop.clock.advance(30_000);
    const escalated = await courier.escalate(first.key);
    const escalation = { by: shop.context.actor, at: START + 30_000 };
    expect(escalated).toMatchObject({ ok: true, value: { key: first.key, escalation } });
    expect(courier.status().queue[0]).toMatchObject({ escalation });

    // A second press is not a second report: the first one stands.
    shop.clock.advance(1_000);
    await courier.escalate(first.key);
    expect(courier.status().queue[0]?.escalation).toEqual(escalation);

    // Resolved at the store node, and retried by a person: applied, the
    // failure gone, the record that somebody was asked kept.
    shop.node.online();
    await courier.retry();
    expect(courier.status().queue).toEqual([]);
    expect(await shop.entries()).toEqual([
      { envelope: first, acknowledged: true, escalation },
      { envelope: second, acknowledged: true },
    ]);
    expect(await courier.escalate(first.key)).toMatchObject({ ok: false });
  });

  it('SYN-06 refuses to escalate on behalf of nobody, or an operation this register never staged', async () => {
    const shop = await register();
    const system = commandContext({ tenant: shop.context.tenant, actor: null });
    await expect(
      shop.transactor.run(system, (uow) =>
        Promise.resolve(escalateOperation(uow, newId<'operation'>())),
      ),
    ).rejects.toThrow('Only a person at a register');
    await expect(
      shop.transactor.run(shop.context, (uow) =>
        Promise.resolve(escalateOperation(uow, newId<'operation'>())),
      ),
    ).rejects.toThrow('No such outgoing operation');
  });

  it('SYN-06 shows a restarted register what is holding its queue before asking anything', async () => {
    const shop = await register();
    const before = shop.courier();
    const sale = await shop.sell('10.00');
    shop.node.answer(() => ({ status: 'refused', reason: 'unsupported' }));
    await before.start();
    await before.escalate(sale.key);
    await before.stop();

    // The next courier over the same store: the store node takes a long time
    // to answer, and the failure is on screen while it does.
    let answer: (value: DeliveryAnswer) => void = () => undefined;
    shop.node.answer(
      () =>
        new Promise<DeliveryAnswer>((resolve) => {
          answer = resolve;
        }),
    );
    const after = shop.courier();
    const started = after.start();
    await expect.poll(() => shop.node.delivered.length).toBe(2);
    expect(after.status().queue).toMatchObject([
      { key: sale.key, failure: { reason: 'unsupported' }, escalation: { by: shop.context.actor } },
    ]);
    answer({ status: 'applied' });
    await started;
    expect(after.status().queue).toEqual([]);
  });

  it('SYN-06 retries now when a person asks, and starts the backoff over', async () => {
    const shop = await register();
    const courier = shop.courier();
    shop.node.offline();
    await courier.start();
    await shop.hand.fire();
    await shop.hand.fire();
    expect(shop.hand.armed()).toBe(backoffDelay(BACKOFF, 3, shop.context.device!));

    await courier.retry();
    expect(shop.hand.armed()).toBe(backoffDelay(BACKOFF, 1, shop.context.device!));
    shop.node.online();
    await courier.retry();
    expect(courier.status().connection).toBe('online');
    expect(shop.hand.armed()).toBe(HEARTBEAT);
  });
});

describe('Courier — SYN-06 its own ordering', () => {
  it('SYN-06 never puts back a queue that an attempt has since delivered', async () => {
    const shop = await register();
    const courier = shop.courier();
    await shop.sell('1.00');
    shop.node.answer(() => ({ status: 'refused', reason: 'forbidden' }));
    await courier.start();

    // A sale while the courier waits out the refusal: the list is refreshed,
    // and that read answers only after the next attempt has delivered it all.
    await shop.sell('2.00');
    const release = shop.holdNextRead();
    const refreshing = courier.nudge();
    shop.node.online();
    await shop.hand.fire();
    expect(courier.status().queue).toEqual([]);
    release();
    await refreshing;
    expect(courier.status().queue).toEqual([]);
    expect(courier.status().connection).toBe('online');
  });

  it('SYN-06 makes one first attempt, however soon a sale follows the start', async () => {
    const shop = await register();
    const courier = shop.courier();
    const started = courier.start();
    const nudged = courier.nudge();
    const again = courier.start();
    await Promise.all([started, nudged, again]);
    expect(shop.node.asked()).toBe(1);
    // A second start is the first one: it resolves when that attempt has.
    expect(again).toBe(started);
  });

  it('SYN-06 delivers the first sale after a new sign-in, without waiting out the backoff', async () => {
    const shop = await register();
    const courier = shop.courier();
    await shop.sell('1.00');
    shop.node.answer(() => ({ status: 'unauthenticated' }));
    await courier.start();
    expect(courier.status().connection).toBe('signed-out');

    // Signed in again. The store node was there all along and answers at once,
    // so the next sale is worth an attempt rather than another wait.
    shop.node.online();
    await shop.sell('2.00');
    await courier.nudge();
    expect(courier.status()).toMatchObject({ connection: 'online', queue: [] });
  });
});

describe('Courier — SYN-06 its own failures', () => {
  it('SYN-06 reports a link that throws, waits, and keeps delivering', async () => {
    const shop = await register();
    const courier = shop.courier();
    await courier.start();
    const sale = await shop.sell('3.00');
    const broken = new Error('socket exploded');
    shop.node.answer(() => {
      throw broken;
    });
    await courier.nudge();
    expect(shop.faults).toEqual([broken]);
    // A defect is not a verdict on the line: what was last known stands.
    expect(courier.status()).toMatchObject({ connection: 'online', queue: [{ key: sale.key }] });
    expect((await shop.entries())[0]).not.toHaveProperty('failure');
    expect(shop.hand.armed()).toBe(backoffDelay(BACKOFF, 1, shop.context.device!));

    shop.node.online();
    await shop.hand.fire();
    expect(courier.status().queue).toEqual([]);
  });

  it('SYN-06 never delivers one operation twice at once, however often it is asked', async () => {
    const shop = await register();
    const courier = shop.courier();
    await courier.start();
    let inFlight = 0;
    let most = 0;
    shop.node.answer(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { status: 'applied' };
    });
    const sales = [await shop.sell('1.00'), await shop.sell('2.00'), await shop.sell('3.00')];
    await Promise.all([courier.nudge(), courier.retry(), courier.nudge(), courier.retry()]);
    expect(most).toBe(1);
    expect(shop.node.delivered.map((one) => one.key)).toEqual(sales.map((one) => one.key));
    expect(courier.status().queue).toEqual([]);
  });

  it('SYN-06 delivers nothing once stopped', async () => {
    const shop = await register();
    const courier = shop.courier();
    await courier.start();
    await courier.stop();
    expect(shop.hand.armed()).toBeNull();
    await shop.sell('1.00');
    await courier.nudge();
    await courier.retry();
    expect(shop.node.delivered).toEqual([]);
    expect(courier.status().queue).toEqual([]);
    await expect(courier.start()).rejects.toThrow('does not start again');
  });

  it('refuses a courier with nobody signed in at a register, or a schedule that makes no sense', async () => {
    const shop = await register();
    expect(() =>
      shop.courier(commandContext({ tenant: shop.context.tenant, actor: shop.context.actor })),
    ).toThrow('signed in at a register');
    for (const backoff of [
      { first: 0, ceiling: 10 },
      { first: 10, ceiling: 5 },
      { first: 1.5, ceiling: 10 },
    ])
      expect(() =>
        createCourier({
          transactor: shop.transactor,
          context: shop.context,
          link: shop.node.link,
          clock: shop.clock,
          backoff,
          onFault: () => undefined,
        }),
      ).toThrow(RangeError);
  });
});
