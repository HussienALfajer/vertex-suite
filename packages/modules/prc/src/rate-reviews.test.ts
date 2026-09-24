import { describe, expect, it } from 'vitest';
import type { BranchId } from '@vertex/contracts';
import { newId } from '@vertex/kernel';
import { AT, freeze, installed, priced, value, type Harness } from './installed.fixture.js';
import {
  PRC_PERMISSIONS,
  type DisplayPriceTarget,
  type PriceList,
  type RateReviewEntry,
  type RateReviewRef,
  type RateReviewTask,
} from './index.js';

/**
 * `PRC-03`'s second half: the owner's threshold, the review task a rate that
 * moves past it raises, and the reviewed, logged batch that is the only way
 * such a task changes a frozen price (`PRC-11`).
 *
 * Figures throughout: dollar prices of whole dollars, frozen at 10,000 pounds
 * to the dollar, so a price of n dollars is frozen at n × 10,000 and every
 * proposal is the new rate times n, settled onto the stand-in's ten-pound note.
 */

interface Shop {
  readonly lists: readonly PriceList[];
  readonly branch: BranchId;
  readonly targets: readonly DisplayPriceTarget[];
}

/** `count` items of one unit each, priced at 1, 2, 3… dollars in the retail list, frozen at 10,000. */
async function aShop(h: Harness, count = 3, branch = h.openBranch()): Promise<Shop> {
  const lists = value(await h.admin.seed(h.system));
  h.rate(branch, '10000');
  const targets: DisplayPriceTarget[] = [];
  for (let n = 1; n <= count; n += 1) {
    const item = h.item(h.by.tenant, 1);
    const subject = { list: lists[0]!.id, item: item.id, unit: item.units[0]!.id };
    await priced(h, subject, `${String(n)}.00`);
    const target = { branch, subject };
    await freeze(h, target);
    targets.push(target);
  }
  return { lists, branch, targets };
}

async function threshold(h: Harness, percent: string | null) {
  const current = value(await h.reviews.policy(h.by));
  return value(
    await h.reviews.setPolicy(h.by, {
      threshold: percent,
      expectedRevision: current.revision,
      operation: newId<'price-operation'>(),
    }),
  );
}

async function tasksAt(h: Harness, branch: BranchId, open = false) {
  return value(await h.reviews.tasks(h.by, { branch, ...(open ? { open } : {}) })).tasks;
}

/** The one open task at the branch, after the monitor has settled. */
async function raised(h: Harness, branch: BranchId): Promise<RateReviewTask> {
  await h.settle();
  const open = await tasksAt(h, branch, true);
  expect(open).toHaveLength(1);
  return open[0]!;
}

async function everyEntry(h: Harness, ref: RateReviewRef): Promise<RateReviewEntry[]> {
  const all: RateReviewEntry[] = [];
  let after: string | undefined;
  for (;;) {
    const page = value(
      await h.reviews.entries(h.by, { ...ref, limit: 100, ...(after ? { after } : {}) }),
    );
    all.push(...page.entries);
    if (page.next === null) return all;
    after = page.next;
  }
}

const refOf = (task: RateReviewTask): RateReviewRef => ({ branch: task.branch, task: task.id });

async function frozenAmounts(h: Harness, targets: readonly DisplayPriceTarget[]) {
  const amounts: (string | null)[] = [];
  for (const target of targets)
    amounts.push(value(await h.display.get(h.by, target)).price?.amount ?? null);
  return amounts;
}

async function approve(h: Harness, task: RateReviewTask, reason = 'Rate moved') {
  return h.reviews.approve(h.by, {
    ...refOf(task),
    expectedReview: task.review,
    reason,
    operation: newId<'price-operation'>(),
  });
}

