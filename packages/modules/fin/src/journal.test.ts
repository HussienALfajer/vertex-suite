import type { BranchId, DeviceId } from '@vertex/contracts';
import {
  isOk,
  localDate,
  money,
  newId,
  type LocalDate,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import { commandContext } from '@vertex/platform';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FIN_PERMISSION_SEEDS,
  FIN_PERMISSIONS,
  type Account,
  type DraftLine,
  type EntryDraft,
  type FiscalYear,
  type JournalLine,
  type Posted,
} from './contract.js';
import {
  CASH_ROLE,
  EXPENSE_ROLE,
  installFin,
  INVENTORY_ROLE,
  REVENUE_ROLE,
  UNDECLARED_ROLE,
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

function seeded(accounts: readonly Account[], seed: string): Account {
  const found = accounts.find((one) => one.seeded === seed);
  if (found === undefined) throw new Error(`No seeded account "${seed}".`);
  return found;
}

function cashIn(accounts: readonly Account[], currency: string): Account {
  const found = accounts.find((one) => one.reserved === 'cash' && one.currency === currency);
  if (found === undefined) throw new Error(`No cash account for ${currency}.`);
  return found;
}

function usd(amount: string) {
  return money(amount, 'USD');
}

/**
 * What a line says about the books, and nothing about how it was recorded:
 * the shape two lines are compared by when one is meant to undo the other.
 */
function figuresOf(lines: readonly JournalLine[]) {
  return lines.map(({ account, role, side, amount, original, stamp }) => ({
    account,
    role,
    side,
    amount,
    original,
    stamp,
  }));
}

/** Every committed record that names an entry, as the store holds it. */
function recordsOf(fin: Installed, entry: string): ReadonlyMap<string, unknown> {
  const found = new Map<string, unknown>();
  for (const [key, value] of fin.store.committed()) {
    if (key.includes(entry) || JSON.stringify(value).includes(entry)) found.set(key, value);
  }
  return found;
}

/**
 * A shop on its first day of trading: the chart and the calendar seeded, one
 * branch, and the one unreserved role a sale needs mapped by the accountant.
 */
interface Shop {
  readonly fin: Installed;
  readonly branch: BranchId;
  readonly accounts: readonly Account[];
  readonly year: FiscalYear;
}

async function openShop(): Promise<Shop> {
  const fin = installFin();
  const accounts = taken(await fin.admin.seed(fin.system));
  const [year] = taken(await fin.calendarAdmin.seed(fin.system));
  const branch = fin.openBranch();
  taken(await fin.admin.map(fin.by, REVENUE_ROLE, seeded(accounts, 'sales-revenue').id));
  return { fin, branch, accounts, year: year! };
}

/** A cash sale of ten dollars: the simplest event that produces a balanced entry. */
function sale(shop: Shop, changes: Partial<EntryDraft> = {}): EntryDraft {
  return {
    id: newId<'journal-entry'>(),
    source: { kind: 'pos.sale', document: newId<'sale'>() },
    branch: shop.branch,
    day: day('2026-09-20'),
    lines: [
      { role: CASH_ROLE, currency: 'USD', side: 'debit', amount: usd('10') },
      { role: REVENUE_ROLE, side: 'credit', amount: usd('10') },
    ],
    ...changes,
  };
}

/**
 * The same sale with its first line replaced, which is how one line at a time
 * is put on trial — with whatever a caller might actually hand in, not only
 * what the type allows, since the type is gone by the time it arrives.
 */
type ArrivingLine = Readonly<Record<string, unknown>> & { readonly role: string };

function saleWith(shop: Shop, line: ArrivingLine): EntryDraft {
  const draft = sale(shop);
  const [first, second] = draft.lines as [DraftLine, DraftLine];
  return { ...draft, lines: [{ ...first, ...line }, second] };
}

/** Prepares and posts in one transaction of the event's own, as a module would. */
async function post(shop: Shop, draft: EntryDraft): Promise<Result<Posted, Refusal>> {
  const prepared = await shop.fin.posting.prepare(shop.fin.by, draft);
  if (!prepared.ok) return prepared;
  return shop.fin.run(shop.fin.by, (uow) => shop.fin.posting.post(uow, prepared.value));
}

let shop: Shop;

beforeEach(async () => {
  shop = await openShop();
});

describe('Automatic posting engine — FIN-02', () => {
  it('writes a business event and its balanced journal entry in one atomic transaction, numbered where the event is made', async () => {
    const { fin, branch, accounts, year } = shop;
    const draft = sale(shop);
    const prepared = taken(await fin.posting.prepare(fin.by, draft));

    // The module that owns the sale writes the sale and posts its entry in the
    // same unit of work; neither exists without the other.
    const posted = await fin.run(fin.by, async (uow) => {
      uow.session.put(`pos/sale/${draft.source.document}`, { total: '10', entry: draft.id });
      return taken(await fin.posting.post(uow, prepared));
    });

    expect(posted.entry).toEqual({
      id: draft.id,
      tenant: fin.tenant,
      number: '2026-000001',
      lineCount: 2,
      attachmentCount: 0,
      source: draft.source,
      branch,
      register: null,
      day: '2026-09-20',
      period: year.periods[8]!.id,
      description: null,
      total: { amount: '10', currency: 'USD' },
      reverses: null,
      exception: null,
      by: fin.by.actor,
      device: null,
      at: fin.clock.now(),
    });
    expect(posted.lines).toEqual([
      {
        id: posted.lines[0]!.id,
        tenant: fin.tenant,
        entry: draft.id,
        ordinal: 1,
        account: cashIn(accounts, 'USD').id,
        role: CASH_ROLE,
        side: 'debit',
        amount: { amount: '10', currency: 'USD' },
        original: null,
        stamp: null,
        memo: null,
      },
      {
        id: posted.lines[1]!.id,
        tenant: fin.tenant,
        entry: draft.id,
        ordinal: 2,
        account: seeded(accounts, 'sales-revenue').id,
        role: REVENUE_ROLE,
        side: 'credit',
        amount: { amount: '10', currency: 'USD' },
        original: null,
        stamp: null,
        memo: null,
      },
    ]);
    expect(await fin.journal.entry(fin.by, draft.id)).toEqual(posted);
    expect(await fin.journal.entryFor(fin.by, draft.source)).toEqual(posted);
    expect(fin.store.committed().get(`pos/sale/${draft.source.document}`)).toEqual({
      total: '10',
      entry: draft.id,
    });
    // And the calendar knows the month has been posted into (FIN-05).
    const [posted2026] = await fin.calendar.years(fin.by);
    expect(posted2026!.periods[8]!.posted).toBe(true);
    expect(posted2026!.periods[7]!.posted).toBe(false);
  });

  it('leaves nothing behind when the event fails after posting: the entry, its lines, its number and the period’s mark roll back with the event', async () => {
    const { fin } = shop;
    const draft = sale(shop);
    const prepared = taken(await fin.posting.prepare(fin.by, draft));

    await expect(
      fin.run(fin.by, async (uow) => {
        taken(await fin.posting.post(uow, prepared));
        // The sale could not be written — a constraint, a disk, a power cut
        // between the two writes. FIN-02: a failure to post rolls back the
        // event, and the converse holds too.
        throw new Error('the sale would not write');
      }),
    ).rejects.toThrow('the sale would not write');

    expect(await fin.journal.entry(fin.by, draft.id)).toBeNull();
    expect(await fin.journal.entryFor(fin.by, draft.source)).toBeNull();
    expect(await fin.journal.entries(fin.by)).toEqual([]);
    expect(recordsOf(fin, draft.id).size).toBe(0);
    expect((await fin.calendar.years(fin.by))[0]!.periods[8]!.posted).toBe(false);
    // The number was not spent: the series has no gap for anybody to ask about.
    expect(taken(await post(shop, sale(shop))).entry.number).toBe('2026-000001');
  });

  it('balances the entry in the functional currency exactly, with no tolerance — the rounding residual of FX-07 is a line the caller adds', async () => {
    const { fin, accounts } = shop;

    const short = sale(shop, {
      lines: [
        { role: CASH_ROLE, currency: 'USD', side: 'debit', amount: usd('10') },
        { role: REVENUE_ROLE, side: 'credit', amount: usd('9.9999') },
      ],
    });
    expect(refusalOf(await fin.posting.prepare(fin.by, short))).toEqual({
      code: 'fin.entry-unbalanced',
      values: { debits: '10', credits: '9.9999', currency: 'USD' },
    });

    // What FX-07 hands back with a valued document is a signed residual and the
    // role it goes to; the caller puts it on the side its sign means, and the
    // entry balances by construction rather than by a tolerance.
    const balanced = sale(shop, {
      lines: [
        { role: CASH_ROLE, currency: 'USD', side: 'debit', amount: usd('10') },
        { role: REVENUE_ROLE, side: 'credit', amount: usd('9.9999') },
        { role: 'fx.rounding', side: 'credit', amount: usd('0.0001') },
      ],
    });
    const posted = taken(await post(shop, balanced));
    expect(posted.entry.total).toEqual({ amount: '10', currency: 'USD' });
    expect(posted.lines[2]).toMatchObject({
      ordinal: 3,
      account: seeded(accounts, 'rounding-differences').id,
      side: 'credit',
      amount: { amount: '0.0001', currency: 'USD' },
    });
  });

  it('values a foreign-currency line in the functional currency and keeps the document’s own amount and its rate stamp beside it', async () => {
    const { accounts } = shop;
    const stamp = newId<'rate-stamp'>();

    // A sale of 131,000 pounds, which FX valued at ten dollars (FX-05, FX-07).
    // The ledger balances the dollars; the pounds and the stamp are what a
    // till count and a rate audit read back.
    const posted = taken(
      await post(
        shop,
        sale(shop, {
          lines: [
            {
              role: CASH_ROLE,
              currency: 'SYP',
              side: 'debit',
              amount: usd('10'),
              original: money('131000', 'SYP'),
              stamp,
              memo: '  الدرج الأول  ',
            },
            { role: REVENUE_ROLE, side: 'credit', amount: usd('10') },
          ],
        }),
      ),
    );

    expect(posted.lines[0]).toMatchObject({
      account: cashIn(accounts, 'SYP').id,
      amount: { amount: '10', currency: 'USD' },
      original: { amount: '131000', currency: 'SYP' },
      stamp,
      memo: 'الدرج الأول',
    });
    expect(posted.lines[1]).toMatchObject({ original: null, stamp: null });
  });

  it('refuses a line that is not in the functional currency, not positive, finer than its currency is stored at, or on a side that is not one of the two', async () => {
    const { fin } = shop;
    const prepare = (line: ArrivingLine) => fin.posting.prepare(fin.by, saleWith(shop, line));
    const cash = { role: CASH_ROLE, currency: 'USD' };

    expect(refusalOf(await prepare({ ...cash, amount: money('131000', 'SYP') }))).toEqual({
      code: 'fin.line-currency-not-functional',
      values: { line: 1, currency: 'SYP', functional: 'USD' },
    });
    for (const amount of ['0', '-10']) {
      expect(refusalOf(await prepare({ ...cash, amount: usd(amount) })), amount).toEqual({
        code: 'fin.line-amount-invalid',
        values: { line: 1, amount },
      });
    }
    // A figure with more places than the dollar is stored at is a figure that
    // passed no rounding point of FX-07 — and this module has no rule to round
    // it by, which is why it refuses rather than rounds.
    expect(refusalOf(await prepare({ ...cash, amount: usd('10.00001') }))).toEqual({
      code: 'fin.line-amount-too-precise',
      values: { line: 1, amount: '10.00001', currency: 'USD', decimals: 4 },
    });
    // Arriving off a wire, the type is gone: a string, a float, a plain
    // object that once was money.
    for (const notMoney of ['10', 10, { amount: '10', currency: 'USD' }, null, undefined]) {
      expect(
        refusalOf(await prepare({ ...cash, amount: notMoney })).code,
        JSON.stringify(notMoney),
      ).toBe('fin.line-amount-invalid');
    }
    expect(refusalOf(await prepare({ ...cash, side: 'dr' }))).toEqual({
      code: 'fin.line-side-unknown',
      values: { line: 1, side: 'dr' },
    });
    expect(refusalOf(await prepare({ ...cash, memo: 42 }))).toEqual({
      code: 'fin.line-memo-invalid',
      values: { line: 1 },
    });
  });

  it('requires a line on an account kept in a currency to state its amount in that currency, and a stamp for every amount that was converted', async () => {
    const { fin } = shop;
    const prepare = (line: ArrivingLine) => fin.posting.prepare(fin.by, saleWith(shop, line));
    const stamp = newId<'rate-stamp'>();
    const pounds = money('131000', 'SYP');

    // The pound till's balance in pounds is read from these lines: a line on
    // it with no amount in pounds is a till nobody can count.
    expect(
      refusalOf(await prepare({ role: CASH_ROLE, currency: 'SYP', amount: usd('10') })),
    ).toEqual({
      code: 'fin.line-original-required',
      values: { line: 1 },
    });
    expect(
      refusalOf(
        await prepare({
          role: CASH_ROLE,
          currency: 'SYP',
          amount: usd('10'),
          original: money('9.25', 'EUR'),
          stamp,
        }),
      ),
    ).toEqual({
      code: 'fin.line-currency-mismatch',
      values: { line: 1, account: 'SYP', original: 'EUR' },
    });
    // The dollar till is kept in the functional currency; pounds on it are
    // pounds in the wrong drawer.
    expect(
      refusalOf(
        await prepare({
          role: CASH_ROLE,
          currency: 'USD',
          amount: usd('10'),
          original: pounds,
          stamp,
        }),
      ),
    ).toEqual({
      code: 'fin.line-currency-mismatch',
      values: { line: 1, account: 'USD', original: 'SYP' },
    });
    expect(
      refusalOf(
        await prepare({ role: REVENUE_ROLE, amount: usd('10'), original: usd('10'), stamp }),
      ),
    ).toEqual({ code: 'fin.line-original-is-functional', values: { line: 1, currency: 'USD' } });

    // An original and its stamp come together or not at all (FX-05).
    expect(
      refusalOf(
        await prepare({ role: CASH_ROLE, currency: 'SYP', amount: usd('10'), original: pounds }),
      ),
    ).toEqual({ code: 'fin.line-stamp-required', values: { line: 1 } });
    expect(refusalOf(await prepare({ role: REVENUE_ROLE, amount: usd('10'), stamp }))).toEqual({
      code: 'fin.line-original-required',
      values: { line: 1 },
    });
    expect(
      refusalOf(
        await prepare({
          role: CASH_ROLE,
          currency: 'SYP',
          amount: usd('10'),
          original: pounds,
          stamp: 'yesterday',
        }),
      ),
    ).toEqual({ code: 'fin.line-stamp-invalid', values: { line: 1, stamp: 'yesterday' } });

    for (const original of [money('0', 'SYP'), money('-5', 'SYP'), '131000']) {
      expect(
        refusalOf(
          await prepare({
            role: CASH_ROLE,
            currency: 'SYP',
            amount: usd('10'),
            original: original,
            stamp,
          }),
        ).code,
        JSON.stringify(original),
      ).toBe('fin.line-original-invalid');
    }
    expect(
      refusalOf(
        await prepare({
          role: CASH_ROLE,
          currency: 'SYP',
          amount: usd('10'),
          original: money('131000.005', 'SYP'),
          stamp,
        }),
      ),
    ).toEqual({
      code: 'fin.line-amount-too-precise',
      values: { line: 1, amount: '131000.005', currency: 'SYP', decimals: 2 },
    });
    expect(
      refusalOf(
        await prepare({
          role: REVENUE_ROLE,
          amount: usd('10'),
          original: money('7', 'GBP'),
          stamp,
        }),
      ),
    ).toEqual({ code: 'fin.line-currency-unknown', values: { line: 1, currency: 'GBP' } });
    expect(
      refusalOf(await prepare({ role: CASH_ROLE, currency: 'GBP', amount: usd('10') })),
    ).toEqual({
      code: 'fin.line-currency-unknown',
      values: { line: 1, currency: 'GBP' },
    });
  });

  it('resolves every line’s role through the chart, and refuses a role nobody has mapped by the line it is on', async () => {
    const { fin, accounts } = shop;

    // A fresh shop whose accountant has mapped nothing: the reserved roles
    // resolve on their own, and the one that needs a decision says so.
    const unmapped = await openShop();
    const expense = {
      ...sale(unmapped),
      lines: [
        { role: EXPENSE_ROLE, side: 'debit', amount: usd('10') },
        { role: CASH_ROLE, currency: 'USD', side: 'credit', amount: usd('10') },
      ] as const,
    };
    expect(refusalOf(await unmapped.fin.posting.prepare(unmapped.fin.by, expense))).toEqual({
      code: 'fin.account-role-unmapped',
      values: { role: EXPENSE_ROLE, line: 1 },
    });
    expect(
      refusalOf(await fin.posting.prepare(fin.by, saleWith(shop, { role: UNDECLARED_ROLE }))),
    ).toEqual({ code: 'fin.account-role-undeclared', values: { role: UNDECLARED_ROLE, line: 1 } });
    expect(
      refusalOf(
        await fin.posting.prepare(fin.by, saleWith(shop, { role: 7 } as unknown as ArrivingLine)),
      ),
    ).toEqual({ code: 'fin.account-role-undeclared', values: { role: '7', line: 1 } });
    // A cash role with no currency has nothing to resolve to.
    expect(
      refusalOf(
        await fin.posting.prepare(fin.by, saleWith(shop, { role: CASH_ROLE, currency: undefined })),
      ),
    ).toEqual({ code: 'fin.currency-required', values: { role: CASH_ROLE, line: 1 } });

    // Mapped, the role posts to the account the accountant chose — and a line
    // already posted keeps its account when the mapping moves (FIN-03).
    const rent = seeded(accounts, 'rent');
    taken(await fin.admin.map(fin.by, EXPENSE_ROLE, rent.id));
    const first = taken(await post(shop, { ...expense, branch: shop.branch }));
    expect(first.lines[0]?.account).toBe(rent.id);

    const utilities = seeded(accounts, 'utilities');
    taken(await fin.admin.map(fin.by, EXPENSE_ROLE, utilities.id));
    const second = taken(
      await post(shop, {
        ...expense,
        id: newId<'journal-entry'>(),
        source: { kind: 'csh.expense', document: newId<'expense'>() },
        branch: shop.branch,
      }),
    );
    expect(second.lines[0]?.account).toBe(utilities.id);
    expect((await fin.journal.entry(fin.by, first.entry.id))?.lines[0]?.account).toBe(rent.id);
  });

  it('posts one entry per business event: a replayed posting is answered with the entry the event already has, and moves nothing', async () => {
    const { fin } = shop;
    const draft = sale(shop);
    const first = taken(await post(shop, draft));

    // SYN-02 replays the command. It may carry the same draft, or — a command
    // that made its identifier afresh — a new identifier for the same event.
    const again = taken(await post(shop, draft));
    const afresh = taken(await post(shop, { ...draft, id: newId<'journal-entry'>() }));
    // A document reference is read in one spelling, as SYS reads it.
    const shouted = taken(
      await post(shop, {
        ...draft,
        id: newId<'journal-entry'>(),
        source: { ...draft.source, document: ` ${draft.source.document.toUpperCase()} ` },
      }),
    );

    expect(again).toEqual(first);
    expect(afresh).toEqual(first);
    expect(shouted).toEqual(first);
    expect(await fin.journal.entries(fin.by)).toEqual([first.entry]);
    // And the journal asked in either spelling answers about the same event.
    expect(
      await fin.journal.entryFor(fin.by, {
        ...draft.source,
        document: ` ${draft.source.document.toUpperCase()} `,
      }),
    ).toEqual(first);
    // Nothing moved: the next event takes the next number, not the fourth.
    expect(taken(await post(shop, sale(shop))).entry.number).toBe('2026-000002');
  });

  it('refuses a draft that names no event, no branch, or nothing to post', async () => {
    const { fin } = shop;
    const prepare = (draft: unknown) => fin.posting.prepare(fin.by, draft as EntryDraft);

    expect(refusalOf(await prepare(sale(shop, { id: 'sale-1' as EntryDraft['id'] })))).toEqual({
      code: 'fin.entry-id-invalid',
      values: { id: 'sale-1' },
    });
    for (const kind of ['sale', 'POS.Sale', 'pos.sale ', 'pos..sale', '']) {
      expect(
        refusalOf(await prepare(sale(shop, { source: { kind, document: 'x' } }))),
        kind,
      ).toEqual({ code: 'fin.source-kind-invalid', values: { kind } });
    }
    expect(
      refusalOf(await prepare(sale(shop, { source: { kind: 'pos.sale', document: '  ' } }))),
    ).toEqual({ code: 'fin.source-document-required', values: {} });

    const elsewhere = newId<'branch'>();
    expect(refusalOf(await prepare(sale(shop, { branch: elsewhere })))).toEqual({
      code: 'fin.branch-not-found',
      values: { branch: elsewhere },
    });
    // Another tenant's branch is as absent as one never opened.
    const theirs = fin.openBranch({ tenant: fin.otherTenant });
    expect(refusalOf(await prepare(sale(shop, { branch: theirs }))).code).toBe(
      'fin.branch-not-found',
    );
    const closed = fin.openBranch();
    fin.closeBranch(closed);
    expect(refusalOf(await prepare(sale(shop, { branch: closed })))).toEqual({
      code: 'fin.branch-inactive',
      values: { branch: closed },
    });

    expect(refusalOf(await prepare(sale(shop, { day: '2026-13-01' as LocalDate })))).toEqual({
      code: 'fin.day-invalid',
      values: { day: '2026-13-01' },
    });
    expect(refusalOf(await prepare(sale(shop, { description: ' . ' })))).toEqual({
      code: 'fin.description-invalid',
      values: {},
    });
    for (const lines of [[], undefined, 'two lines']) {
      expect(
        refusalOf(await prepare(sale(shop, { lines: lines as EntryDraft['lines'] }))).code,
        String(lines),
      ).toBe('fin.entry-empty');
    }
    // No draft at all is answered field by field, like any other.
    for (const nothing of [null, undefined, 'a sale']) {
      expect(refusalOf(await prepare(nothing)).code, String(nothing)).toBe('fin.entry-id-invalid');
    }
    // A description that is words is kept, trimmed.
    const described = taken(await post(shop, sale(shop, { description: '  بيع نقدي  ' })));
    expect(described.entry.description).toBe('بيع نقدي');
  });

  it('refuses to post until the tenant has said which currency its books are kept in', async () => {
    const { fin } = shop;
    fin.setFunctional(null);

    expect(refusalOf(await fin.posting.prepare(fin.by, sale(shop)))).toEqual({
      code: 'fin.functional-currency-unset',
      values: {},
    });
  });

  it('numbers an entry made at a register in that register’s own series, and one made anywhere else in the branch’s, each within its fiscal year', async () => {
    const { fin, branch } = shop;
    const till = fin.openRegister(branch, { prefix: 'T1' });
    const otherTill = fin.openRegister(branch, { prefix: 'T2' });

    const atTill = async (at: typeof till) => {
      const prepared = taken(await fin.posting.prepare(at.by, sale(shop)));
      return fin.run(at.by, async (uow) => taken(await fin.posting.post(uow, prepared)));
    };

    // SYS-02: a till counts under its own prefix and generation, from one, so
    // that two tills cut off from the store node never meet in a number.
    const first = await atTill(till);
    expect(first.entry).toMatchObject({
      number: 'T1-1-2026-000001',
      register: till.register,
      device: till.device,
      by: till.by.actor,
    });
    expect((await atTill(till)).entry.number).toBe('T1-1-2026-000002');
    expect((await atTill(otherTill)).entry.number).toBe('T2-1-2026-000001');
    // A machine's identifier arriving in another case — off a wire, out of
    // SYN-02's replay — is the same machine, at the same till, in the same
    // series; read raw, it would be a machine holding no till, and the entry
    // would take a branch number the till had already given it in its own.
    const shouted = commandContext({
      tenant: fin.tenant,
      actor: till.by.actor,
      device: till.device.toUpperCase() as DeviceId,
    });
    const third = taken(await fin.posting.prepare(shouted, sale(shop)));
    expect(third.register).toBe(till.register);
    expect(third.device).toBe(till.device);
    expect(
      (await fin.run(shouted, async (uow) => taken(await fin.posting.post(uow, third)))).entry
        .number,
    ).toBe('T1-1-2026-000003');
    // The back office, at no till, numbers in the branch's own series.
    expect(taken(await post(shop, sale(shop))).entry).toMatchObject({
      number: '2026-000001',
      register: null,
    });
    // A second branch is a second series.
    const elsewhere = fin.openBranch();
    expect(taken(await post(shop, sale(shop, { branch: elsewhere }))).entry.number).toBe(
      '2026-000001',
    );

    // The series turns with the fiscal year, under the label the year prints
    // as: one calendar year, or the two it spans.
    taken(await fin.calendarAdmin.append(fin.by));
    expect(taken(await post(shop, sale(shop, { day: day('2027-03-01') }))).entry.number).toBe(
      '2027-000001',
    );
    const spanning = await openShop();
    taken(
      await spanning.fin.calendarAdmin.redefine(spanning.fin.by, spanning.year.id, {
        opensOn: day('2026-04-01'),
        months: 12,
        monthsPerPeriod: 1,
      }),
    );
    expect(taken(await post(spanning, sale(spanning))).entry.number).toBe('2026-2027-000001');
  });

  it('passes on SYS’s refusal to number an entry, which is the one thing about the till that only the transaction can decide', async () => {
    const { fin, branch } = shop;
    const till = fin.openRegister(branch);
    const prepared = taken(await fin.posting.prepare(till.by, sale(shop)));

    // Prepared at the till and posted by a command run at no machine: the
    // series is the till's, and SYS numbers a till's documents only for the
    // machine standing at it.
    const outcome = await fin.run(fin.by, (uow) => fin.posting.post(uow, prepared));
    expect(refusalOf(outcome)).toEqual({
      code: 'fin.numbering-refused',
      values: { reason: 'sys.register-held-elsewhere', register: 'Till' },
    });
    expect(await fin.journal.entry(fin.by, prepared.id)).toBeNull();
    // That transaction committed — a refusal is a value, not a failure — and it
    // committed nothing: the period was not marked by a posting that did not
    // happen, so the year is still the accountant's to reshape.
    expect((await fin.calendar.years(fin.by))[0]!.periods[8]!.posted).toBe(false);
  });

  it('reads the journal in day order, then in the order entries were recorded, for one branch or all', async () => {
    const { fin, branch } = shop;
    const elsewhere = fin.openBranch();

    const late = taken(await post(shop, sale(shop, { day: day('2026-09-25') })));
    fin.clock.advance(1_000);
    const early = taken(await post(shop, sale(shop, { day: day('2026-09-01') })));
    fin.clock.advance(1_000);
    const sameDay = taken(
      await post(shop, sale(shop, { day: day('2026-09-25'), branch: elsewhere })),
    );
    fin.clock.advance(1_000);
    const august = taken(await post(shop, sale(shop, { day: day('2026-08-31') })));

    expect((await fin.journal.entries(fin.by)).map((one) => one.id)).toEqual([
      august.entry.id,
      early.entry.id,
      late.entry.id,
      sameDay.entry.id,
    ]);
    expect((await fin.journal.entries(fin.by, { branch })).map((one) => one.id)).toEqual([
      august.entry.id,
      early.entry.id,
      late.entry.id,
    ]);
    expect(
      (await fin.journal.entries(fin.by, { from: day('2026-09-01'), to: day('2026-09-24') })).map(
        (one) => one.id,
      ),
    ).toEqual([early.entry.id]);
    expect(await fin.journal.entries(fin.byOther)).toEqual([]);
    expect(await fin.journal.entry(fin.byOther, late.entry.id)).toBeNull();
    expect(await fin.journal.entryFor(fin.byOther, late.entry.source)).toBeNull();
  });

  it('reads an entry’s lines in the order they were drafted, however many there are', async () => {
    const { fin } = shop;
    // Ten dollars taken as ten single dollars: eleven lines, so that the tenth
    // sorts after the second by its place and not by its spelling.
    const posted = taken(
      await post(
        shop,
        sale(shop, {
          lines: [
            ...Array.from({ length: 10 }, (): DraftLine => ({
              role: CASH_ROLE,
              currency: 'USD',
              side: 'debit',
              amount: usd('1'),
            })),
            { role: REVENUE_ROLE, side: 'credit', amount: usd('10') },
          ],
        }),
      ),
    );

    const ordinals = Array.from({ length: 11 }, (_, index) => index + 1);
    expect(posted.lines.map((one) => one.ordinal)).toEqual(ordinals);
    expect(posted.lines.at(-1)?.side).toBe('credit');
    const read = await fin.journal.entry(fin.by, posted.entry.id);
    expect(read?.lines.map((one) => one.ordinal)).toEqual(ordinals);
    expect(read?.lines.at(-1)?.role).toBe(REVENUE_ROLE);
  });

  it('hands out a prepared entry, and a posted one, that nothing outside this module can edit', async () => {
    const { fin } = shop;
    const prepared = taken(await fin.posting.prepare(fin.by, sale(shop)));

    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.source)).toBe(true);
    expect(Object.isFrozen(prepared.lines)).toBe(true);
    expect(Object.isFrozen(prepared.lines[0])).toBe(true);
    expect(Object.isFrozen(prepared.lines[0]?.amount)).toBe(true);
    expect(Object.isFrozen(prepared.total)).toBe(true);

    const posted = await fin.run(fin.by, async (uow) =>
      taken(await fin.posting.post(uow, prepared)),
    );
    expect(Object.isFrozen(posted)).toBe(true);
    expect(Object.isFrozen(posted.entry)).toBe(true);
    expect(Object.isFrozen(posted.entry.source)).toBe(true);
    expect(Object.isFrozen(posted.lines)).toBe(true);
    expect(Object.isFrozen(posted.lines[1])).toBe(true);
    const read = await fin.journal.entry(fin.by, prepared.id);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read?.entry)).toBe(true);
    expect(Object.isFrozen(read?.lines[0]?.amount)).toBe(true);
  });

  it('raises rather than posts an entry prepared under another tenant', async () => {
    const { fin } = shop;
    const prepared = taken(await fin.posting.prepare(fin.by, sale(shop)));

    await expect(fin.run(fin.byOther, (uow) => fin.posting.post(uow, prepared))).rejects.toThrow(
      /another tenant/,
    );
    expect(await fin.journal.entry(fin.by, prepared.id)).toBeNull();
    expect(await fin.journal.entry(fin.byOther, prepared.id)).toBeNull();
  });
});

