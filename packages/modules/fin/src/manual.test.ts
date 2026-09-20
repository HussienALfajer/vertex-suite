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
import { FX_PERMISSIONS } from '@vertex/fx/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ATTACHMENT_SIZE_LIMIT,
  CONTROL_ACCOUNTS,
  FIN_ENTRY_KINDS,
  FIN_PERMISSION_SEEDS,
  FIN_PERMISSIONS,
  type Account,
  type AttachmentUpload,
  type FiscalYear,
  type JournalLine,
  type ManualEntry,
  type ManualLine,
} from './contract.js';
import { installFin, type Installed } from './edition.fixture.js';

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

function syp(amount: string) {
  return money(amount, 'SYP');
}

/** What a line says about the books, and nothing about how it was recorded. */
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

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.codePointAt(0) ?? 0);
}

/**
 * Four files, one of each kind that may be attached, with their SHA-256 as
 * `sha256sum` reports it — computed outside this suite, so that what the
 * module writes down is checked against an independent reading of the bytes.
 */
const PDF: AttachmentUpload = {
  name: 'invoice-0042.pdf',
  mediaType: 'application/pdf',
  bytes: bytesOf('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'),
};
const PDF_SHA256 = '904636248025ad20fb9c6bd8b700179a2a42edb5df3636e926c7e09055ee3f75';

const PNG: AttachmentUpload = {
  name: 'receipt.png',
  mediaType: 'image/png',
  bytes: Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]),
};
const PNG_SHA256 = '02a3e298f1533f62558c58e4c70edcab9af5a50d62d925fd5390942020fb0fb8';

const JPEG: AttachmentUpload = {
  name: 'receipt.jpg',
  mediaType: 'image/jpeg',
  bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
};
const JPEG_SHA256 = '23e5c96c789570b1a740a7463526bb846d97506642e12a6a5e6b9b3b7a90cd5f';

const WEBP: AttachmentUpload = {
  name: 'receipt.webp',
  mediaType: 'image/webp',
  bytes: Uint8Array.from([...bytesOf('RIFF'), 0x1a, 0, 0, 0, ...bytesOf('WEBPVP8 ')]),
};
const WEBP_SHA256 = '347ce8f11c673e117e9bac7cebbfc3fc174a4dd2536b8c270cf55346585abedb';

/**
 * A shop whose accountant is about to adjust the books: the chart and the
 * calendar seeded, one branch, and today's board for the pound at it.
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
  // Thirteen thousand pounds to the dollar on receipt, thirteen thousand one
  // hundred when paid out: a spread wide enough that the side shows.
  fin.setRate(branch, 'SYP', { buy: '13000', sell: '13100' });
  return { fin, branch, accounts, year: year! };
}

/** An accrual of a hundred dollars of rent: the simplest adjusting entry. */
function accrual(shop: Shop, changes: Partial<ManualEntry> = {}): ManualEntry {
  return {
    id: newId<'journal-entry'>(),
    branch: shop.branch,
    day: day('2026-09-20'),
    description: 'إيجار أيلول المستحق',
    lines: [
      { account: seeded(shop.accounts, 'rent').id, side: 'debit', amount: usd('100') },
      { account: seeded(shop.accounts, 'accrued-expenses').id, side: 'credit', amount: usd('100') },
    ],
    ...changes,
  };
}

/**
 * The same accrual with its first line replaced, which is how one line at a
 * time is put on trial — with whatever a screen might actually hand in, not
 * only what the type allows, since the type is gone by the time it arrives.
 */
type ArrivingLine = Readonly<Record<string, unknown>>;

function accrualWith(shop: Shop, line: ArrivingLine): ManualEntry {
  const draft = accrual(shop);
  const [first, second] = draft.lines as [ManualLine, ManualLine];
  return { ...draft, lines: [{ ...first, ...line }, second] };
}

let shop: Shop;

beforeEach(async () => {
  shop = await openShop();
});

