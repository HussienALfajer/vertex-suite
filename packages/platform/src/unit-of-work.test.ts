import { newId, systemClock } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import { commandContext } from './context.js';
import { createEventBus, eventType, type DomainEvent, type HandlerFailure } from './events.js';
import {
  createMemoryStore,
  createTransactor,
  type EffectFailure,
  type MemorySession,
  type SessionDriver,
} from './unit-of-work.js';

const SaleRecorded = eventType<{ total: string }>('pos.sale-recorded');

function harness(driver?: SessionDriver<MemorySession>) {
  const store = createMemoryStore();
  const log: string[] = [];
  const handlerFailures: HandlerFailure[] = [];
  const effectFailures: EffectFailure[] = [];
  const delivered: DomainEvent[] = [];

  const bus = createEventBus({
    onHandlerFailure: (failure) => handlerFailures.push(failure),
  });
  bus.subscribe(SaleRecorded.name, 'FIN', (event) => {
    log.push('subscriber');
    delivered.push(event);
    return Promise.resolve();
  });

  const transactor = createTransactor({
    driver: driver ?? store.driver,
    bus,
    clock: systemClock,
    onEffectFailure: (failure) => effectFailures.push(failure),
  });

  return { store, bus, transactor, log, delivered, handlerFailures, effectFailures };
}

const context = commandContext({ tenant: newId<'tenant'>(), actor: newId<'user'>() });

describe('a command that succeeds', () => {
  it('commits its writes and then delivers its events', async () => {
    const { store, transactor, log, delivered } = harness();

    await transactor.run(context, (uow) => {
      uow.session.put('sale:1', { total: '1500' });
      uow.publish(SaleRecorded, { total: '1500' });
      // Nothing has been delivered yet, and nothing can be: the transaction is
      // still open, and a subscriber acting now would be acting on a sale that
      // may never exist.
      expect(log).toEqual([]);
      return Promise.resolve();
    });

    expect(store.committed().get('sale:1')).toEqual({ total: '1500' });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.payload).toEqual({ total: '1500' });
  });

  it('stamps every event with the command that produced it', async () => {
    const { transactor, delivered } = harness();

    await transactor.run(context, (uow) => {
      uow.publish(SaleRecorded, { total: '1' });
      uow.publish(SaleRecorded, { total: '2' });
      return Promise.resolve();
    });

    expect(delivered.map((event) => event.context.correlation)).toEqual([
      context.correlation,
      context.correlation,
    ]);
    expect(delivered[0]?.context.actor).toBe(context.actor);
    // Two events of one command still have two identities, and they sort in the
    // order they were published.
    expect(delivered[0]?.id).not.toBe(delivered[1]?.id);
    expect(delivered[0]!.id < delivered[1]!.id).toBe(true);
  });

  it('runs its own effects before the subscribers of other modules', async () => {
    // The cashier is waiting for the receipt. The ledger is not waiting for
    // anything, and both are already safe, because both are after the commit.
    const { transactor, log } = harness();

    await transactor.run(context, (uow) => {
      uow.afterCommit(() => {
        log.push('receipt');
      });
      uow.publish(SaleRecorded, { total: '1' });
      return Promise.resolve();
    });

    expect(log).toEqual(['receipt', 'subscriber']);
  });
});

describe('a command that fails', () => {
  it('leaves nothing behind and delivers nothing', async () => {
    const { store, transactor, log } = harness();

    await expect(
      transactor.run(context, (uow) => {
        uow.session.put('sale:2', { total: '900' });
        uow.publish(SaleRecorded, { total: '900' });
        uow.afterCommit(() => {
          log.push('receipt');
        });
        throw new Error('the item is not in the catalogue');
      }),
    ).rejects.toThrow('the item is not in the catalogue');

    expect(store.committed().size).toBe(0);
    expect(log).toEqual([]);
  });

  it('runs the compensations for what the store never knew about', async () => {
    const { transactor, log } = harness();

    await expect(
      transactor.run(context, (uow) => {
        uow.onRollback(() => {
          log.push('drawer closed again');
        });
        return Promise.reject(new Error('no'));
      }),
    ).rejects.toThrow('no');

    expect(log).toEqual(['drawer closed again']);
  });

  it('compensates and gives up when the commit itself fails', async () => {
    const store = createMemoryStore();
    const failing: SessionDriver<MemorySession> = {
      begin: store.driver.begin.bind(store.driver),
      commit: () => Promise.reject(new Error('the disk is full')),
      rollback: store.driver.rollback.bind(store.driver),
    };
    const { transactor, log } = harness(failing);

    await expect(
      transactor.run(context, (uow) => {
        uow.onRollback(() => {
          log.push('compensated');
        });
        uow.afterCommit(() => {
          log.push('receipt');
        });
        uow.publish(SaleRecorded, { total: '1' });
        return Promise.resolve();
      }),
    ).rejects.toThrow('the disk is full');

    // No receipt, no event, and the compensation ran. SYN-05 in one line.
    expect(log).toEqual(['compensated']);
  });
});

describe('failures after the commit', () => {
  it('reports an effect that failed without failing the command', async () => {
    const { transactor, effectFailures, log } = harness();

    await transactor.run(context, (uow) => {
      uow.afterCommit(() => {
        throw new Error('the printer is out of paper');
      });
      uow.afterCommit(() => {
        log.push('drawer opened');
      });
      return Promise.resolve();
    });

    // The sale is committed; the printer is a separate problem, and the drawer
    // still opens.
    expect(effectFailures).toHaveLength(1);
    expect(effectFailures[0]?.phase).toBe('after-commit');
    expect(log).toEqual(['drawer opened']);
  });

  it('tells every other subscriber even when one of them fails', async () => {
    const { bus, transactor, handlerFailures, log } = harness();
    bus.subscribe(SaleRecorded.name, 'STK', () => Promise.reject(new Error('locked')));
    bus.subscribe(SaleRecorded.name, 'RPT', () => {
      log.push('read model');
      return Promise.resolve();
    });

    await transactor.run(context, (uow) => {
      uow.publish(SaleRecorded, { total: '1' });
      return Promise.resolve();
    });

    expect(log).toEqual(['subscriber', 'read model']);
    expect(handlerFailures).toHaveLength(1);
    expect(handlerFailures[0]?.subscriber).toBe('STK');
  });
});

describe('the memory store', () => {
  it('keeps one transaction out of another until it commits', async () => {
    const { store, transactor } = harness();

    await transactor.run(context, (uow) => {
      uow.session.put('a', 1);
      return Promise.resolve();
    });

    await transactor.run(context, (uow) => {
      uow.session.put('b', 2);
      expect(uow.session.get('a')).toBe(1);
      expect(store.committed().has('b')).toBe(false);
      return Promise.resolve();
    });

    expect([...store.committed().keys()]).toEqual(['a', 'b']);
  });

  it('removes within a transaction, and only on commit', async () => {
    const { store, transactor } = harness();

    await transactor.run(context, (uow) => {
      uow.session.put('a', 1);
      return Promise.resolve();
    });

    await expect(
      transactor.run(context, (uow) => {
        uow.session.remove('a');
        expect(uow.session.get('a')).toBeUndefined();
        expect(uow.session.keys()).toEqual([]);
        throw new Error('changed my mind');
      }),
    ).rejects.toThrow('changed my mind');

    expect(store.committed().get('a')).toBe(1);
  });
});
