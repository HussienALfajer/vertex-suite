// boundary-exempt: altitude — the sandbox's stand-in till and store node, there so POS-18's journeys drive the real courier in a browser; nothing ships them, and the register replaces both in U12.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { newId, systemClock } from '@vertex/kernel';
import {
  commandContext,
  createCourier,
  createEventBus,
  createMemoryStore,
  createTransactor,
  operationMailboxMigrations,
  recordJournal,
  runMigrations,
  stageOperation,
  type Courier,
  type DeliveryAnswer,
  type MemorySession,
  type StoreLink,
} from '@vertex/platform';
import { Button, Panel, Switch, SyncStatus, useTranslator } from '@vertex/ui';

/**
 * A store node held in the page: it answers deliveries the way the real one
 * does — once per operation, a duplicate for anything it has already applied —
 * and it can lose its line, or refuse this register, at the flick of a switch.
 */
interface StandInNode extends StoreLink {
  online: boolean;
  refusing: boolean;
}

function standInNode(): StandInNode {
  const applied = new Set<string>();
  const node: StandInNode = {
    online: true,
    refusing: false,
    deliver(envelope): Promise<DeliveryAnswer> {
      if (!node.online) return Promise.resolve({ status: 'unreachable' });
      if (node.refusing) return Promise.resolve({ status: 'refused', reason: 'forbidden' });
      if (applied.has(envelope.key)) return Promise.resolve({ status: 'duplicate' });
      applied.add(envelope.key);
      return Promise.resolve({ status: 'applied' });
    },
    reach() {
      return Promise.resolve(node.online ? 'reachable' : 'unreachable');
    },
  };
  return node;
}

interface StandInTill {
  readonly courier: Courier;
  readonly node: StandInNode;
  /** Migrates the till's store, then starts delivering. */
  start(): Promise<void>;
  sell(): Promise<void>;
}

/**
 * The till: the platform's own memory store, transactor and courier — the
 * same code a register runs, over a store that forgets on reload. The waits
 * are short so a journey sees a line come back in seconds rather than the
 * minute a shop would wait.
 */
function standInTill(): StandInTill {
  const store = createMemoryStore();
  const transactor = createTransactor({
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
  const context = commandContext({
    tenant: newId<'tenant'>(),
    actor: newId<'user'>(),
    device: newId<'device'>(),
  });
  const migrated = runMigrations({
    plan: operationMailboxMigrations<MemorySession>(),
    transactor,
    context,
    journal: recordJournal(),
  });
  const node = standInNode();
  const courier = createCourier({
    transactor,
    context,
    link: node,
    clock: systemClock,
    backoff: { first: 500, ceiling: 2_000 },
    heartbeat: 1_000,
    onFault: (cause) => {
      console.error('The sandbox courier failed:', cause);
    },
  });
  let sequence = 0;
  return {
    courier,
    node,
    async start() {
      await migrated;
      await courier.start();
    },
    async sell() {
      await migrated;
      sequence += 1;
      await transactor.run(context, (uow) => {
        stageOperation(uow, 'pos.sale', { receipt: String(sequence) });
        return Promise.resolve();
      });
      await courier.nudge();
    },
  };
}

/** The register's status indicator, over a till whose line and store node the page controls. */
export function SyncDemo({ timeZone }: { readonly timeZone: string }): ReactNode {
  const translator = useTranslator();
  const t = (key: string): string => translator.format(key);
  const [till] = useState(standInTill);
  const [online, setOnline] = useState(true);
  const [refusing, setRefusing] = useState(false);
  const status = useSyncExternalStore(till.courier.subscribe, till.courier.status);

  // Not stopped on unmount: a stopped courier does not start again, and
  // StrictMode unmounts once on purpose. The till lives as long as the page.
  useEffect(() => {
    void till.start();
  }, [till]);

  return (
    <Panel title={t('syncDemo.title')}>
      <div className="flex flex-col gap-[var(--vx-gap-md)]">
        <p className="text-fg-secondary text-footnote">{t('syncDemo.description')}</p>
        <div className="border-line flex items-center justify-between gap-[var(--vx-gap-md)] rounded border px-[var(--vx-pad-md)] py-[var(--vx-pad-xs)]">
          <span className="text-fg-secondary text-footnote">{t('syncDemo.bar')}</span>
          <SyncStatus
            status={status}
            timeZone={timeZone}
            describe={(operation) => t(`operation.${operation.kind}`)}
            onRetry={() => {
              void till.courier.retry();
            }}
            onEscalate={(key) => {
              // Looked up rather than cast: the component hands back the key it
              // was shown, and the courier takes the operation's own identifier.
              const queued = till.courier.status().queue.find((one) => one.key === key);
              if (queued === undefined) return;
              till.courier.escalate(queued.key).catch((cause: unknown) => {
                console.error('The sandbox could not escalate:', cause);
              });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-[var(--vx-gap-lg)]">
          <Switch
            isSelected={online}
            onChange={(next) => {
              till.node.online = next;
              setOnline(next);
            }}
          >
            {t('syncDemo.line')}
          </Switch>
          <Switch
            isSelected={refusing}
            onChange={(next) => {
              till.node.refusing = next;
              setRefusing(next);
            }}
          >
            {t('syncDemo.refusing')}
          </Switch>
          <Button
            onPress={() => {
              void till.sell();
            }}
          >
            {t('syncDemo.sell')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