describe('Immutable entries — FIN-03', () => {
  it('has no code path that updates or deletes a posted journal line: the journal’s only writers append, and refuse a key already written', async () => {
    const { fin } = shop;

    // The whole surface anybody outside this module can reach the journal by.
    // Nothing here edits, and nothing deletes.
    expect(Object.keys(fin.posting).sort()).toEqual([
      'accept',
      'post',
      'prepare',
      'prepareReversal',
    ]);
    // The accountant writes by hand and opens the books (FIN-04, FIN-06),
    // and both go through the engine: neither is a way to a posted line.
    expect(Object.keys(fin.journalAdmin).sort()).toEqual(['open', 'record', 'reverse']);
    expect(Object.keys(fin.journal).sort()).toEqual([
      'attachment',
      'entries',
      'entry',
      'entryFor',
      'reversalOf',
    ]);
    expect(Object.keys(fin.exceptionsAdmin)).toEqual(['post']);

    // And beneath it, the writer of an entry refuses to write where an entry
    // already is — the same identifier for a second event is a defect, and it
    // raises rather than overwrites.
    const first = sale(shop);
    taken(await post(shop, first));
    const before = recordsOf(fin, first.id);
    const collision = taken(
      await fin.posting.prepare(fin.by, {
        ...sale(shop),
        id: first.id,
        lines: [
          { role: INVENTORY_ROLE, side: 'debit', amount: usd('25') },
          { role: CASH_ROLE, currency: 'USD', side: 'credit', amount: usd('25') },
        ],
      }),
    );
    await expect(fin.run(fin.by, (uow) => fin.posting.post(uow, collision))).rejects.toThrow(
      /already/,
    );
    expect(recordsOf(fin, first.id)).toEqual(before);
    expect((await fin.journal.entry(fin.by, first.id))?.entry.total.amount).toBe('10');
  });

  it('corrects a posted entry with a reversing entry that references the original, and leaves the original exactly as it was', async () => {
    const { fin, branch } = shop;
    const stamp = newId<'rate-stamp'>();
    const original = taken(
      await post(
        shop,
        sale(shop, {
          lines: [
            {
              role: CASH_ROLE,
              currency: 'SYP',
              side: 'debit',
              amount: usd('10'),
              original: money('131000', 'SYP'),
              stamp,
            },
            { role: REVENUE_ROLE, side: 'credit', amount: usd('10') },
          ],
        }),
      ),
    );
    const before = recordsOf(fin, original.entry.id);
    fin.clock.advance(60_000);

    const reversal = taken(
      await fin.journalAdmin.reverse(fin.by, original.entry.id, {
        day: day('2026-09-21'),
        reason: '  بيع مكرّر  ',
      }),
    );

    expect(reversal.entry).toMatchObject({
      number: '2026-000002',
      source: { kind: 'fin.reversal', document: original.entry.id },
      branch,
      register: null,
      day: '2026-09-21',
      description: 'بيع مكرّر',
      total: original.entry.total,
      reverses: original.entry.id,
      exception: null,
      by: fin.by.actor,
      at: fin.clock.now(),
    });
    // Every line on the other side, at the same amount, the same original and
    // the same stamp: a reversal undoes at the rate the original used.
    expect(figuresOf(reversal.lines)).toEqual(
      figuresOf(original.lines).map((line) => ({
        ...line,
        side: line.side === 'debit' ? 'credit' : 'debit',
      })),
    );
    expect(reversal.lines.map((one) => one.entry)).toEqual([reversal.entry.id, reversal.entry.id]);

    // The original: the same records, byte for byte, and the pointer beside it.
    expect(recordsOf(fin, original.entry.id).size).toBeGreaterThan(before.size);
    for (const [key, value] of before) {
      expect(fin.store.committed().get(key), key).toEqual(value);
    }
    expect(await fin.journal.entry(fin.by, original.entry.id)).toEqual(original);
    expect(await fin.journal.reversalOf(fin.by, original.entry.id)).toEqual({
      tenant: fin.tenant,
      original: original.entry.id,
      reversal: reversal.entry.id,
    });
    expect(await fin.journal.reversalOf(fin.by, reversal.entry.id)).toBeNull();
    expect(await fin.journal.entryFor(fin.by, reversal.entry.source)).toEqual(reversal);
  });

  it('reverses an entry once: a second reversal is refused, and a replayed one is answered with the first', async () => {
    const { fin } = shop;
    const original = taken(await post(shop, sale(shop)));
    const terms = { day: day('2026-09-21'), reason: 'خطأ في الإدخال' };

    // Two accountants, both preparing before either has posted.
    const one = taken(await fin.posting.prepareReversal(fin.by, original.entry.id, terms));
    const other = taken(
      await fin.posting.prepareReversal(fin.by, original.entry.id, { ...terms, reason: 'سبب آخر' }),
    );
    const first = taken(await fin.journalAdmin.reverse(fin.by, original.entry.id, terms));

    expect(refusalOf(await fin.journalAdmin.reverse(fin.by, original.entry.id, terms))).toEqual({
      code: 'fin.entry-already-reversed',
      values: { entry: original.entry.id, reversal: first.entry.id },
    });
    expect(
      refusalOf(await fin.posting.prepareReversal(fin.by, original.entry.id, terms)).code,
    ).toBe('fin.entry-already-reversed');
    // A reversal prepared before the first landed is a replay of the same
    // correction, and lands on what is there.
    for (const prepared of [one, other]) {
      expect(
        await fin.run(fin.by, async (uow) => taken(await fin.posting.post(uow, prepared))),
      ).toEqual(first);
    }
    expect(await fin.journal.entries(fin.by)).toHaveLength(2);

    // A reversal is an entry, and an entry is reversed: reversing the
    // reversal puts the original's figures back, as a new entry.
    const undone = taken(
      await fin.journalAdmin.reverse(fin.by, first.entry.id, { ...terms, reason: 'العكس كان خطأ' }),
    );
    expect(undone.entry.reverses).toBe(first.entry.id);
    expect(figuresOf(undone.lines)).toEqual(figuresOf(original.lines));
  });

  it('lets the module that owns an event reverse it inside the event’s own transaction, so a void and its entry commit together', async () => {
    const { fin } = shop;
    const original = taken(await post(shop, sale(shop)));
    const prepared = taken(
      await fin.posting.prepareReversal(fin.by, original.entry.id, {
        day: day('2026-09-20'),
        reason: 'إلغاء البيع',
      }),
    );

    await expect(
      fin.run(fin.by, async (uow) => {
        taken(await fin.posting.post(uow, prepared));
        throw new Error('the void would not write');
      }),
    ).rejects.toThrow('the void would not write');
    expect(await fin.journal.reversalOf(fin.by, original.entry.id)).toBeNull();
    expect(await fin.journal.entries(fin.by)).toEqual([original.entry]);

    const posted = await fin.run(fin.by, async (uow) =>
      taken(await fin.posting.post(uow, prepared)),
    );
    expect(posted.entry.reverses).toBe(original.entry.id);
    expect((await fin.journal.reversalOf(fin.by, original.entry.id))?.reversal).toBe(
      posted.entry.id,
    );
  });

  it('refuses a reversal with no written reason, dated before the original, into a closed period, or of an entry the tenant does not have', async () => {
    const { fin, year } = shop;
    const original = taken(await post(shop, sale(shop)));
    const reverse = (entry: string, terms: unknown) =>
      fin.journalAdmin.reverse(
        fin.by,
        entry as Parameters<typeof fin.journalAdmin.reverse>[1],
        terms as Parameters<typeof fin.journalAdmin.reverse>[2],
      );

    for (const reason of [' - ', '', 42, undefined]) {
      expect(
        refusalOf(await reverse(original.entry.id, { day: day('2026-09-21'), reason })),
        String(reason),
      ).toEqual({ code: 'fin.reversal-reason-required', values: { entry: original.entry.id } });
    }
    expect(
      refusalOf(await reverse(original.entry.id, { day: day('2026-09-19'), reason: 'سبب' })),
    ).toEqual({
      code: 'fin.reversal-before-original',
      values: { entry: original.entry.id, day: '2026-09-19', original: '2026-09-20' },
    });
    expect(
      refusalOf(await reverse(original.entry.id, { day: '2026-9-21', reason: 'سبب' })),
    ).toEqual({
      code: 'fin.day-invalid',
      values: { day: '2026-9-21' },
    });
    expect(refusalOf(await reverse(original.entry.id, null)).code).toBe(
      'fin.reversal-reason-required',
    );

    taken(await fin.calendarAdmin.close(fin.by, year.periods[9]!.id));
    expect(
      refusalOf(await reverse(original.entry.id, { day: day('2026-10-05'), reason: 'سبب' })),
    ).toEqual({
      code: 'fin.period-closed',
      values: { day: '2026-10-05', period: year.periods[9]!.id },
    });

    const unknown = newId<'journal-entry'>();
    expect(refusalOf(await reverse(unknown, { day: day('2026-09-21'), reason: 'سبب' }))).toEqual({
      code: 'fin.entry-not-found',
      values: { entry: unknown },
    });
    expect(
      refusalOf(
        await fin.journalAdmin.reverse(fin.byOther, original.entry.id, {
          day: day('2026-09-21'),
          reason: 'سبب',
        }),
      ),
    ).toEqual({ code: 'fin.entry-not-found', values: { entry: original.entry.id } });
    expect(await fin.journal.reversalOf(fin.by, original.entry.id)).toBeNull();
  });
});

