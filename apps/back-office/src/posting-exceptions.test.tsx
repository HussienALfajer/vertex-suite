import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  fixedClock,
  localDate,
  money,
  newId,
  ok,
  refusal,
  refuse,
  type Result,
} from '@vertex/kernel';
import type {
  AccountId,
  ExceptionDecision,
  Posted,
  PostingException,
  PostingRefusal,
} from '@vertex/fin/contract';

import { catalogue } from './catalogue.js';
import { developmentSystem } from './dev-system.js';
import { aTradingShop, typeDay, ACCRUED, NOON, RENT, TRADING_DAY } from './ledger.fixture.js';
import { flatten } from './screens/books.js';
import { goTo, PEOPLE, startAt, type OpenShop } from './screens.fixture.js';
import type { PostingExceptionsOfRecord, SystemOfRecord } from './system.js';

/**
 * `FIN-05`: an entry that arrived for a period since closed is routed to an
 * exceptions queue for a decision, rather than refused or dropped.
 *
 * **The queue is filled by something no screen can reach.** An arrival comes
 * through `PostingEngine.accept`, which writes into the caller's own
 * transaction — a register's sync applying a sale it made offline — and a
 * transaction does not cross a process boundary, so `accept` is deliberately
 * not on the port (`system.ts`). `exceptions.test.ts` proves what the module
 * does when one arrives, and `U07`'s register is what will make one arrive in
 * a shop.
 *
 * So what stands in here is the **queue alone**: the entry inside it is a real
 * one, posted by the real `FIN` through the real port, and the record around
 * it is assembled by this test. Everything under test — what the screen shows,
 * which decisions it offers, what it demands before sending one, and what it
 * does with the answer — is the screen's own.
 */

const SHOP = { company: 'مؤسسة الشام', branch: 'حلب' };

afterEach(cleanup);
beforeEach(() => {
  startAt('companies');
});

/** A queue whose one entry the test puts there, and the decisions taken on it. */
interface StandInQueue {
  readonly system: SystemOfRecord;
  /** Puts a real posted entry into the queue as though it had arrived late. */
  readonly enqueue: (posted: Posted) => PostingException;
  /** What `post` answers with. Null posts the entry; a code refuses it. */
  refusal: PostingRefusal['code'] | null;
}

function aQueueOver(base: SystemOfRecord): StandInQueue {
  const queued: PostingException[] = [];
  const held: StandInQueue = {
    refusal: null,
    enqueue: (posted) => {
      const exception: PostingException = {
        tenant: posted.entry.tenant,
        id: newId<'posting-exception'>(),
        arrived: posted,
        // The calendar's own answer at the moment it arrived, which is the
        // first thing the person deciding has to read.
        refused: refusal('fin.period-closed', { period: newId<'accounting-period'>() }),
        arrivedAt: NOON,
        resolved: null,
      };
      queued.push(exception);
      return exception;
    },
    system: {
      ...base,
      postingExceptions: {
        exceptions: (listing) =>
          Promise.resolve(
            listing?.including === 'all'
              ? [...queued]
              : queued.filter((one) => one.resolved === null),
          ),
        post: (id, decision?: ExceptionDecision): Promise<Result<Posted, PostingRefusal>> => {
          if (held.refusal !== null) return Promise.resolve(refuse(held.refusal));
          const at = queued.findIndex((one) => one.id === id);
          const waiting = queued[at];
          if (waiting === undefined) return Promise.resolve(refuse('fin.exception-not-found'));
          queued[at] = {
            ...waiting,
            resolved: {
              day: decision?.day ?? waiting.arrived.entry.day,
              reason: decision?.reason ?? null,
              by: null,
              at: NOON,
            },
          };
          return Promise.resolve(ok(waiting.arrived));
        },
      } satisfies PostingExceptionsOfRecord,
    },
  };
  return held;
}

/**
 * One real entry, posted through the port the accountant's own screen posts
 * through — so what is queued below is an entry `FIN` actually wrote, with its
 * number, its lines and its period.
 */
async function anEntry(system: SystemOfRecord): Promise<Posted> {
  const [branch] = await system.organisation.branches.list();
  if (branch === undefined) throw new Error('The shop has no branch to post at.');
  const accounts = flatten(await system.chart.tree());
  const find = (code: string): AccountId => {
    const account = accounts.find((one) => one.code === code);
    if (account === undefined) throw new Error(`The chart has no account ${code}.`);
    return account.id;
  };
  const functional = await system.currencies.functional();
  if (functional === null) throw new Error('The shop keeps its books in nothing.');
  const day = localDate('2026-06-15');
  if (day === null) throw new Error('That is not a day.');

  const recorded = await system.journal.record({
    id: newId<'journal-entry'>(),
    branch: branch.id,
    day,
    description: 'بيع نُقل من صندوق بلا اتصال',
    lines: [
      { account: find(RENT), side: 'debit', amount: money('1200', functional.code) },
      { account: find(ACCRUED), side: 'credit', amount: money('1200', functional.code) },
    ],
  });
  if (!recorded.ok) throw new Error(`The entry was refused: ${recorded.error.code}`);
  return recorded.value;
}

/**
 * The row the queued entry is on, by the number the books gave it.
 *
 * By the number rather than by position, because a table with nothing in it
 * still has one row — the one `DataTable` puts its empty message on — and that
 * row is not an exception.
 */