describe('PRC-03 the owner’s rate-movement threshold', () => {
  it('is disabled until the owner sets it, and raises nothing however far the rate moves', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);

    expect(value(await h.reviews.policy(h.by))).toEqual({
      tenant: h.by.tenant,
      threshold: null,
      revision: 0,
      changedBy: null,
      changedAt: null,
    });
    h.rate(branch, '20000');
    await h.settle();

    expect(await tasksAt(h, branch)).toEqual([]);
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000']);
  });

  it('is a percentage between 0.1 and 50 to two places, one for the tenant, revised by the owner alone', async () => {
    const h = installed();
    value(await h.admin.seed(h.system));

    const set = await threshold(h, '5.50');
    expect(set).toEqual({
      tenant: h.by.tenant,
      threshold: '5.5',
      revision: 1,
      changedBy: h.by.actor,
      changedAt: AT,
    });
    for (const bad of ['0.09', '50.01', '5.555', '-5', '0', 'five', '', '1e1', ' 5'])
      expect(
        await h.reviews.setPolicy(h.by, {
          threshold: bad,
          expectedRevision: 1,
          operation: newId<'price-operation'>(),
        }),
        bad,
      ).toMatchObject({ ok: false, error: { code: 'prc.threshold-invalid' } });
    expect((await threshold(h, '0.1')).threshold).toBe('0.1');
    expect((await threshold(h, '50')).threshold).toBe('50');
    const disabled = await threshold(h, null);
    expect(disabled).toMatchObject({ threshold: null, revision: 4 });

    // Two owners from the same revision: the second is told, not overwritten.
    expect(
      await h.reviews.setPolicy(h.by, {
        threshold: '5',
        expectedRevision: 3,
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.revision-stale' } });
    // A retried request is answered as the first was.
    const operation = newId<'price-operation'>();
    const first = await h.reviews.setPolicy(h.by, {
      threshold: '7',
      expectedRevision: 4,
      operation,
    });
    expect(
      await h.reviews.setPolicy(h.by, { threshold: '7', expectedRevision: 4, operation }),
    ).toEqual(first);

    h.withhold(PRC_PERMISSIONS.review.policy);
    expect(
      await h.reviews.setPolicy(h.by, {
        threshold: '5',
        expectedRevision: 5,
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.not-permitted' } });
    // Another tenant has its own, still disabled.
    expect(value(await h.reviews.policy(h.other))).toMatchObject({
      threshold: null,
      revision: 0,
    });
  });
});

describe('PRC-03 a rate that moves past the threshold raises one review task', () => {
  it('raises nothing, and changes nothing, for a movement below the threshold', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');

    h.rate(branch, '10499');
    await h.settle();
    h.rate(branch, '9501');
    await h.settle();

    expect(await tasksAt(h, branch)).toEqual([]);
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000']);
  });

  it('raises a task listing every affected price with its old and proposed figures, and freezes none of them', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');

    // Exactly five percent: equality crosses.
    const revision = h.rate(branch, '10500');
    const task = await raised(h, branch);

    expect(task).toMatchObject({
      tenant: h.by.tenant,
      branch,
      state: 'pending',
      rate: { revision, rate: '10500', side: 'buy' },
      policy: { revision: 1, threshold: '5' },
      review: 0,
      counts: { frozen: 3, scanned: 3, moved: 3, entries: 3, excluded: 0 },
      decision: null,
      supersession: null,
      batch: null,
    });
    const entries = await everyEntry(h, refOf(task));
    expect(entries.map((one) => [one.current.amount, one.proposed])).toEqual(
      expect.arrayContaining([
        ['10000', '10500'],
        ['20000', '21000'],
        ['30000', '31500'],
      ]),
    );
    expect(entries[0]).toMatchObject({
      task: task.id,
      branch,
      currency: 'SYP',
      current: { revision: 1, basis: { rate: { rate: '10000' } } },
      usd: { revision: 1 },
      basis: { usdRevision: 1, rate: { revision, rate: '10500' } },
      included: true,
      exclusion: null,
      stale: false,
    });
    // The operational read is the stored snapshot, untouched, and asks FX nothing.
    const asked = h.fxCalls();
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000']);
    expect(value(await h.display.get(h.by, targets[0]!)).status).toBe('frozen');
    expect(h.fxCalls()).toBe(asked);
    // And whoever publishes alerts (`SYS-04`) was told, once.
    expect(h.heard.filter((one) => one.name === 'prc.rate-review-raised')).toHaveLength(1);
  });

  it('measures each price from the rate it was frozen at, so small revisions add up — and down', async () => {
    const h = installed();
    const { branch } = await aShop(h);
    await threshold(h, '5');

    for (const rate of ['10200', '10400']) {
      h.rate(branch, rate);
      await h.settle();
      expect(await tasksAt(h, branch), rate).toEqual([]);
    }
    h.rate(branch, '10600');
    const up = await raised(h, branch);
    expect(up.rate.rate).toBe('10600');

    // Back toward the baseline, by a same-day correction: the task it raised
    // no longer describes today's rate, and nothing replaces it.
    h.rate(branch, '10300');
    await h.settle();
    expect(await tasksAt(h, branch, true)).toEqual([]);
    expect(value(await h.reviews.task(h.by, refOf(up)))).toMatchObject({
      state: 'superseded',
      supersession: { cause: 'rate-revised', by: null },
    });

    // Down is movement too.
    h.rate(branch, '9500');
    expect((await raised(h, branch)).rate.rate).toBe('9500');
  });

  it('replaces a task when the day’s rate is corrected past the threshold again', async () => {
    const h = installed();
    const { branch } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '10600');
    const first = await raised(h, branch);

    const corrected = h.rate(branch, '10700');
    const second = await raised(h, branch);

    expect(second.id).not.toBe(first.id);
    expect(second.rate).toMatchObject({ revision: corrected, sequence: 3 });
    expect(value(await h.reviews.task(h.by, refOf(first))).state).toBe('superseded');
  });

  it('follows a change of threshold: a stricter one supersedes, a looser one raises', async () => {
    const h = installed();
    const { branch } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '10600');
    const first = await raised(h, branch);

    await threshold(h, '10');
    await h.settle();
    expect(await tasksAt(h, branch, true)).toEqual([]);
    expect(value(await h.reviews.task(h.by, refOf(first)))).toMatchObject({
      state: 'superseded',
      supersession: { cause: 'policy-changed' },
    });

    await threshold(h, '3');
    const second = await raised(h, branch);
    expect(second.policy).toEqual({ revision: 3, threshold: '3' });

    await threshold(h, null);
    await h.settle();
    expect(await tasksAt(h, branch, true)).toEqual([]);
  });

  it('raises one task however often it is driven, and after a restart that lost every event', async () => {
    const h = installed();
    const { branch } = await aShop(h);
    await threshold(h, '5');

    // The rate is committed, and the process dies before anything heard of it.
    h.rate(branch, '11000');
    const restarted = h.restart();
    for (let n = 0; n < 5; n += 1) await restarted.monitor.drive(h.system);
    await h.settle();
    await h.restart().monitor.drive(h.system);

    const all = value(await restarted.reviews.tasks(h.by, { branch }));
    expect(all.tasks).toHaveLength(1);
    expect(all.tasks[0]).toMatchObject({ state: 'pending', rate: { rate: '11000' } });
  });

  it('resumes a scan interrupted between steps, from the step it had reached', async () => {
    const h = installed({ chunk: 2 });
    const { branch } = await aShop(h, 5);
    await threshold(h, '5');
    h.rate(branch, '11000');

    await h.monitor.drive(h.system); // detects, and begins
    await h.monitor.drive(h.system); // two prices listed
    const preparing = await tasksAt(h, branch, true);
    expect(preparing).toHaveLength(1);
    expect(preparing[0]).toMatchObject({ state: 'preparing', counts: { frozen: 5 } });
    // Not a decision anybody can take yet.
    expect(await approve(h, preparing[0]!)).toMatchObject({
      ok: false,
      error: { code: 'prc.review-not-pending' },
    });

    h.failNextCommit();
    await expect(h.monitor.drive(h.system)).rejects.toThrow('The disk refused the commit.');
    const restarted = h.restart();
    while ((await restarted.monitor.drive(h.system)).more);

    const task = value(await restarted.reviews.task(h.by, refOf(preparing[0]!)));
    expect(task).toMatchObject({ state: 'pending', counts: { scanned: 5, entries: 5 } });
    expect(await everyEntry(h, refOf(task))).toHaveLength(5);
  });

  it('lists only prices it can propose a new figure for, and says why each other one is left out', async () => {
    const h = installed();
    const { lists, branch, targets } = await aShop(h, 4);
    // A price in a list that is then withdrawn.
    const item = h.item(h.by.tenant, 1);
    const inHalf = { list: lists[1]!.id, item: item.id, unit: item.units[0]!.id };
    await priced(h, inHalf, '1.00');
    await freeze(h, { branch, subject: inHalf });
    value(await h.admin.deactivate(h.by, lists[1]!.id));
    // An item the catalogue no longer has.
    h.forget(targets[0]!.subject.item);
    // A frozen price whose dollar price is gone — no command does this.
    const [, gone] = targets;
    await h.write((session) => {
      session.remove(
        `prc/usd/${encodeURIComponent(h.by.tenant)}/price/${gone!.subject.item}/${gone!.subject.list}/${gone!.subject.unit}`,
      );
    });
    // A price the new rate settles to the figure already frozen: frozen at a
    // thousand-pound note, its dollar price since cut to 0.96.
    h.settleTo('1000');
    const item2 = h.item(h.by.tenant, 1);
    const same = { list: lists[0]!.id, item: item2.id, unit: item2.units[0]!.id };
    await priced(h, same, '1.00');
    await freeze(h, { branch, subject: same });
    await priced(h, same, '0.96', 1);
    // A dollar price never frozen here has no baseline to have moved from.
    const item3 = h.item(h.by.tenant, 1);
    await priced(h, { list: lists[0]!.id, item: item3.id, unit: item3.units[0]!.id }, '9.00');
    await threshold(h, '5');

    h.rate(branch, '10500');
    const task = await raised(h, branch);

    expect(task.counts).toEqual({
      frozen: 6,
      scanned: 6,
      moved: 6,
      entries: 2,
      excluded: 0,
      skipped: {
        'list-inactive': 1,
        'subject-invalid': 1,
        'usd-missing': 1,
        unchanged: 1,
        'amount-invalid': 0,
      },
    });
    const listed = await everyEntry(h, refOf(task));
    expect(listed.map((one) => one.subject.item).sort()).toEqual(
      [targets[2]!.subject.item, targets[3]!.subject.item].sort(),
    );
  });

  it('watches only branches in service', async () => {
    const h = installed();
    const { branch } = await aShop(h);
    await threshold(h, '5');
    h.shutBranch(branch);
    h.rate(branch, '12000');
    await h.settle();
    expect(await tasksAt(h, branch)).toEqual([]);
  });
});

