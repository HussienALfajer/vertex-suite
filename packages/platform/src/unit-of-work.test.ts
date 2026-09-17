import { newId, systemClock } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import { commandContext } from './context.js';
import { SerialisationConflictError } from './errors.js';
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

  it('keeps the command’s own error, and still compensates, when the rollback fails too', async () => {
    // The connection is gone: the work failed on it, and so does the rollback.
    // The caller needs to hear why the command failed, and the drawer that was
    // opened still has to be closed.
    const store = createMemoryStore();
    const failing: SessionDriver<MemorySession> = {
      begin: store.driver.begin.bind(store.driver),
      commit: store.driver.commit.bind(store.driver),
      rollback: () => Promise.reject(new Error('connection already closed')),
    };
    const { transactor, log, effectFailures } = harness(failing);

    await expect(
      transactor.run(context, (uow) => {
        uow.onRollback(() => {
          log.push('compensated');
        });
        return Promise.reject(new Error('the credit limit query failed'));
      }),
    ).rejects.toThrow('the credit limit query failed');

    expect(log).toEqual(['compensated']);
    expect(effectFailures.map((one) => one.phase)).toEqual(['rollback']);
    expect(String(effectFailures[0]?.cause)).toContain('connection already closed');
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

  it('runs every effect and delivers every event even when the host’s sinks throw', async () => {
    // A host that makes failures loud — development does — may not thereby
    // decide which effects run or which subscribers hear of a committed fact.
    const store = createMemoryStore();
    const log: string[] = [];
    const bus = createEventBus({
      onHandlerFailure: () => {
        throw new Error('loud handler sink');
      },
    });
    bus.subscribe(SaleRecorded.name, 'STK', () => Promise.reject(new Error('locked')));
    bus.subscribe(SaleRecorded.name, 'RPT', () => {
      log.push('read model');
      return Promise.resolve();
    });
    const transactor = createTransactor({
      driver: store.driver,
      bus,
      clock: systemClock,
      onEffectFailure: () => {
        throw new Error('loud effect sink');
      },
    });

    const outcome = transactor.run(context, (uow) => {
      uow.session.put('sale:1', { total: '1' });
      uow.afterCommit(() => {
        throw new Error('the printer is out of paper');
      });
      uow.afterCommit(() => {
        log.push('drawer opened');
      });
      uow.publish(SaleRecorded, { total: '1' });
      return Promise.resolve();
    });

    // Loud, as the host asked — both sinks, and only after everything happened.
    await expect(outcome).rejects.toThrow('The failure sink raised more than once.');
    expect(store.committed().has('sale:1')).toBe(true);
    expect(log).toEqual(['drawer opened', 'read model']);
  });
});

describe('a unit of work that has ended', () => {
  it('refuses to publish, defer or compensate once its command has finished', async () => {
    // An event published from an after-commit effect used to be delivered as if
    // the transaction had produced it, and one published later simply vanished.
    const { transactor, delivered } = harness();
    let kept: Parameters<Parameters<typeof transactor.run>[1]>[0] | undefined;
    const inEffect: unknown[] = [];

    await transactor.run(context, (uow) => {
      kept = uow;
      uow.afterCommit(() => {
        try {
          uow.publish(SaleRecorded, { total: 'late' });
        } catch (refusal) {
          inEffect.push(refusal);
        }
      });
      return Promise.resolve();
    });

    expect(inEffect).toHaveLength(1);
    expect(delivered).toEqual([]);
    expect(() => kept?.publish(SaleRecorded, { total: 'later' })).toThrow(/has finished/u);
    expect(() => {
      kept?.afterCommit(() => undefined);
    }).toThrow(/has finished/u);
    expect(() => {
      kept?.onRollback(() => undefined);
    }).toThrow(/has finished/u);
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

  it('refuses to commit a decision taken on what another command changed meanwhile', async () => {
    // The shape of every read-then-write invariant a module keeps: two
    // commands each read the counter, each write the next number, and both
    // print 000001 — unless the second to commit is refused.
    const { store, transactor } = harness();
    await transactor.run(context, (uow) => {
      uow.session.put('counter', 1);
      return Promise.resolve();
    });

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = transactor.run(context, async (uow) => {
      const next = uow.session.get('counter') as number;
      await held;
      uow.session.put('counter', next + 1);
      uow.session.put('issued:slow', next);
    });
    await transactor.run(context, (uow) => {
      const next = uow.session.get('counter') as number;
      uow.session.put('counter', next + 1);
      uow.session.put('issued:quick', next);
      return Promise.resolve();
    });
    release();

    await expect(slow).rejects.toThrow(SerialisationConflictError);
    expect(store.committed().get('counter')).toBe(2);
    expect(store.committed().has('issued:slow')).toBe(false);
  });

  it('refuses a decision taken on a listing that another command has since added to', async () => {
    // "Is anybody else still an owner?" is a listing, not one key.
    const { transactor } = harness();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = transactor.run(context, async (uow) => {
      const owners = uow.session.keys().filter((key) => key.startsWith('owner:'));
      await held;
      uow.session.put('decision', owners.length);
    });
    await transactor.run(context, (uow) => {
      uow.session.put('owner:2', true);
      return Promise.resolve();
    });
    release();

    await expect(slow).rejects.toThrow(SerialisationConflictError);
  });

  it('never refuses a command that wrote nothing, nor one whose reads were left alone', async () => {
    const { store, transactor } = harness();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = transactor.run(context, async (uow) => {
      uow.session.keys();
      await held;
      return uow.session.get('a');
    });
    const writer = transactor.run(context, async (uow) => {
      uow.session.get('b');
      await held;
      uow.session.put('b', 1);
    });
    await transactor.run(context, (uow) => {
      uow.session.put('a', 1);
      return Promise.resolve();
    });
    release();

    await expect(reader).resolves.toBe(1);
    await expect(writer).resolves.toBeUndefined();
    expect(store.committed().get('b')).toBe(1);
  });

  it('holds values, not the objects it was handed', async () => {
    // As a database does. Editing what `get` returned, and then failing, once
    // changed committed state anyway; and a command that forgot to `put` passed
    // here and lost its write against a real store.
    const { store, transactor } = harness();
    const handed = { balance: '100' };

    await transactor.run(context, (uow) => {
      uow.session.put('till:1', handed);
      return Promise.resolve();
    });
    handed.balance = 'edited after the commit';

    await expect(
      transactor.run(context, (uow) => {
        (uow.session.get('till:1') as { balance: string }).balance = '0';
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    await transactor.run(context, (uow) => {
      (uow.session.get('till:1') as { balance: string }).balance = 'never put';
      return Promise.resolve();
    });

    expect(store.committed().get('till:1')).toEqual({ balance: '100' });
  });
});