function rowFor(number: string): HTMLElement {
  const row = screen.getByRole('rowheader', { name: number }).closest('[role="row"]');
  if (row === null) throw new Error('The exception is on no row.');
  return row as HTMLElement;
}

interface QueuedShop {
  readonly shop: OpenShop;
  readonly queue: StandInQueue;
  /** What the books called the entry that is waiting. */
  readonly number: string;
}

/** A shop with one entry waiting in its queue, standing on the screen that empties it. */
async function aShopWithAQueue(): Promise<QueuedShop> {
  const queue = aQueueOver(developmentSystem({ people: PEOPLE, clock: fixedClock(NOON) }));
  const shop = await aTradingShop(SHOP, queue.system);
  const waiting = queue.enqueue(await anEntry(queue.system));
  await goTo(shop, catalogue['nav.postingExceptions']);
  const number = waiting.arrived.entry.number;
  await screen.findByRole('rowheader', { name: number });
  return { shop, queue, number };
}

describe('Posting exceptions — FIN-05', () => {
  it('shows what is waiting, with the calendar’s own reason beside it', async () => {
    const { number } = await aShopWithAQueue();

    const row = rowFor(number);
    expect(row.textContent).toContain(catalogue['exceptions.state.waiting']);
    // The refusal is rendered by its code, in the words a closed period is
    // refused in everywhere else in this application.
    expect(row.textContent).toContain(catalogue['refusal.fin.period-closed']);
  });

  it('posts a queued entry as it was dated, which is the decision with nothing to say', async () => {
    const { shop, number } = await aShopWithAQueue();

    await shop.person.click(
      within(rowFor(number)).getByRole('button', {
        name: catalogue['exceptions.decide.action'],
      }),
    );
    expect(screen.getByText(catalogue['exceptions.decide.asDated'])).toBeTruthy();
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['exceptions.decide.submit'] }),
    );

    // Off the queue: the listing shows only what still waits, so the row it is
    // on is gone rather than merely restyled.
    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: number })).toBeNull();
    });
    expect(screen.getByText(catalogue['exceptions.empty'])).toBeTruthy();
  });

  it('will not redate an entry without a written reason', async () => {
    // `FIN-05`'s second decision: a late fact entering closed books on another
    // day is the ordinary way it is done, and the reason is what makes it
    // readable a month later (`fin.redate-reason-required`).
    const { shop, number } = await aShopWithAQueue();
    await shop.person.click(
      within(rowFor(number)).getByRole('button', {
        name: catalogue['exceptions.decide.action'],
      }),
    );

    await shop.person.click(screen.getByText(catalogue['exceptions.decide.redate']));
    await typeDay(shop, { ...TRADING_DAY, month: 7 }, screen.getByRole('dialog'));
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['exceptions.decide.submit'] }),
    );

    expect(await screen.findByText(catalogue['exceptions.decide.reason.required'])).toBeTruthy();
    expect(rowFor(number)).toBeTruthy();
  });

  it('asks for the other day, rather than starting on the day the calendar refused', async () => {
    // The entry's own day is the one day "another day" cannot be: it is the
    // day the calendar turned away. A dialog that started there would post,
    // on Enter, into the refusal the person opened it to get out of.
    const { shop, number } = await aShopWithAQueue();
    await shop.person.click(
      within(rowFor(number)).getByRole('button', {
        name: catalogue['exceptions.decide.action'],
      }),
    );

    await shop.person.click(screen.getByText(catalogue['exceptions.decide.redate']));
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['exceptions.decide.submit'] }),
    );

    expect(await screen.findByText(catalogue['exceptions.decide.day.required'])).toBeTruthy();
    expect(rowFor(number)).toBeTruthy();
  });

  it('posts a queued entry on another day, against the reason it was given', async () => {
    const { shop, queue, number } = await aShopWithAQueue();
    await shop.person.click(
      within(rowFor(number)).getByRole('button', {
        name: catalogue['exceptions.decide.action'],
      }),
    );

    await shop.person.click(screen.getByText(catalogue['exceptions.decide.redate']));
    await typeDay(shop, { ...TRADING_DAY, month: 7 }, screen.getByRole('dialog'));
    await shop.person.type(
      screen.getByLabelText(catalogue['exceptions.decide.reason']),
      'وصل بعد الإقفال',
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['exceptions.decide.submit'] }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('rowheader', { name: number })).toBeNull();
    });

    // And what was decided is readable afterwards, which is the point of a
    // queue that keeps what it resolved.
    await shop.person.click(screen.getByText(catalogue['exceptions.includeResolved']));
    await screen.findByRole('rowheader', { name: number });
    expect(rowFor(number).textContent).toContain(catalogue['exceptions.state.posted']);
    expect(queue.refusal).toBeNull();
  });

  it('shows the refusal where the decision was taken, and leaves the entry in the queue', async () => {
    // Posting as dated is offered whether or not the period has been opened
    // again, and refused rather than hidden: the answer changes between the
    // dialog opening and the button being pressed, and the refusal is the one
    // sentence that says what to do next.
    const { shop, queue, number } = await aShopWithAQueue();
    queue.refusal = 'fin.period-closed';

    await shop.person.click(
      within(rowFor(number)).getByRole('button', {
        name: catalogue['exceptions.decide.action'],
      }),
    );
    await shop.person.click(
      screen.getByRole('button', { name: catalogue['exceptions.decide.submit'] }),
    );

    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getAllByText(catalogue['refusal.fin.period-closed']).length).toBe(2);
    });
    expect(rowFor(number)).toBeTruthy();
  });
});