describe('PRC-03 reviewing a task: pages, exclusions, rejection', () => {
  it('reads the listed prices a bounded page at a time', async () => {
    const h = installed({ chunk: 3 });
    const { branch } = await aShop(h, 7);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);

    const first = value(await h.reviews.entries(h.by, { ...refOf(task), limit: 3 }));
    expect(first.entries).toHaveLength(3);
    expect(first.next).not.toBeNull();
    const second = value(
      await h.reviews.entries(h.by, { ...refOf(task), limit: 3, after: first.next! }),
    );
    expect(second.entries.map((one) => one.subject.item)).not.toContain(
      first.entries[0]!.subject.item,
    );
    expect(await everyEntry(h, refOf(task))).toHaveLength(7);
    for (const query of [{ limit: 101 }, { limit: 0 }, { after: '../../x' }, { included: 'yes' }])
      expect(
        await h.reviews.entries(h.by, { ...refOf(task), ...(query as object) }),
        JSON.stringify(query),
      ).toMatchObject({ ok: false, error: { code: 'prc.review-query-invalid' } });
    expect(await h.reviews.tasks(h.by, { branch, limit: 51 })).toMatchObject({
      ok: false,
      error: { code: 'prc.review-query-invalid' },
    });
  });

  it('excludes and restores prices, recording who and when, against the review revision seen', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);

    const excluded = value(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [targets[0]!.subject, targets[1]!.subject],
        excluded: true,
        expectedReview: 0,
      }),
    );
    expect(excluded).toMatchObject({ review: 1, counts: { entries: 3, excluded: 2 } });
    const out = value(await h.reviews.entries(h.by, { ...refOf(task), included: false })).entries;
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ included: false, exclusion: { actor: h.by.actor, at: AT } });
    // Someone deciding from what they saw before the exclusion is told.
    expect(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [targets[2]!.subject],
        excluded: true,
        expectedReview: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.revision-stale' } });
    const restored = value(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [targets[1]!.subject],
        excluded: false,
        expectedReview: 1,
      }),
    );
    expect(restored).toMatchObject({ review: 2, counts: { excluded: 1 } });
    // A subject the task does not list is not quietly ignored.
    expect(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [{ ...targets[0]!.subject, item: newId<'item'>() }],
        excluded: true,
        expectedReview: 2,
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.subject-invalid' } });
  });

  it('rejects a task with a reason, leaving every frozen price as it was and raising nothing again for that rate', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);

    expect(
      await h.reviews.reject(h.by, {
        ...refOf(task),
        reason: ' ',
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.reason-required' } });
    const operation = newId<'price-operation'>();
    const rejected = value(
      await h.reviews.reject(h.by, { ...refOf(task), reason: 'Temporary spike', operation }),
    );
    expect(rejected).toMatchObject({
      state: 'rejected',
      decision: {
        kind: 'rejected',
        actor: h.by.actor,
        at: AT,
        reason: 'Temporary spike',
        operation,
      },
    });
    expect(
      value(await h.reviews.reject(h.by, { ...refOf(task), reason: 'Temporary spike', operation })),
    ).toEqual(rejected);
    expect(await approve(h, rejected)).toMatchObject({
      ok: false,
      error: { code: 'prc.review-not-pending' },
    });
    await h.settle();
    expect(await tasksAt(h, branch, true)).toEqual([]);
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000']);
    expect(value(await h.display.history(h.by, { branch })).entries).toHaveLength(3);
  });

  it('refreshes a task into a fresh listing that keeps its exclusions', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    value(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [targets[0]!.subject],
        excluded: true,
        expectedReview: 0,
      }),
    );
    await priced(h, targets[1]!.subject, '2.50', 1);

    const old = value(await h.reviews.refresh(h.by, refOf(task)));
    expect(old).toMatchObject({ state: 'superseded', supersession: { cause: 'refreshed' } });
    const fresh = await raised(h, branch);
    expect(fresh.id).not.toBe(task.id);
    const entries = await everyEntry(h, refOf(fresh));
    const byItem = new Map(entries.map((one) => [one.subject.item, one]));
    expect(byItem.get(targets[0]!.subject.item)).toMatchObject({ included: false });
    expect(byItem.get(targets[1]!.subject.item)).toMatchObject({
      proposed: '27500',
      usd: { revision: 2 },
      stale: false,
    });
  });
});

