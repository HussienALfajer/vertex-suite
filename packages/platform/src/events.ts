import type { Id, Instant } from '@vertex/kernel';

import type { CommandContext } from './context.js';
import type { ModuleCode } from './module.js';

declare const EventPayload: unique symbol;

/**
 * The name of an event and, in the type only, what it carries.
 *
 * Declared once by the module the event happens in, exported from that module's
 * contract, and imported by anything that publishes or subscribes to it. The
 * name is therefore never written twice, so the failure this makes impossible
 * is the quiet one: a publisher and a subscriber that differ by a character,
 * which no test fails on and which simply means nothing ever arrives.
 */
export interface EventType<Payload> {
  readonly name: string;
  readonly [EventPayload]?: Payload;
}

/**
 * Declares an event type:
 *
 *   export interface ConsignmentUnitSold { item: ItemId; quantity: string }
 *   export const ConsignmentUnitSold =
 *     eventType<ConsignmentUnitSold>('stk.consignment-unit-sold');
 */
export function eventType<Payload>(name: string): EventType<Payload> {
  return { name };
}

/**
 * A thing that happened, stated by the module it happened in.
 *
 * modules.md §4 makes this the only way a lower module affects a higher one,
 * and §5 lists the five places where that inversion is the difference between a
 * module an edition can leave out and one it cannot. STK publishes that a
 * consignment unit was sold; PUR subscribes and raises the payable. STK does
 * not know PUR exists, which is exactly what lets an edition ship STK without
 * it.
 */
export interface DomainEvent<Payload = unknown> {
  readonly id: Id<'event'>;
  /** Namespaced by the publishing module: stk.consignment-unit-sold. */
  readonly name: string;
  readonly occurredAt: Instant;
  readonly context: CommandContext;
  readonly payload: Payload;
}

/**
 * A subscriber failed.
 *
 * The transaction that produced the event has already committed — see the
 * dispatch rule below — so this is never an undo. It is the failed-operation
 * queue of SYN-06 in the making: something to be retried or escalated by a host
 * that knows how, and never simply dropped.
 */
export interface HandlerFailure {
  readonly event: DomainEvent;
  readonly subscriber: ModuleCode;
  readonly cause: unknown;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface EventBusOptions {
  /**
   * Required, with no default on purpose.
   *
   * A bus that swallows handler failures is why a stock movement is missing and
   * nobody knows when; a bus that rethrows them makes a committed sale look as
   * though it failed. Neither is a decision this package gets to make quietly,
   * so the host states it at construction.
   */
  readonly onHandlerFailure: (failure: HandlerFailure) => void;
}

export interface EventBus {
  /** Wired by the registry from what each module declared. */
  subscribe(eventName: string, subscriber: ModuleCode, handle: EventHandler): void;

  /**
   * Delivers events whose transaction has **already committed**.
   *
   * Called by the transactor and by nothing else. Delivery is sequential and in
   * publication order, because two handlers of one sale — the ledger posting
   * and the stock movement — are not independent of each other, and running
   * them concurrently would make the order they interleave in a property of the
   * event loop rather than of the specification.
   */
  dispatch(events: readonly DomainEvent[]): Promise<void>;

  subscriberCount(eventName: string): number;
}

export function createEventBus(options: EventBusOptions): EventBus {
  const handlers = new Map<string, { subscriber: ModuleCode; handle: EventHandler }[]>();

  return {
    subscribe(eventName: string, subscriber: ModuleCode, handle: EventHandler): void {
      const existing = handlers.get(eventName);
      if (existing === undefined) {
        handlers.set(eventName, [{ subscriber, handle }]);
      } else {
        existing.push({ subscriber, handle });
      }
    },

    async dispatch(events: readonly DomainEvent[]): Promise<void> {
      for (const event of events) {
        for (const { subscriber, handle } of handlers.get(event.name) ?? []) {
          try {
            await handle(event);
          } catch (cause) {
            // One subscriber failing does not stop the others. The event is a
            // fact — it happened, and it is committed — so every module that
            // was waiting for it still has to be told.
            options.onHandlerFailure({ event, subscriber, cause });
          }
        }
      }
    },

    subscriberCount(eventName: string): number {
      return handlers.get(eventName)?.length ?? 0;
    },
  };
}
