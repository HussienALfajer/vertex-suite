import type { BranchId } from '@vertex/contracts';
import {
  isOk,
  localDate,
  money,
  newId,
  type LocalDate,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FIN_PERMISSIONS,
  type Accepted,
  type EntryDraft,
  type FiscalYear,
  type Posted,
  type PostingException,
} from './contract.js';
import {
  CASH_ROLE,
  installFin,
  INVENTORY_ROLE,
  type AtRegister,
  type Installed,
} from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code} ${JSON.stringify(result.error.values)}`);
}

function refusalOf(result: Result<unknown, Refusal>): Refusal {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error;
}

/** A day written the way an accountant writes one. */
function day(text: string): LocalDate {
  const value = localDate(text);
  if (value === null) throw new Error(`"${text}" is not a day.`);
  return value;
}

function queued(accepted: Accepted): PostingException {
  if (accepted.outcome !== 'queued')
    throw new Error('Expected the entry to be queued; it was posted.');
  return accepted.exception;
}

function posted(accepted: Accepted): Posted {
  if (accepted.outcome !== 'posted')
    throw new Error('Expected the entry to be posted; it was queued.');
  return accepted.posted;
}

/**
 * A shop with a register that traded while the line was down: the chart and the
 * calendar seeded, a branch, and a till with a machine at it.
 */
interface Shop {
  readonly fin: Installed;
  readonly branch: BranchId;
  readonly year: FiscalYear;
  readonly till: AtRegister;
}

async function openShop(): Promise<Shop> {
  const fin = installFin();
  taken(await fin.admin.seed(fin.system));
  const [year] = taken(await fin.calendarAdmin.seed(fin.system));
  const branch = fin.openBranch();
  return { fin, branch, year: year!, till: fin.openRegister(branch, { prefix: 'T1' }) };
}

/** Goods received at the till on a day: ten dollars of stock against cash. */
function receipt(shop: Shop, on: string): EntryDraft {
  return {
    id: newId<'journal-entry'>(),
    source: { kind: 'stk.goods-receipt', document: newId<'goods-receipt'>() },
    branch: shop.branch,
    day: day(on),
    lines: [
      { role: INVENTORY_ROLE, side: 'debit', amount: money('10', 'USD') },
      { role: CASH_ROLE, currency: 'USD', side: 'credit', amount: money('10', 'USD') },
    ],
  };
}

/** The store node applying what a register sent, in a transaction of the sync's own. */
function arrive(shop: Shop, arrived: Posted): Promise<Result<Accepted, Refusal>> {
  return shop.fin.run(shop.fin.system, (uow) => shop.fin.posting.accept(uow, arrived));
}

let shop: Shop;

beforeEach(async () => {
  shop = await openShop();
});

describe('Fiscal calendar and period closing — FIN-05', () => {
  it('blocks a posting dated within a closed period where the entry is written, not only where it was prepared', async () => {
    const { fin, year } = shop;
    const september = year.periods[8]!;
    const prepared = taken(await fin.posting.prepare(fin.by, receipt(shop, '2026-09-14')));
    taken(await fin.calendarAdmin.close(fin.by, september.id));

    // Worked out now, the entry is refused before anything is built on it.
    expect(refusalOf(await fin.posting.prepare(fin.by, receipt(shop, '2026-09-14')))).toEqual({
      code: 'fin.period-closed',
      values: { day: '2026-09-14', period: september.id },
    });

    // The period was open when the entry was worked out and is closed when it
    // is written; the transaction's answer is the one that counts, and the
    // module that owns the event abandons the event with it (FIN-02).
    await expect(
      fin.run(fin.by, async (uow) => {
        uow.session.put('stk/receipt/1', { received: true });
        const outcome = await fin.posting.post(uow, prepared);
        if (!outcome.ok) throw new Error(`refused: ${outcome.error.code}`);
        return outcome.value;
      }),
    ).rejects.toThrow('refused: fin.period-closed');

    const outcome = await fin.run(fin.by, (uow) => fin.posting.post(uow, prepared));
    expect(refusalOf(outcome)).toEqual({
      code: 'fin.period-closed',
      values: { day: '2026-09-14', period: september.id },
    });
    expect(fin.store.committed().has('stk/receipt/1')).toBe(false);
    expect(await fin.journal.entry(fin.by, prepared.id)).toBeNull();
    expect((await fin.calendar.years(fin.by))[0]!.periods[8]!.posted).toBe(false);
    // Nothing was routed anywhere: a live posting into a closed month is a
    // mistake to correct, not an event that already happened.
    expect(await fin.exceptions.exceptions(fin.by, { including: 'all' })).toEqual([]);
  });

  it('routes a late offline arrival dated in a period closed since it was made to the exceptions queue for a decision, and posts nothing', async () => {
    const { fin, year, till } = shop;
    const september = year.periods[8]!;
    const arrived = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));
    expect(arrived.entry.number).toBe('T1-1-2026-000001');
    taken(await fin.calendarAdmin.close(fin.by, september.id));
    fin.clock.advance(3_600_000);

    const accepted = taken(await arrive(shop, arrived));

    const exception = queued(accepted);
    expect(exception).toEqual({
      id: exception.id,
      tenant: fin.tenant,
      arrived,
      refused: { code: 'fin.period-closed', values: { day: '2026-09-14', period: september.id } },
      arrivedAt: fin.clock.now(),
      resolved: null,
    });
    expect(await fin.journal.entry(fin.by, arrived.entry.id)).toBeNull();
    expect(await fin.journal.entryFor(fin.by, arrived.entry.source)).toBeNull();
    expect(await fin.exceptions.exceptions(fin.by)).toEqual([exception]);
    expect(await fin.exceptions.exception(fin.by, exception.id)).toEqual(exception);
    expect(await fin.exceptions.exception(fin.byOther, exception.id)).toBeNull();
    expect(await fin.exceptions.exceptions(fin.byOther)).toEqual([]);
    expect((await fin.calendar.years(fin.by))[0]!.periods[8]!.posted).toBe(false);
  });

  it('posts a queued entry as it was dated once the owner has reopened its period, with the number it was made under', async () => {
    const { fin, year, till } = shop;
    const september = year.periods[8]!;
    const arrived = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));
    taken(await fin.calendarAdmin.close(fin.by, september.id));
    const exception = queued(taken(await arrive(shop, arrived)));

    taken(await fin.calendarAdmin.reopen(fin.by, september.id, 'وصلت مبيعات متأخرة من الصندوق'));
    fin.clock.advance(60_000);
    const decided = taken(await fin.exceptionsAdmin.post(fin.by, exception.id));

    expect(decided.entry).toEqual({
      ...arrived.entry,
      period: september.id,
      exception: exception.id,
    });
    expect(decided.lines).toEqual(arrived.lines);
    expect(await fin.journal.entry(fin.by, arrived.entry.id)).toEqual(decided);
    expect(await fin.journal.entryFor(fin.by, arrived.entry.source)).toEqual(decided);
    expect((await fin.calendar.years(fin.by))[0]!.periods[8]!.posted).toBe(true);

    const resolved = await fin.exceptions.exception(fin.by, exception.id);
    expect(resolved?.resolved).toEqual({
      day: '2026-09-14',
      reason: null,
      by: fin.by.actor,
      at: fin.clock.now(),
    });
    expect(resolved?.arrived).toEqual(arrived);
    expect(await fin.exceptions.exceptions(fin.by)).toEqual([]);
    expect(await fin.exceptions.exceptions(fin.by, { including: 'all' })).toEqual([resolved]);
    // The store node took no number of its own for it.
    expect(taken(await fin.post(day('2026-10-01'))).entry.number).toBe('2026-000001');
  });

  it('posts a queued entry on another day against a written reason, and records both the day it was dated and the day it was posted', async () => {
    const { fin, year, till } = shop;
    const september = year.periods[8]!;
    const october = year.periods[9]!;
    const arrived = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));
    taken(await fin.calendarAdmin.close(fin.by, september.id));
    const exception = queued(taken(await arrive(shop, arrived)));

    // Another day needs a reason; the same day needs none.
    expect(
      refusalOf(await fin.exceptionsAdmin.post(fin.by, exception.id, { day: day('2026-10-01') })),
    ).toEqual({
      code: 'fin.redate-reason-required',
      values: { exception: exception.id, day: '2026-10-01' },
    });
    expect(
      refusalOf(
        await fin.exceptionsAdmin.post(fin.by, exception.id, {
          day: day('2026-10-01'),
          reason: ' - ',
        }),
      ).code,
    ).toBe('fin.redate-reason-required');
    expect(
      refusalOf(
        await fin.exceptionsAdmin.post(fin.by, exception.id, { day: '2026-10-1' as LocalDate }),
      ),
    ).toEqual({ code: 'fin.day-invalid', values: { day: '2026-10-1' } });
    // And the other day has to be open too.
    taken(await fin.calendarAdmin.close(fin.by, october.id));
    expect(
      refusalOf(
        await fin.exceptionsAdmin.post(fin.by, exception.id, {
          day: day('2026-10-01'),
          reason: 'أيلول مُقفل',
        }),
      ),
    ).toEqual({ code: 'fin.period-closed', values: { day: '2026-10-01', period: october.id } });
    taken(await fin.calendarAdmin.reopen(fin.by, october.id, 'إعادة فتح'));

    const decided = taken(
      await fin.exceptionsAdmin.post(fin.by, exception.id, {
        day: day('2026-10-01'),
        reason: '  أيلول مُقفل؛ تُرحَّل إلى أول تشرين  ',
      }),
    );

    expect(decided.entry).toEqual({
      ...arrived.entry,
      day: '2026-10-01',
      period: october.id,
      exception: exception.id,
    });
    expect((await fin.exceptions.exception(fin.by, exception.id))?.resolved).toEqual({
      day: '2026-10-01',
      reason: 'أيلول مُقفل؛ تُرحَّل إلى أول تشرين',
      by: fin.by.actor,
      at: fin.clock.now(),
    });
    // What the register knew is still what it knew: the day it was dated is
    // on the arrived entry, and the day it was posted on the ledger.
    expect((await fin.exceptions.exception(fin.by, exception.id))?.arrived.entry.day).toBe(
      '2026-09-14',
    );
    expect((await fin.journal.entries(fin.by, { from: day('2026-10-01') }))[0]?.id).toBe(
      arrived.entry.id,
    );
  });

  it('refuses to post a queued entry while its period is still closed, and queues nothing twice for one arrival', async () => {
    const { fin, year, till } = shop;
    const september = year.periods[8]!;
    const arrived = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));
    taken(await fin.calendarAdmin.close(fin.by, september.id));
    const exception = queued(taken(await arrive(shop, arrived)));

    expect(refusalOf(await fin.exceptionsAdmin.post(fin.by, exception.id))).toEqual({
      code: 'fin.period-closed',
      values: { day: '2026-09-14', period: september.id },
    });
    expect((await fin.exceptions.exception(fin.by, exception.id))?.resolved).toBeNull();

    // Delivered at least once (SYN-02): the second arrival finds the first.
    fin.clock.advance(60_000);
    expect(taken(await arrive(shop, arrived))).toEqual({ outcome: 'queued', exception });
    expect(await fin.exceptions.exceptions(fin.by)).toEqual([exception]);
    expect(await fin.journal.entry(fin.by, arrived.entry.id)).toBeNull();
  });

  it('accepts an arrival whose period is open as an ordinary posting, and one already posted as done', async () => {
    const { fin, year, till } = shop;
    const made = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));
    // The register's own calendar named the period; the system of record's
    // admission is what the entry is filed under here, whatever arrived.
    const arrived = { ...made, entry: { ...made.entry, period: newId<'accounting-period'>() } };

    const first = posted(taken(await arrive(shop, arrived)));
    expect(first.entry).toEqual({ ...made.entry, period: year.periods[8]!.id });
    expect(first.lines).toEqual(arrived.lines);
    expect(await fin.journal.entry(fin.by, arrived.entry.id)).toEqual(first);
    expect((await fin.calendar.years(fin.by))[0]!.periods[8]!.posted).toBe(true);

    expect(taken(await arrive(shop, arrived))).toEqual({ outcome: 'posted', posted: first });
    expect(await fin.journal.entries(fin.by)).toEqual([first.entry]);
    expect(await fin.exceptions.exceptions(fin.by, { including: 'all' })).toEqual([]);

    // A day the calendar does not reach is a decision too — the calendar has
    // to be extended — and the sale still happened.
    const next = await fin.postedElsewhere(till.by, receipt(shop, '2026-12-31'));
    const beyond = { ...next, entry: { ...next.entry, day: day('2027-01-02') } };
    const exception = queued(taken(await arrive(shop, beyond)));
    expect(exception.refused).toEqual({
      code: 'fin.day-outside-calendar',
      values: { day: '2027-01-02' },
    });
    taken(await fin.calendarAdmin.append(fin.by));
    expect(taken(await fin.exceptionsAdmin.post(fin.by, exception.id)).entry.day).toBe(
      '2027-01-02',
    );

    // A day that is not a day is not a decision for anybody: no entry this
    // module made carries one, so it is refused as the defect it is, not queued.
    const third = await fin.postedElsewhere(till.by, receipt(shop, '2026-12-31'));
    const broken = { ...third, entry: { ...third.entry, day: '2027-1-2' as LocalDate } };
    expect(refusalOf(await arrive(shop, broken))).toEqual({
      code: 'fin.day-invalid',
      values: { day: '2027-1-2' },
    });
    expect(await fin.exceptions.exceptions(fin.by)).toEqual([]);
  });

  it('answers a resolved exception as done, and refuses one the tenant does not have', async () => {
    const { fin, year, till } = shop;
    const september = year.periods[8]!;
    const arrived = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));
    taken(await fin.calendarAdmin.close(fin.by, september.id));
    const exception = queued(taken(await arrive(shop, arrived)));
    taken(await fin.calendarAdmin.reopen(fin.by, september.id, 'سبب'));

    const decided = taken(await fin.exceptionsAdmin.post(fin.by, exception.id));
    const decidedAt = fin.clock.now();
    fin.clock.advance(60_000);
    // Decided twice — a button pressed twice, a replayed command — and decided
    // once: the same entry, and the resolution keeps its first author and moment.
    expect(taken(await fin.exceptionsAdmin.post(fin.by, exception.id))).toEqual(decided);
    expect(
      taken(
        await fin.exceptionsAdmin.post(fin.by, exception.id, {
          day: day('2026-10-01'),
          reason: 'متأخر',
        }),
      ),
    ).toEqual(decided);
    expect((await fin.exceptions.exception(fin.by, exception.id))?.resolved?.at).toBe(decidedAt);
    expect(await fin.journal.entries(fin.by)).toHaveLength(1);

    const unknown = newId<'posting-exception'>();
    expect(refusalOf(await fin.exceptionsAdmin.post(fin.by, unknown))).toEqual({
      code: 'fin.exception-not-found',
      values: { exception: unknown },
    });
    expect(refusalOf(await fin.exceptionsAdmin.post(fin.byOther, exception.id))).toEqual({
      code: 'fin.exception-not-found',
      values: { exception: exception.id },
    });
  });

  it('hands out an exception nothing outside this module can edit', async () => {
    const { fin, year, till } = shop;
    const arrived = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));
    taken(await fin.calendarAdmin.close(fin.by, year.periods[8]!.id));

    const exception = queued(taken(await arrive(shop, arrived)));
    for (const one of [exception, (await fin.exceptions.exceptions(fin.by))[0]!]) {
      expect(Object.isFrozen(one)).toBe(true);
      expect(Object.isFrozen(one.arrived)).toBe(true);
      expect(Object.isFrozen(one.arrived.entry)).toBe(true);
      expect(Object.isFrozen(one.arrived.lines)).toBe(true);
      expect(Object.isFrozen(one.arrived.lines[0])).toBe(true);
      expect(Object.isFrozen(one.refused)).toBe(true);
    }
  });

  it('raises rather than accepts an entry posted under another tenant', async () => {
    const { fin, till } = shop;
    const arrived = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));

    await expect(fin.run(fin.byOther, (uow) => fin.posting.accept(uow, arrived))).rejects.toThrow(
      /another tenant/,
    );
    expect(await fin.journal.entry(fin.by, arrived.entry.id)).toBeNull();
    expect(await fin.exceptions.exceptions(fin.byOther, { including: 'all' })).toEqual([]);
  });
});

describe('Who decides on a queued entry', () => {
  it('asks the accountant’s right, tenant-wide, and refuses before anything is written', async () => {
    const { fin, year, till } = shop;
    const september = year.periods[8]!;
    const arrived = await fin.postedElsewhere(till.by, receipt(shop, '2026-09-14'));
    taken(await fin.calendarAdmin.close(fin.by, september.id));
    const exception = queued(taken(await arrive(shop, arrived)));
    taken(await fin.calendarAdmin.reopen(fin.by, september.id, 'سبب'));

    const asked: string[] = [];
    fin.answers((by, right, where) => {
      expect(by).toBe(fin.by);
      expect(where).toBeUndefined();
      asked.push(right);
      return false;
    });

    expect(refusalOf(await fin.exceptionsAdmin.post(fin.by, exception.id))).toEqual({
      code: 'fin.not-permitted',
      values: { right: FIN_PERMISSIONS.postingException.resolve },
    });
    expect(asked).toEqual([FIN_PERMISSIONS.postingException.resolve]);
    expect(await fin.journal.entry(fin.by, arrived.entry.id)).toBeNull();
    expect((await fin.exceptions.exception(fin.by, exception.id))?.resolved).toBeNull();
  });
});