describe('PRC-03 PRC-11 approving a reviewed batch', () => {
  it('publishes exactly the included, reviewed figures at once, each with a complete audit entry of one batch', async () => {
    const h = installed({ chunk: 2 });
    const { branch, targets } = await aShop(h, 5);
    await threshold(h, '5');
    const revision = h.rate(branch, '11000');
    const task = await raised(h, branch);
    const reviewed = value(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [targets[4]!.subject],
        excluded: true,
        expectedReview: 0,
      }),
    );

    const accepted = value(await approve(h, reviewed, 'Weekly reprice'));
    expect(accepted).toMatchObject({
      state: 'approving',
      batch: { state: 'staging', total: 4, staged: 0, actor: h.by.actor, reason: 'Weekly reprice' },
    });
    // Staged, a step at a time — and nothing of it visible until all of it is.
    await h.monitor.drive(h.system);
    expect(value(await h.reviews.task(h.by, refOf(task))).batch).toMatchObject({ staged: 2 });
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000', '40000', '50000']);
    expect(value(await h.display.history(h.by, { branch })).entries).toHaveLength(5);

    await h.settle();
    const approved = value(await h.reviews.task(h.by, refOf(task)));
    const batch = approved.batch!;
    expect(approved).toMatchObject({
      state: 'approved',
      decision: { kind: 'approved', actor: h.by.actor, at: AT, reason: 'Weekly reprice' },
      batch: { state: 'published', total: 4, staged: 4, publishedAt: AT, failure: null },
    });
    expect(await frozenAmounts(h, targets)).toEqual(['11000', '22000', '33000', '44000', '50000']);
    const now = value(await h.display.get(h.by, targets[0]!));
    expect(now).toMatchObject({
      status: 'frozen',
      price: {
        amount: '11000',
        revision: 2,
        batch: batch.id,
        approvedBy: h.by.actor,
        reason: 'Weekly reprice',
        basis: { usdRevision: 1, rate: { revision } },
      },
    });

    const audit = value(await h.display.history(h.by, { batch: batch.id })).entries;
    expect(audit).toHaveLength(4);
    expect(audit.map((one) => [one.oldAmount, one.newAmount]).sort()).toEqual([
      ['10000', '11000'],
      ['20000', '22000'],
      ['30000', '33000'],
      ['40000', '44000'],
    ]);
    for (const entry of audit)
      expect(entry).toMatchObject({
        batch: batch.id,
        operation: batch.operation,
        actor: h.by.actor,
        at: AT,
        reason: 'Weekly reprice',
        revision: 2,
        oldBasis: { rate: { rate: '10000' } },
        basis: { usdRevision: 1, rate: { revision, rate: '11000' } },
      });
    expect(value(await h.display.history(h.by, { branch })).entries).toHaveLength(9);
    expect(h.heard.filter((one) => one.name === 'prc.rate-review-published')).toHaveLength(1);

    // The new figures are the baseline now: the same rate raises nothing more.
    await h.settle();
    expect(await tasksAt(h, branch, true)).toEqual([]);
  });

  it('keeps later approvals on top of a published batch, whatever step it has reached', async () => {
    const h = installed({ chunk: 1 });
    const { branch, targets } = await aShop(h, 3);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    value(await approve(h, task));
    // Staged, and published, but not every price yet folded into its own record.
    for (let n = 0; n < 4; n += 1) await h.monitor.drive(h.system);
    expect(value(await h.reviews.task(h.by, refOf(task))).state).toBe('approved');
    expect(await frozenAmounts(h, targets)).toEqual(['11000', '22000', '33000']);

    // A manual approval over a published price not yet folded.
    h.rate(branch, '11500');
    const last = targets[2]!;
    const again = await freeze(h, last, 'Corrected by hand');
    expect(again).toMatchObject({ revision: 3, amount: '34500' });
    await h.settle();
    expect(value(await h.display.get(h.by, last)).price).toMatchObject({
      amount: '34500',
      revision: 3,
    });
    expect(await frozenAmounts(h, targets)).toEqual(['11000', '22000', '34500']);
  });

  it('answers a repeated approval as the first, and a second approver with the decision already taken', async () => {
    const h = installed();
    const { branch } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    const command = {
      ...refOf(task),
      expectedReview: 0,
      reason: 'Rate moved',
      operation: newId<'price-operation'>(),
    };

    const [one, two, three] = await Promise.all([
      h.reviews.approve(h.by, command),
      h.reviews.approve(h.by, command),
      h.reviews.approve(h.by, { ...command, operation: newId<'price-operation'>() }),
    ]);
    expect(one).toEqual(two);
    expect(one.ok).toBe(true);
    expect(three).toMatchObject({ ok: false, error: { code: 'prc.review-not-pending' } });
    await h.settle();
    expect(value(await h.reviews.approve(h.by, command))).toMatchObject({ id: task.id });
    const done = value(await h.reviews.task(h.by, refOf(task)));
    expect(done.state).toBe('approved');
    expect(value(await h.display.history(h.by, { batch: done.batch!.id })).entries).toHaveLength(3);
  });

  it('survives an interrupted step and a restart with one batch, and no audit entry twice', async () => {
    const h = installed({ chunk: 2 });
    const { branch, targets } = await aShop(h, 5);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    value(await approve(h, task));

    await h.monitor.drive(h.system);
    h.failNextCommit();
    await expect(h.monitor.drive(h.system)).rejects.toThrow('The disk refused the commit.');
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000', '40000', '50000']);
    const restarted = h.restart();
    while ((await restarted.monitor.drive(h.system)).more);

    const done = value(await restarted.reviews.task(h.by, refOf(task)));
    expect(done).toMatchObject({ state: 'approved', batch: { staged: 5, state: 'published' } });
    expect(await frozenAmounts(h, targets)).toEqual(['11000', '22000', '33000', '44000', '55000']);
    const audit = value(await h.display.history(h.by, { batch: done.batch!.id })).entries;
    expect(audit).toHaveLength(5);
    expect(new Set(audit.map((one) => one.subject.item)).size).toBe(5);
  });

  it('refuses an approval once a listed dollar price has changed, and marks the rows that did', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    await priced(h, targets[1]!.subject, '2.50', 1);

    expect(await approve(h, task)).toMatchObject({
      ok: false,
      error: { code: 'prc.review-stale', values: { stale: 1 } },
    });
    const rows = await everyEntry(h, refOf(task));
    expect(rows.filter((one) => one.stale).map((one) => one.subject.item)).toEqual([
      targets[1]!.subject.item,
    ]);
    expect(value(await h.reviews.task(h.by, refOf(task))).state).toBe('pending');
    // An excluded row that went stale does not hold the rest back.
    const without = value(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [targets[1]!.subject],
        excluded: true,
        expectedReview: 0,
      }),
    );
    value(await approve(h, without));
    await h.settle();
    expect(await frozenAmounts(h, targets)).toEqual(['11000', '20000', '33000']);
  });

  it('refuses an approval once a listed frozen price was approved again by hand', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    await freeze(h, targets[0]!, 'By hand');

    expect(await approve(h, task)).toMatchObject({
      ok: false,
      error: { code: 'prc.review-stale', values: { stale: 1 } },
    });
  });

  it('refuses an approval once the day’s rate was corrected or the threshold changed', async () => {
    const h = installed();
    const { branch } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);

    h.rate(branch, '11100');
    expect(await approve(h, task)).toMatchObject({
      ok: false,
      error: { code: 'prc.review-superseded' },
    });
    const next = await raised(h, branch);
    await threshold(h, '6');
    expect(await approve(h, next)).toMatchObject({
      ok: false,
      error: { code: 'prc.review-superseded' },
    });
  });

  it('abandons a batch whose basis changes while it is being staged, and publishes none of it', async () => {
    const h = installed({ chunk: 2 });
    const { branch, targets } = await aShop(h, 4);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    value(await approve(h, task));
    await h.monitor.drive(h.system);

    // A dollar price already staged changes before publication.
    await priced(h, targets[0]!.subject, '1.50', 1);
    await h.settle();

    const back = value(await h.reviews.task(h.by, refOf(task)));
    expect(back).toMatchObject({
      state: 'pending',
      decision: null,
      batch: { state: 'abandoned', failure: { cause: 'stale', at: AT } },
    });
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000', '40000']);
    expect(value(await h.display.history(h.by, { batch: back.batch!.id })).entries).toHaveLength(0);
    expect(value(await h.display.history(h.by, { branch })).entries).toHaveLength(4);
    expect(await approve(h, back)).toMatchObject({
      ok: false,
      error: { code: 'prc.review-stale' },
    });
  });

  it('abandons a batch when today’s rate is corrected, or its rounding rule revised, while it is staged', async () => {
    const h = installed({ chunk: 2 });
    const { branch, targets } = await aShop(h, 4);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    value(await approve(h, task));
    h.whileConvertingAll(() => Promise.resolve(h.rate(branch, '11001')));
    await h.settle();

    expect(value(await h.reviews.task(h.by, refOf(task)))).toMatchObject({
      state: 'superseded',
      batch: { state: 'abandoned', failure: { cause: 'superseded' } },
    });
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000', '40000']);

    const next = await raised(h, branch);
    value(await approve(h, next));
    // Onto a seven-pound step: 1 × 11,001 now settles to 11,004, not the 11,000 reviewed.
    h.settleTo('7');
    await h.settle();
    expect(value(await h.reviews.task(h.by, refOf(next)))).toMatchObject({
      state: 'pending',
      batch: { state: 'abandoned', failure: { cause: 'stale' } },
    });
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000', '40000']);
  });

  it('refuses to approve a task with every price excluded', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h, 1);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    const none = value(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [targets[0]!.subject],
        excluded: true,
        expectedReview: 0,
      }),
    );
    expect(await approve(h, none)).toMatchObject({
      ok: false,
      error: { code: 'prc.review-empty' },
    });
  });
});