describe('Who may correct the journal', () => {
  it('asks the accountant’s right to reverse, tenant-wide, and refuses before anything is written', async () => {
    const { fin } = shop;
    const original = taken(await post(shop, sale(shop)));
    const asked: string[] = [];
    fin.answers((by, right, where) => {
      expect(by).toBe(fin.by);
      expect(where).toBeUndefined();
      asked.push(right);
      return false;
    });

    expect(
      refusalOf(
        await fin.journalAdmin.reverse(fin.by, original.entry.id, {
          day: day('2026-09-21'),
          reason: 'سبب',
        }),
      ),
    ).toEqual({
      code: 'fin.not-permitted',
      values: { right: FIN_PERMISSIONS.journalEntry.reverse },
    });
    expect(asked).toEqual([FIN_PERMISSIONS.journalEntry.reverse]);
    expect(await fin.journal.entries(fin.by)).toEqual([original.entry]);
    expect(await fin.journal.reversalOf(fin.by, original.entry.id)).toBeNull();
  });

  it('declares the rights over the journal and the exceptions queue, and seeds them to whoever reads and keeps the books', () => {
    const declared = new Map(FIN_PERMISSION_SEEDS.map((one) => [one.id, one]));
    const { journalEntry, openingBalance, postingException } = FIN_PERMISSIONS;

    expect(
      [...declared.keys()].filter((id) =>
        /^fin\.(journal-entry|opening-balance|posting-exception)\./.test(id),
      ),
    ).toEqual([
      'fin.journal-entry.view',
      'fin.journal-entry.create',
      'fin.journal-entry.reverse',
      'fin.opening-balance.create',
      'fin.posting-exception.view',
      'fin.posting-exception.resolve',
    ]);
    for (const right of [journalEntry.view, postingException.view]) {
      expect(declared.get(right)?.seededFor).toEqual(['manager', 'accountant']);
    }
    for (const right of [
      journalEntry.create,
      journalEntry.reverse,
      openingBalance.create,
      postingException.resolve,
    ]) {
      expect(declared.get(right)?.seededFor).toEqual(['accountant']);
      expect(declared.get(right)?.sensitive).toBeUndefined();
    }
    // No edit and no delete over a journal entry exist to be granted (FIN-03).
    expect(
      [...declared.keys()].filter((id) => /^fin.journal-entry.(edit|delete)$/.test(id)),
    ).toEqual([]);
    // Every right this module asks a command about is one it declares.
    expect(shop.fin.registry.module('FIN')?.permissions.map((one) => one.id)).toEqual([
      ...declared.keys(),
    ]);
  });
});