describe('Manual journal entry — FIN-04', () => {
  it('records an adjusting entry the accountant writes by account, with its description, through the engine every event posts through', async () => {
    const { fin, branch, accounts, year } = shop;
    const draft = accrual(shop);

    const posted = taken(await fin.journalAdmin.record(fin.by, draft));

    expect(posted.entry).toEqual({
      id: draft.id,
      tenant: fin.tenant,
      number: '2026-000001',
      lineCount: 2,
      attachmentCount: 0,
      source: { kind: FIN_ENTRY_KINDS.manualEntry, document: draft.id },
      branch,
      register: null,
      day: '2026-09-20',
      period: year.periods[8]!.id,
      description: 'إيجار أيلول المستحق',
      total: { amount: '100', currency: 'USD' },
      reverses: null,
      exception: null,
      by: fin.by.actor,
      device: null,
      at: fin.clock.now(),
    });
    // By account and not by role: a line the accountant placed has none.
    expect(posted.lines).toEqual([
      {
        id: posted.lines[0]!.id,
        tenant: fin.tenant,
        entry: draft.id,
        ordinal: 1,
        account: seeded(accounts, 'rent').id,
        role: null,
        side: 'debit',
        amount: { amount: '100', currency: 'USD' },
        original: null,
        stamp: null,
        memo: null,
      },
      {
        id: posted.lines[1]!.id,
        tenant: fin.tenant,
        entry: draft.id,
        ordinal: 2,
        account: seeded(accounts, 'accrued-expenses').id,
        role: null,
        side: 'credit',
        amount: { amount: '100', currency: 'USD' },
        original: null,
        stamp: null,
        memo: null,
      },
    ]);
    expect(posted.attachments).toEqual([]);
    expect(await fin.journal.entry(fin.by, draft.id)).toEqual(posted);
    expect(await fin.journal.entryFor(fin.by, posted.entry.source)).toEqual(posted);
    expect((await fin.calendar.years(fin.by))[0]!.periods[8]!.posted).toBe(true);

    // Submitted twice — the button pressed again, the command replayed — it
    // is one entry, and the next one takes the next number.
    expect(taken(await fin.journalAdmin.record(fin.by, draft))).toEqual(posted);
    expect(await fin.journal.entries(fin.by)).toEqual([posted.entry]);
    expect(taken(await fin.journalAdmin.record(fin.by, accrual(shop))).entry.number).toBe(
      '2026-000002',
    );
  });

  it('requires a written description, and keeps a memo on a line when there is one', async () => {
    const { fin } = shop;
    const record = (draft: unknown) => fin.journalAdmin.record(fin.by, draft as ManualEntry);

    for (const description of [undefined, null, '', '   ', ' - ', '2026', 42]) {
      expect(
        refusalOf(await record({ ...accrual(shop), description })),
        JSON.stringify(description),
      ).toEqual({ code: 'fin.description-required', values: {} });
    }
    expect(await fin.journal.entries(fin.by)).toEqual([]);

    const posted = taken(
      await record({
        ...accrual(shop),
        description: '  تسوية نهاية الشهر  ',
        lines: [
          ...accrualWith(shop, { memo: '  عقد الإيجار رقم ٣  ' }).lines.slice(0, 1),
          ...accrual(shop).lines.slice(1),
        ],
      }),
    );
    expect(posted.entry.description).toBe('تسوية نهاية الشهر');
    expect(posted.lines[0]?.memo).toBe('عقد الإيجار رقم ٣');
  });

  it('names an account in whatever case its identifier arrives in, as every identifier in this system is read', async () => {
    const { fin, accounts } = shop;
    const rent = seeded(accounts, 'rent');

    // Off a wire, a UUID may arrive upper-cased; it is the same account, and
    // read raw it would be an account that is not there.
    const posted = taken(
      await fin.journalAdmin.record(fin.by, accrualWith(shop, { account: rent.id.toUpperCase() })),
    );
    expect(posted.lines[0]?.account).toBe(rent.id);
  });

  it('keeps what the accountant attaches by its SHA-256, with the bytes outside the record store and verified when they are read back', async () => {
    const { fin } = shop;
    const draft = accrual(shop, { attachments: [PDF, PNG, JPEG, WEBP, PDF] });

    const posted = taken(await fin.journalAdmin.record(fin.by, draft));

    expect(posted.entry.attachmentCount).toBe(5);
    expect(posted.attachments).toEqual(
      [
        [PDF, PDF_SHA256],
        [PNG, PNG_SHA256],
        [JPEG, JPEG_SHA256],
        [WEBP, WEBP_SHA256],
        [PDF, PDF_SHA256],
      ].map(([upload, sha256], index) => ({
        id: posted.attachments[index]!.id,
        tenant: fin.tenant,
        entry: draft.id,
        ordinal: index + 1,
        name: (upload as AttachmentUpload).name,
        mediaType: (upload as AttachmentUpload).mediaType,
        size: (upload as AttachmentUpload).bytes.length,
        sha256,
      })),
    );
    expect(await fin.journal.entry(fin.by, draft.id)).toEqual(posted);

    // The bytes went to the host's store under a key made of the tenant and
    // the hash — the same file attached twice is one file — and no record
    // holds them.
    expect(fin.attachments.keys()).toEqual(
      [PDF_SHA256, PNG_SHA256, JPEG_SHA256, WEBP_SHA256]
        .map((sha256) => `fin/attachment/${fin.tenant}/${sha256}`)
        .sort(),
    );
    for (const [key, value] of fin.store.committed()) {
      expect(JSON.stringify(value).includes('"0":37'), key).toBe(false);
    }

    // Read back by place, verified, and only by the tenant that attached it.
    const first = await fin.journal.attachment(fin.by, draft.id, 1);
    expect(first?.attachment).toEqual(posted.attachments[0]);
    expect(first?.bytes).toEqual(PDF.bytes);
    expect((await fin.journal.attachment(fin.by, draft.id, 5))?.bytes).toEqual(PDF.bytes);
    expect((await fin.journal.attachment(fin.by, draft.id, 4))?.bytes).toEqual(WEBP.bytes);
    expect(await fin.journal.attachment(fin.by, draft.id, 6)).toBeNull();
    expect(await fin.journal.attachment(fin.by, draft.id, 0)).toBeNull();
    expect(await fin.journal.attachment(fin.byOther, draft.id, 1)).toBeNull();
    expect(await fin.journal.attachment(fin.by, newId<'journal-entry'>(), 1)).toBeNull();

    // Bytes the store has lost or altered are a defect in the store, and the
    // hash on the entry is what catches it: they are never handed out as the
    // evidence they no longer are.
    fin.attachments.corrupt(`fin/attachment/${fin.tenant}/${PNG_SHA256}`, PDF.bytes);
    await expect(fin.journal.attachment(fin.by, draft.id, 2)).rejects.toThrow(/SHA-256/);
    fin.attachments.corrupt(`fin/attachment/${fin.tenant}/${JPEG_SHA256}`, null);
    await expect(fin.journal.attachment(fin.by, draft.id, 3)).rejects.toThrow(/missing/);
  });

  it('refuses an attachment that is not a PDF or an image, that is empty, that is over ten megabytes, or whose bytes are not what its type says', async () => {
    const { fin } = shop;
    const record = (attachments: readonly unknown[]) =>
      fin.journalAdmin.record(fin.by, {
        ...accrual(shop),
        attachments: attachments as readonly AttachmentUpload[],
      });

    expect(refusalOf(await record([PDF, { ...PDF, mediaType: 'text/html' }]))).toEqual({
      code: 'fin.attachment-type-unsupported',
      values: { attachment: 2, mediaType: 'text/html' },
    });
    expect(refusalOf(await record([{ ...PDF, mediaType: 'application/x-msdownload' }])).code).toBe(
      'fin.attachment-type-unsupported',
    );
    // A label is a claim; the bytes are the fact.
    expect(refusalOf(await record([{ ...PNG, bytes: PDF.bytes }]))).toEqual({
      code: 'fin.attachment-content-mismatch',
      values: { attachment: 1, mediaType: 'image/png' },
    });
    expect(refusalOf(await record([{ ...PDF, bytes: bytesOf('<html>') }])).code).toBe(
      'fin.attachment-content-mismatch',
    );
    expect(refusalOf(await record([{ ...JPEG, bytes: WEBP.bytes }])).code).toBe(
      'fin.attachment-content-mismatch',
    );
    // Two bytes of a JPEG's three-byte marker are not a JPEG.
    expect(
      refusalOf(await record([{ ...JPEG, bytes: Uint8Array.from([0xff, 0xd8, 0x00, 0x10]) }])).code,
    ).toBe('fin.attachment-content-mismatch');
    expect(refusalOf(await record([{ ...WEBP, bytes: JPEG.bytes }])).code).toBe(
      'fin.attachment-content-mismatch',
    );
    expect(refusalOf(await record([{ ...PDF, bytes: new Uint8Array(0) }]))).toEqual({
      code: 'fin.attachment-invalid',
      values: { attachment: 1 },
    });
    for (const notAFile of [
      { ...PDF, name: '' },
      { ...PDF, name: '   ' },
      { ...PDF, name: 7 },
      { ...PDF, bytes: '%PDF-1.7' },
      { ...PDF, bytes: [0x25, 0x50, 0x44, 0x46] },
      null,
      'invoice.pdf',
    ]) {
      expect(refusalOf(await record([notAFile])), JSON.stringify(notAFile)).toEqual({
        code: 'fin.attachment-invalid',
        values: { attachment: 1 },
      });
    }
    expect(refusalOf(await record('invoice.pdf' as unknown as unknown[]))).toEqual({
      code: 'fin.attachment-invalid',
      values: {},
    });

    const oversized = new Uint8Array(ATTACHMENT_SIZE_LIMIT + 1);
    oversized.set(PDF.bytes);
    expect(refusalOf(await record([{ ...PDF, bytes: oversized }]))).toEqual({
      code: 'fin.attachment-too-large',
      values: { attachment: 1, size: ATTACHMENT_SIZE_LIMIT + 1, limit: ATTACHMENT_SIZE_LIMIT },
    });
    const atTheLimit = new Uint8Array(ATTACHMENT_SIZE_LIMIT);
    atTheLimit.set(PDF.bytes);
    const kept = taken(await record([{ ...PDF, name: '  scan 0042.pdf  ', bytes: atTheLimit }]));
    expect(kept.attachments[0]).toMatchObject({
      size: ATTACHMENT_SIZE_LIMIT,
      name: 'scan 0042.pdf',
    });

    // Nothing was kept for any of the refused ones.
    expect(fin.attachments.keys()).toHaveLength(1);
    expect(await fin.journal.entries(fin.by)).toHaveLength(1);
  });

  it('values a line stated in another currency at the branch’s rate today, on the side the line’s own side selects, and stamps it in the same transaction', async () => {
    const { fin, accounts } = shop;

    // Five million pounds of rent accrued: the debit is money received, at
    // thirteen thousand; the ledger carries what that comes to in dollars,
    // and the line keeps the pounds and the stamp beside it (FX-05).
    const received = taken(
      await fin.journalAdmin.record(fin.by, {
        ...accrual(shop),
        lines: [
          { account: seeded(accounts, 'rent').id, side: 'debit', amount: syp('5000000') },
          {
            account: seeded(accounts, 'accrued-expenses').id,
            side: 'credit',
            amount: usd('384.6154'),
          },
        ],
      }),
    );
    const [stamp] = fin.stamps();
    expect(received.lines[0]).toMatchObject({
      role: null,
      amount: { amount: '384.6154', currency: 'USD' },
      original: { amount: '5000000', currency: 'SYP' },
      stamp: stamp!.id,
    });
    expect(received.entry.total).toEqual({ amount: '384.6154', currency: 'USD' });
    expect(stamp).toMatchObject({
      currency: 'SYP',
      functional: 'USD',
      direction: 'received',
      side: 'buy',
      rate: '13000',
      day: '2026-09-20',
      override: null,
      stampedBy: fin.by.actor,
    });
    expect(fin.stamps()).toHaveLength(1);

    // A credit in pounds is money paid out, and takes the sell side.
    const paidOut = taken(
      await fin.journalAdmin.record(fin.by, {
        ...accrual(shop),
        lines: [
          { account: seeded(accounts, 'rent').id, side: 'debit', amount: usd('381.6794') },
          {
            account: seeded(accounts, 'accrued-expenses').id,
            side: 'credit',
            amount: syp('5000000'),
          },
        ],
      }),
    );
    expect(paidOut.lines[1]).toMatchObject({
      amount: { amount: '381.6794', currency: 'USD' },
      original: { amount: '5000000', currency: 'SYP' },
    });
    expect(fin.stamps()[1]).toMatchObject({
      id: paidOut.lines[1]!.stamp,
      direction: 'paid-out',
      side: 'sell',
      rate: '13100',
    });
  });

  it('lets the accountant type a rate over the day’s, under FX’s own right and with a reason, and logs it as FX logs every override', async () => {
    const { fin, branch, accounts } = shop;
    const asked: { right: string; where: unknown }[] = [];
    fin.answers((_by, right, where) => {
      asked.push({ right, where });
      return true;
    });
    const override = {
      form: 'units-per-functional',
      rate: '12500',
      reason: 'سعر الشراء الفعلي',
    } as const;

    const posted = taken(
      await fin.journalAdmin.record(fin.by, {
        ...accrual(shop),
        lines: [
          { account: seeded(accounts, 'rent').id, side: 'debit', amount: syp('5000000'), override },
          { account: seeded(accounts, 'accrued-expenses').id, side: 'credit', amount: usd('400') },
        ],
      }),
    );

    expect(posted.lines[0]?.amount).toEqual({ amount: '400', currency: 'USD' });
    expect(fin.stamps()[0]).toMatchObject({ rate: '12500', side: 'buy' });
    expect(fin.overrides()).toHaveLength(1);
    expect(fin.overrides()[0]).toMatchObject({
      stamp: posted.lines[0]!.stamp,
      automatic: '13000',
      applied: '12500',
      reason: 'سعر الشراء الفعلي',
      by: fin.by.actor,
    });
    expect(fin.stamps()[0]?.override).toBe(fin.overrides()[0]?.id);
    // FIN's own right first, tenant-wide; then FX's, at the branch, asked by FX.
    expect(asked).toEqual([
      { right: FIN_PERMISSIONS.journalEntry.create, where: undefined },
      { right: FX_PERMISSIONS.rate.override, where: { branch } },
    ]);

    // FX's refusals of an override come back naming the line.
    const refused = (line: ArrivingLine) =>
      fin.journalAdmin.record(fin.by, accrualWith(shop, line));
    expect(
      refusalOf(await refused({ amount: syp('5000000'), override: { ...override, reason: '' } })),
    ).toEqual({ code: 'fx.override-reason-required', values: { line: 1 } });
    fin.answers((_by, right) => right !== FX_PERMISSIONS.rate.override);
    expect(refusalOf(await refused({ amount: syp('5000000'), override }))).toEqual({
      code: 'fx.not-permitted',
      values: { line: 1, right: FX_PERMISSIONS.rate.override },
    });
    // An override on a line already in the functional currency has no rate to replace.
    expect(refusalOf(await refused({ amount: usd('100'), override }))).toEqual({
      code: 'fin.line-override-on-functional',
      values: { line: 1 },
    });
    expect(fin.stamps()).toHaveLength(1);
  });

  it('balances the entry in the functional currency exactly, as valued — the two sides of one currency at two rates differ by the spread, which is the exchange difference’s line to carry', async () => {
    const { fin, accounts } = shop;
    const bothInPounds: ManualLine[] = [
      { account: seeded(accounts, 'rent').id, side: 'debit', amount: syp('5000000') },
      { account: seeded(accounts, 'accrued-expenses').id, side: 'credit', amount: syp('5000000') },
    ];

    expect(
      refusalOf(await fin.journalAdmin.record(fin.by, { ...accrual(shop), lines: bothInPounds })),
    ).toEqual({
      code: 'fin.entry-unbalanced',
      values: { debits: '384.6154', credits: '381.6794', currency: 'USD' },
    });
    // Refused before anything was written: no stamp for either line.
    expect(fin.stamps()).toEqual([]);
    expect(await fin.journal.entries(fin.by)).toEqual([]);

    const posted = taken(
      await fin.journalAdmin.record(fin.by, {
        ...accrual(shop),
        lines: [
          ...bothInPounds,
          { account: seeded(accounts, 'fx-gain-loss').id, side: 'credit', amount: usd('2.936') },
        ],
      }),
    );
    expect(posted.entry.total).toEqual({ amount: '384.6154', currency: 'USD' });
    expect(posted.lines.map((one) => one.stamp === null)).toEqual([false, false, true]);
    expect(fin.stamps()).toHaveLength(2);
  });

  it('refuses a line onto an account the system keeps from its own documents — inventory, cash, customer and supplier balances — and takes one onto any other reserved account', async () => {
    const { fin, accounts } = shop;
    const record = (line: ArrivingLine) => fin.journalAdmin.record(fin.by, accrualWith(shop, line));

    expect(CONTROL_ACCOUNTS).toEqual(['inventory', 'cash', 'receivables', 'payables']);
    for (const [account, reserved] of [
      [seeded(accounts, 'merchandise-inventory'), 'inventory'],
      [cashIn(accounts, 'USD'), 'cash'],
      [seeded(accounts, 'trade-receivables'), 'receivables'],
      [seeded(accounts, 'trade-payables'), 'payables'],
    ] as const) {
      expect(refusalOf(await record({ account: account.id })), reserved).toEqual({
        code: 'fin.account-controlled',
        values: { line: 1, account: account.id, reserved },
      });
    }
    // The pound till, even with the amount in pounds: a till is counted from
    // its movements, and this is not one.
    expect(
      refusalOf(await record({ account: cashIn(accounts, 'SYP').id, amount: syp('1300000') })).code,
    ).toBe('fin.account-controlled');
    expect(await fin.journal.entries(fin.by)).toEqual([]);

    // Closing opening-balance equity into capital at the first year end is
    // the ordinary adjusting entry, and the exchange and rounding differences
    // are results the accountant may well correct.
    for (const seed of [
      'opening-balance-equity',
      'fx-gain-loss',
      'rounding-differences',
      'cost-of-goods-sold',
      'inventory-shrinkage',
    ]) {
      expect(isOk(await record({ account: seeded(accounts, seed).id })), seed).toBe(true);
    }
  });

  it('refuses a line on an account that is not there, withdrawn, a group, or another tenant’s, and a line whose amount is not money the tenant has', async () => {
    const { fin, accounts } = shop;
    const record = (line: ArrivingLine) => fin.journalAdmin.record(fin.by, accrualWith(shop, line));

    const unknown = newId<'account'>();
    expect(refusalOf(await record({ account: unknown }))).toEqual({
      code: 'fin.account-not-found',
      values: { line: 1, account: unknown },
    });
    expect(refusalOf(await record({ account: 'rent' }))).toEqual({
      code: 'fin.account-not-found',
      values: { line: 1, account: 'rent' },
    });
    expect(refusalOf(await record({ account: seeded(accounts, 'expenses').id }))).toEqual({
      code: 'fin.account-is-group',
      values: { line: 1, account: seeded(accounts, 'expenses').id },
    });
    const withdrawn = seeded(accounts, 'bank-charges');
    taken(await fin.admin.withdraw(fin.by, withdrawn.id));
    expect(refusalOf(await record({ account: withdrawn.id }))).toEqual({
      code: 'fin.account-inactive',
      values: { line: 1, account: withdrawn.id },
    });
    // Another tenant's account is as absent as one that never existed.
    const theirs = taken(await fin.admin.seed(fin.byOther));
    expect(refusalOf(await record({ account: seeded(theirs, 'rent').id })).code).toBe(
      'fin.account-not-found',
    );

    expect(refusalOf(await record({ side: 'dr' }))).toEqual({
      code: 'fin.line-side-unknown',
      values: { line: 1, side: 'dr' },
    });
    for (const amount of ['0', '-10']) {
      expect(refusalOf(await record({ amount: usd(amount) })), amount).toEqual({
        code: 'fin.line-amount-invalid',
        values: { line: 1, amount },
      });
    }
    for (const notMoney of ['100', 100, { amount: '100', currency: 'USD' }, null, undefined]) {
      expect(refusalOf(await record({ amount: notMoney })).code, JSON.stringify(notMoney)).toBe(
        'fin.line-amount-invalid',
      );
    }
    expect(refusalOf(await record({ amount: usd('100.00001') }))).toEqual({
      code: 'fin.line-amount-too-precise',
      values: { line: 1, amount: '100.00001', currency: 'USD', decimals: 4 },
    });
    expect(refusalOf(await record({ amount: syp('1300000.005') }))).toEqual({
      code: 'fin.line-amount-too-precise',
      values: { line: 1, amount: '1300000.005', currency: 'SYP', decimals: 2 },
    });
    expect(refusalOf(await record({ amount: money('70', 'GBP') }))).toEqual({
      code: 'fin.line-currency-unknown',
      values: { line: 1, currency: 'GBP' },
    });
    expect(refusalOf(await record({ memo: 42 }))).toEqual({
      code: 'fin.line-memo-invalid',
      values: { line: 1 },
    });
    // A currency the tenant has and the branch has no rate for today (FX-04).
    expect(refusalOf(await record({ amount: money('100', 'EUR') }))).toEqual({
      code: 'fx.rate-missing',
      values: { line: 1, branch: shop.branch, currency: 'EUR', day: '2026-09-20' },
    });
    // A pound amount worth less than the last place the books keep is worth
    // nothing in them, and a line of nothing is refused as one is for every
    // module's draft — not written as a nought that balances against another.
    expect(refusalOf(await record({ amount: syp('0.01') }))).toEqual({
      code: 'fin.line-amount-valueless',
      values: { line: 1, amount: '0.01', currency: 'SYP', functional: 'USD' },
    });
    expect(
      refusalOf(
        await fin.journalAdmin.record(fin.by, {
          ...accrual(shop),
          lines: [
            { account: seeded(accounts, 'rent').id, side: 'debit', amount: syp('0.01') },
            {
              account: seeded(accounts, 'accrued-expenses').id,
              side: 'credit',
              amount: syp('0.01'),
            },
          ],
        }),
      ).code,
    ).toBe('fin.line-amount-valueless');
    expect(await fin.journal.entries(fin.by)).toEqual([]);
    expect(fin.stamps()).toEqual([]);
  });

  it('refuses an entry that names no branch that trades, no day in an open period, or nothing to post — and one whose lines are not lines', async () => {
    const { fin, year } = shop;
    const record = (draft: unknown) => fin.journalAdmin.record(fin.by, draft as ManualEntry);

    expect(refusalOf(await record({ ...accrual(shop), id: 'adjustment-1' }))).toEqual({
      code: 'fin.entry-id-invalid',
      values: { id: 'adjustment-1' },
    });
    const elsewhere = newId<'branch'>();
    expect(refusalOf(await record(accrual(shop, { branch: elsewhere })))).toEqual({
      code: 'fin.branch-not-found',
      values: { branch: elsewhere },
    });
    const closed = fin.openBranch();
    fin.closeBranch(closed);
    expect(refusalOf(await record(accrual(shop, { branch: closed })))).toEqual({
      code: 'fin.branch-inactive',
      values: { branch: closed },
    });
    expect(refusalOf(await record({ ...accrual(shop), day: '20/09/2026' }))).toEqual({
      code: 'fin.day-invalid',
      values: { day: '20/09/2026' },
    });
    for (const lines of [[], undefined, 'two lines']) {
      expect(refusalOf(await record({ ...accrual(shop), lines })).code, String(lines)).toBe(
        'fin.entry-empty',
      );
    }
    for (const nothing of [null, undefined, 'an adjustment']) {
      expect(refusalOf(await record(nothing)).code, String(nothing)).toBe('fin.entry-id-invalid');
    }

    taken(await fin.calendarAdmin.close(fin.by, year.periods[8]!.id));
    expect(refusalOf(await record(accrual(shop)))).toEqual({
      code: 'fin.period-closed',
      values: { day: '2026-09-20', period: year.periods[8]!.id },
    });
    expect(refusalOf(await record(accrual(shop, { day: day('2025-12-31') })))).toEqual({
      code: 'fin.day-outside-calendar',
      values: { day: '2025-12-31' },
    });
    expect(await fin.journal.entries(fin.by)).toEqual([]);
  });

  it('leaves nothing behind when the entry cannot be written: the stamps and the attachment records go with it, and the bytes are only ever kept under their hash', async () => {
    const { fin, accounts, year } = shop;
    const draft: ManualEntry = {
      ...accrual(shop),
      lines: [
        { account: seeded(accounts, 'rent').id, side: 'debit', amount: syp('5000000') },
        {
          account: seeded(accounts, 'accrued-expenses').id,
          side: 'credit',
          amount: usd('384.6154'),
        },
      ],
      attachments: [PDF],
    };

    // The store the host provides would not take the bytes: nothing of the
    // entry exists, and the failure is the caller's to see.
    fin.attachments.failNextPut();
    await expect(fin.journalAdmin.record(fin.by, draft)).rejects.toThrow('the disk is full');
    expect(await fin.journal.entry(fin.by, draft.id)).toBeNull();
    expect(fin.stamps()).toEqual([]);
    expect(fin.attachments.keys()).toEqual([]);

    // The month closed between the accountant opening the screen and pressing
    // the button: refused before a rate is asked for or a byte is kept, and
    // nothing written.
    taken(await fin.calendarAdmin.close(fin.by, year.periods[8]!.id));
    expect(refusalOf(await fin.journalAdmin.record(fin.by, draft)).code).toBe('fin.period-closed');
    expect(await fin.journal.entry(fin.by, draft.id)).toBeNull();
    expect(fin.stamps()).toEqual([]);
    expect(fin.attachments.keys()).toEqual([]);
    expect(
      [...fin.store.committed().keys()].filter((key) => key.startsWith('fin/attachment/')),
    ).toEqual([]);

    // SYS would not number the entry — the one refusal that reaches the engine
    // inside the transaction that writes, after the bytes have been kept:
    // the entry and the stamps go with it, and the bytes stay under their hash.
    taken(await fin.calendarAdmin.reopen(fin.by, year.periods[8]!.id, 'تسوية متأخرة'));
    fin.declineNextNumber();
    expect(refusalOf(await fin.journalAdmin.record(fin.by, draft)).code).toBe(
      'fin.numbering-refused',
    );
    expect(await fin.journal.entry(fin.by, draft.id)).toBeNull();
    expect(fin.stamps()).toEqual([]);
    expect(
      [...fin.store.committed().keys()].filter((key) => key.startsWith('fin/attachment/')),
    ).toEqual([]);
    expect(fin.attachments.keys()).toEqual([`fin/attachment/${fin.tenant}/${PDF_SHA256}`]);

    // The same submission then goes through, and finds its bytes already there
    // under their hash.
    const posted = taken(await fin.journalAdmin.record(fin.by, draft));
    expect(posted.attachments).toHaveLength(1);
    expect(fin.attachments.keys()).toEqual([`fin/attachment/${fin.tenant}/${PDF_SHA256}`]);
    expect(fin.stamps()).toHaveLength(1);
    expect((await fin.journal.attachment(fin.by, draft.id, 1))?.bytes).toEqual(PDF.bytes);
  });

  it('is reversed like any other entry, at the stamps it used, and its attachments stay with the original', async () => {
    const { fin, accounts } = shop;
    const original = taken(
      await fin.journalAdmin.record(fin.by, {
        ...accrual(shop),
        lines: [
          { account: seeded(accounts, 'rent').id, side: 'debit', amount: syp('5000000') },
          {
            account: seeded(accounts, 'accrued-expenses').id,
            side: 'credit',
            amount: usd('384.6154'),
          },
        ],
        attachments: [PDF],
      }),
    );

    const reversal = taken(
      await fin.journalAdmin.reverse(fin.by, original.entry.id, {
        day: day('2026-09-21'),
        reason: 'استحقاق مكرّر',
      }),
    );

    expect(reversal.entry).toMatchObject({
      source: { kind: FIN_ENTRY_KINDS.reversal, document: original.entry.id },
      reverses: original.entry.id,
      attachmentCount: 0,
    });
    expect(reversal.attachments).toEqual([]);
    expect(figuresOf(reversal.lines)).toEqual(
      figuresOf(original.lines).map((line) => ({
        ...line,
        side: line.side === 'debit' ? 'credit' : 'debit',
      })),
    );
    expect(fin.stamps()).toHaveLength(1);
    expect(await fin.journal.entry(fin.by, original.entry.id)).toEqual(original);
    expect((await fin.journal.reversalOf(fin.by, original.entry.id))?.reversal).toBe(
      reversal.entry.id,
    );
  });

  it('numbers an entry recorded at a register in that register’s series, as the engine numbers everything made there', async () => {
    const { fin, branch } = shop;
    const till = fin.openRegister(branch, { prefix: 'T1' });

    const posted = taken(await fin.journalAdmin.record(till.by, accrual(shop)));

    expect(posted.entry).toMatchObject({
      number: 'T1-1-2026-000001',
      register: till.register,
      device: till.device,
      by: till.by.actor,
    });
  });

  it('asks the accountant’s right to write into the journal, tenant-wide, before anything is asked of SYS or FX or written', async () => {
    const { fin } = shop;
    const asked: string[] = [];
    fin.answers((by, right, where) => {
      expect(by).toBe(fin.by);
      expect(where).toBeUndefined();
      asked.push(right);
      return false;
    });

    expect(
      refusalOf(await fin.journalAdmin.record(fin.by, accrual(shop, { attachments: [PDF] }))),
    ).toEqual({
      code: 'fin.not-permitted',
      values: { right: FIN_PERMISSIONS.journalEntry.create },
    });
    expect(asked).toEqual([FIN_PERMISSIONS.journalEntry.create]);
    expect(await fin.journal.entries(fin.by)).toEqual([]);
    expect(fin.attachments.keys()).toEqual([]);

    // The right, as declared: the accountant's alone, and not sensitive.
    const declared = FIN_PERMISSION_SEEDS.find(
      (one) => one.id === FIN_PERMISSIONS.journalEntry.create,
    );
    expect(declared).toEqual({ id: 'fin.journal-entry.create', seededFor: ['accountant'] });
  });
});