describe('PRC-03 PRC-11 a review whose ground shifts under it', () => {
  it('counts a price named twice in one exclusion once', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    const twice = [targets[0]!.subject, targets[0]!.subject];

    const out = value(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: twice,
        excluded: true,
        expectedReview: 0,
      }),
    );
    expect(out.counts.excluded).toBe(1);
    const back = value(
      await h.reviews.exclude(h.by, {
        ...refOf(task),
        subjects: [...twice, targets[0]!.subject],
        excluded: false,
        expectedReview: 1,
      }),
    );
    expect(back.counts.excluded).toBe(0);
    value(await approve(h, back));
    await h.settle();
    expect(value(await h.reviews.task(h.by, refOf(task))).state).toBe('approved');
  });

  it('publishes nothing on a list withdrawn after its prices were listed', async () => {
    const h = installed();
    const { lists, branch, targets } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    value(await h.admin.deactivate(h.by, lists[0]!.id));

    expect((await everyEntry(h, refOf(task))).every((one) => one.stale)).toBe(true);
    value(await approve(h, task));
    await h.settle();

    expect(value(await h.reviews.task(h.by, refOf(task)))).toMatchObject({
      state: 'pending',
      batch: { state: 'abandoned', failure: { cause: 'stale', stale: 3 } },
    });
    expect(await frozenAmounts(h, targets)).toEqual(['10000', '20000', '30000']);
  });

  it('does not refresh a task while its branch is being scanned again', async () => {
    const h = installed({ chunk: 1 });
    const { branch } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);
    value(await h.reviews.refresh(h.by, refOf(task)));
    await h.monitor.drive(h.system);
    const preparing = (await tasksAt(h, branch, true))[0]!;
    expect(preparing.state).toBe('preparing');

    // The superseded task cannot be refreshed again, and the new one is not yet a decision.
    expect(await h.reviews.refresh(h.by, refOf(task))).toMatchObject({
      ok: false,
      error: { code: 'prc.review-not-pending' },
    });
    await h.settle();
    expect(await tasksAt(h, branch, true)).toHaveLength(1);
  });
});

describe('PRC-03 review tasks within the tenant, the branch and the rights', () => {
  it('shows and decides a task only for whoever holds the right at its branch', async () => {
    const h = installed();
    const { branch, targets } = await aShop(h);
    await threshold(h, '5');
    h.rate(branch, '11000');
    const task = await raised(h, branch);

    // Another tenant cannot find it.
    expect(await h.reviews.task(h.other, refOf(task))).toMatchObject({
      ok: false,
      error: { code: 'prc.review-not-found' },
    });
    expect(value(await h.reviews.tasks(h.other, {})).tasks).toEqual([]);
    // Named at the wrong branch, it is not there.
    expect(await h.reviews.task(h.by, { branch: h.openBranch(), task: task.id })).toMatchObject({
      ok: false,
      error: { code: 'prc.review-not-found' },
    });

    // Confined away from its branch: nothing, not even that it exists.
    h.bar(branch);
    expect(await h.reviews.task(h.by, refOf(task))).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
    expect(await h.reviews.tasks(h.by, { branch })).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
    expect(await approve(h, task)).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });

    const h2 = installed();
    const shop = await aShop(h2);
    await threshold(h2, '5');
    h2.rate(shop.branch, '11000');
    const theirs = await raised(h2, shop.branch);
    // Seeing is not deciding.
    h2.withhold(PRC_PERMISSIONS.review.approve);
    expect(value(await h2.reviews.task(h2.by, refOf(theirs))).id).toBe(theirs.id);
    for (const attempt of [
      approve(h2, theirs),
      h2.reviews.reject(h2.by, {
        ...refOf(theirs),
        reason: 'No',
        operation: newId<'price-operation'>(),
      }),
      h2.reviews.exclude(h2.by, {
        ...refOf(theirs),
        subjects: [shop.targets[0]!.subject],
        excluded: true,
        expectedReview: 0,
      }),
      h2.reviews.refresh(h2.by, refOf(theirs)),
    ])
      expect(await attempt).toMatchObject({ ok: false, error: { code: 'prc.not-permitted' } });
    h2.withhold(PRC_PERMISSIONS.review.view);
    expect(await h2.reviews.entries(h2.by, refOf(theirs))).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
    // Only the system drives the monitor.
    await expect(h.monitor.drive(h.by)).rejects.toThrow();
    expect(targets).toHaveLength(3);
  });
});
