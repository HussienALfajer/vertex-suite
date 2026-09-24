import { describe, expect, it } from 'vitest';
import { newId } from '@vertex/kernel';
import { AT, aPricedItem, freeze, installed, priced, value } from './installed.fixture.js';
import { PRC_PERMISSIONS } from './index.js';

describe('PRC-02 PRC-03 a frozen SYP display price derived from the USD price', () => {
  it('previews the exact SYP figure at the branch buy rate, settled once, and writes nothing', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');

    const preview = value(await h.display.preview(h.by, target));

    // 1.25 × 13,100 = 16,375, settled half-up onto the ten-pound note.
    expect(preview).toMatchObject({
      ...target,
      currency: 'SYP',
      proposed: '16380',
      current: null,
      basis: {
        usdAmount: '1.25',
        usdRevision: 1,
        exact: '16375',
        residual: '-5',
        rounding: { increment: '10', mode: 'half-up' },
        rate: { side: 'buy', rate: '13100', revision, sequence: 1, day: '2026-05-28' },
      },
    });
    expect(value(await h.display.get(h.by, target))).toMatchObject({
      price: null,
      status: 'not-frozen',
    });
    expect(value(await h.display.history(h.by, { item: target.subject.item })).entries).toEqual([]);
  });

  it('freezes the approved figure with one complete audit entry', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');

    const frozen = await freeze(h, target, 'First shelf price');

    expect(frozen).toMatchObject({
      tenant: h.by.tenant,
      ...target,
      amount: '16380',
      currency: 'SYP',
      revision: 1,
      approvedBy: h.by.actor,
      approvedAt: AT,
      reason: 'First shelf price',
      basis: { usdAmount: '1.25', usdRevision: 1, rate: { revision } },
    });
    expect(value(await h.display.get(h.by, target))).toMatchObject({
      price: frozen,
      usd: { amount: '1.25', revision: 1 },
      status: 'frozen',
    });
    const history = value(await h.display.history(h.by, { branch: target.branch }));
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toEqual({
      tenant: h.by.tenant,
      ...target,
      operation: expect.any(String) as string,
      actor: h.by.actor,
      at: AT,
      currency: 'SYP',
      oldAmount: null,
      oldBasis: null,
      newAmount: '16380',
      basis: frozen.basis,
      reason: 'First shelf price',
      revision: 1,
      sequence: 1,
    });
  });

  it('PRC-03 keeps the frozen figure when today’s rate changes, and reads it without asking FX', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);

    h.rate(target.branch, '15000');
    const before = h.conversions();
    const state = value(await h.display.get(h.by, target));
    const listed = value(await h.display.forItem(h.by, target.branch, target.subject.item));
    value(await h.display.history(h.by, { item: target.subject.item }));

    expect(h.conversions()).toBe(before);
    expect(state.price).toEqual(frozen);
    expect(state.status).toBe('frozen');
    expect(listed.find((one) => one.subject.unit === target.subject.unit)?.price).toEqual(frozen);
  });

  it('PRC-03 PRC-11 recalculates only when a person approves it, as a new revision beside the old', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const first = h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);
    const second = h.rate(target.branch, '15000');

    const preview = value(await h.display.preview(h.by, target));
    expect(preview.current).toEqual(frozen);
    expect(preview.proposed).toBe('18750');
    const recalculated = await freeze(h, target, 'Rate moved');

    expect(recalculated).toMatchObject({
      amount: '18750',
      revision: 2,
      basis: { rate: { revision: second } },
    });
    const history = value(await h.display.history(h.by, { item: target.subject.item }));
    expect(history.entries.map((one) => one.revision)).toEqual([2, 1]);
    expect(history.entries[0]).toMatchObject({
      oldAmount: '16380',
      oldBasis: { rate: { revision: first } },
      newAmount: '18750',
      basis: { rate: { revision: second } },
      reason: 'Rate moved',
    });
    // The first entry is exactly as it was written.
    expect(history.entries[1]).toMatchObject({ newAmount: '16380', oldAmount: null });
  });

  it('PRC-02 keeps the frozen figure when the USD price changes, and says it was frozen from an older one', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);

    await priced(h, target.subject, '2.00', 1);

    const state = value(await h.display.get(h.by, target));
    expect(state.price).toEqual(frozen);
    expect(state.usd).toMatchObject({ amount: '2', revision: 2 });
    expect(state.status).toBe('usd-changed');
    expect(state.price?.basis).toMatchObject({ usdAmount: '1.25', usdRevision: 1 });
    expect(value(await h.display.preview(h.by, target)).basis).toMatchObject({
      usdAmount: '2',
      usdRevision: 2,
    });
  });

  it('keeps two branches, two units and two lists apart', async () => {
    const h = installed();
    const { lists, item, subject, branch } = await aPricedItem(h);
    const damascus = h.openBranch();
    const carton = { ...subject, unit: item.units[1]!.id };
    const wholesale = { ...subject, list: lists[2]!.id };
    await priced(h, carton, '15.00');
    await priced(h, wholesale, '1.10');
    h.rate(branch, '13100');
    h.rate(damascus, '13300');

    const aleppoPiece = await freeze(h, { branch, subject });
    const damascusPiece = await freeze(h, { branch: damascus, subject });

    expect(aleppoPiece.amount).toBe('16380');
    expect(damascusPiece.amount).toBe('16630');
    for (const other of [carton, wholesale]) {
      expect(value(await h.display.get(h.by, { branch, subject: other }))).toMatchObject({
        price: null,
        status: 'not-frozen',
      });
    }
    expect(value(await h.display.get(h.by, { branch: damascus, subject })).price).toEqual(
      damascusPiece,
    );
    expect(
      value(await h.display.forItem(h.by, branch, item.id)).filter((one) => one.price !== null),
    ).toEqual([expect.objectContaining({ subject, price: aleppoPiece })]);
    expect(
      value(await h.display.history(h.by, { branch: damascus })).entries.map((one) => one.branch),
    ).toEqual([damascus]);
  });
});

describe('PRC-02 PRC-03 refusals leave the last frozen price and its history as they were', () => {
  it('refuses a missing rate for today, and never reaches back to the last one', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);
    h.noRate(target.branch);

    expect(await h.display.preview(h.by, target)).toMatchObject({
      ok: false,
      error: {
        code: 'prc.rate-missing',
        values: { branch: target.branch, currency: 'SYP', day: '2026-05-28' },
      },
    });
    expect(
      await h.display.approve(h.by, {
        ...target,
        expectedRevision: 1,
        proposed: '16380',
        usdRevision: 1,
        rateRevision: frozen.basis.rate.revision,
        reason: 'Retry',
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.rate-missing' } });
    expect(value(await h.display.get(h.by, target)).price).toEqual(frozen);
    expect(value(await h.display.history(h.by, {})).entries).toHaveLength(1);
  });

  it('refuses an unpriced subject rather than deriving from zero or another unit', async () => {
    const h = installed();
    const { item, subject, branch } = await aPricedItem(h);
    h.rate(branch, '13100');
    const carton = { branch, subject: { ...subject, unit: item.units[1]!.id } };

    expect(await h.display.preview(h.by, carton)).toMatchObject({
      ok: false,
      error: { code: 'prc.usd-price-missing' },
    });
    expect(value(await h.display.get(h.by, carton))).toMatchObject({
      usd: null,
      price: null,
      status: 'unpriced',
    });
  });

  it('refuses an unknown, withdrawn or foreign branch, and a foreign subject', async () => {
    const h = installed();
    const { subject, branch, target } = await aPricedItem(h);
    h.rate(branch, '13100');
    const frozen = await freeze(h, target);
    const theirs = h.openBranch(h.other.tenant);

    for (const elsewhere of [newId<'branch'>(), theirs])
      expect(await h.display.preview(h.by, { branch: elsewhere, subject })).toMatchObject({
        ok: false,
        error: { code: 'prc.branch-not-found' },
      });
    expect(await h.display.get(h.by, { branch: theirs, subject })).toMatchObject({
      ok: false,
      error: { code: 'prc.branch-not-found' },
    });
    value(await h.admin.seed(h.otherSystem));
    expect(await h.display.get(h.other, { branch: theirs, subject })).toMatchObject({
      ok: false,
      error: { code: 'prc.list-not-found' },
    });
    expect(value(await h.display.history(h.other, {})).entries).toEqual([]);

    h.shutBranch(branch);
    const before = h.conversions();
    expect(await h.display.preview(h.by, target)).toMatchObject({
      ok: false,
      error: { code: 'prc.branch-inactive' },
    });
    // Refused through SYS before FX is asked for a rate at a branch that sets no prices.
    expect(h.conversions()).toBe(before);
    // A withdrawn branch's frozen prices are its history, and stay readable.
    expect(value(await h.display.get(h.by, target)).price).toEqual(frozen);
  });

  it('refuses to preview on a withdrawn list, whose frozen price stays readable', async () => {
    const h = installed();
    const { target, subject } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);
    value(await h.admin.deactivate(h.by, subject.list));
    const before = h.conversions();

    expect(await h.display.preview(h.by, target)).toMatchObject({
      ok: false,
      error: { code: 'prc.list-inactive' },
    });
    expect(h.conversions()).toBe(before);
    expect(value(await h.display.get(h.by, target)).price).toEqual(frozen);
  });

  it('refuses malformed commands before anything is read', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');
    const base = {
      ...target,
      expectedRevision: 0,
      proposed: '16380',
      usdRevision: 1,
      rateRevision: revision,
      reason: 'Shelf price',
      operation: newId<'price-operation'>(),
    };
    const refusedWith = async (command: unknown, code: string): Promise<void> => {
      expect(
        await h.display.approve(h.by, command as Parameters<typeof h.display.approve>[1]),
      ).toMatchObject({ ok: false, error: { code } });
    };
    await refusedWith({ ...base, reason: '   ' }, 'prc.reason-required');
    await refusedWith({ ...base, operation: 'nope' }, 'prc.operation-invalid');
    await refusedWith({ ...base, expectedRevision: -1 }, 'prc.revision-stale');
    await refusedWith({ ...base, branch: 7 }, 'prc.branch-not-found');
    await refusedWith({ ...base, subject: null }, 'prc.subject-invalid');
    await refusedWith({ ...base, proposed: '1e3' }, 'prc.amount-invalid');
    await refusedWith(null, 'prc.subject-invalid');
    expect(value(await h.display.get(h.by, target)).price).toBeNull();
  });
});

describe('PRC-03 PRC-11 approvals under concurrency, retry and failure', () => {
  it('refuses a stale revision, and lets only one of two concurrent approvals win', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const first = value(await h.display.preview(h.by, target));
    const approval = (reason: string) =>
      h.display.approve(h.by, {
        ...target,
        expectedRevision: 0,
        proposed: first.proposed,
        usdRevision: 1,
        rateRevision: first.basis.rate.revision,
        reason,
        operation: newId<'price-operation'>(),
      });

    const raced = await Promise.all([approval('Mine'), approval('Theirs')]);

    expect(raced.filter((one) => one.ok)).toHaveLength(1);
    expect(raced.find((one) => !one.ok)).toMatchObject({
      error: { code: 'prc.revision-stale', values: { currentRevision: 1 } },
    });
    expect(await approval('Late')).toMatchObject({
      ok: false,
      error: { code: 'prc.revision-stale' },
    });
    expect(value(await h.display.history(h.by, {})).entries).toHaveLength(1);
  });

  it('answers an identical retry with the first result, and refuses the same operation reused', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');
    const command = {
      ...target,
      expectedRevision: 0,
      proposed: '16380',
      usdRevision: 1,
      rateRevision: revision,
      reason: 'Shelf price',
      operation: newId<'price-operation'>(),
    };

    const first = value(await h.display.approve(h.by, command));
    // Even after the rate moved: a retry is the same approval, not a new one.
    h.rate(target.branch, '15000');
    expect(value(await h.display.approve(h.by, command))).toEqual(first);
    expect(await h.display.approve(h.by, { ...command, reason: 'Other' })).toMatchObject({
      ok: false,
      error: { code: 'prc.operation-reused' },
    });
    expect(value(await h.display.history(h.by, {})).entries).toHaveLength(1);
  });

  it('refuses to freeze a figure nobody reviewed when the rate or the dollar price moved after preview', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const reviewed = value(await h.display.preview(h.by, target));
    const approve = () =>
      h.display.approve(h.by, {
        ...target,
        expectedRevision: 0,
        proposed: reviewed.proposed,
        usdRevision: reviewed.basis.usdRevision,
        rateRevision: reviewed.basis.rate.revision,
        reason: 'Reviewed',
        operation: newId<'price-operation'>(),
      });

    h.rate(target.branch, '13200');
    expect(await approve()).toMatchObject({
      ok: false,
      error: { code: 'prc.display-basis-changed' },
    });
    h.rate(target.branch, '13100');
    await priced(h, target.subject, '1.30', 1);
    expect(await approve()).toMatchObject({
      ok: false,
      error: { code: 'prc.display-basis-changed' },
    });
    expect(value(await h.display.get(h.by, target)).price).toBeNull();
  });

  it('refuses a dollar price edited between the calculation and the commit', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    const revision = h.rate(target.branch, '13100');
    // The dollar price moves while FX is still restating the one read a moment
    // earlier: the figure being frozen was derived from a dollar price that is
    // no longer current, and only the approving transaction can see that.
    h.whileConverting(() => priced(h, target.subject, '1.30', 1));

    expect(
      await h.display.approve(h.by, {
        ...target,
        expectedRevision: 0,
        proposed: '16380',
        usdRevision: 1,
        rateRevision: revision,
        reason: 'Raced',
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.display-basis-changed' } });
    expect(value(await h.display.get(h.by, target))).toMatchObject({
      price: null,
      usd: { revision: 2 },
    });
  });

  it('commits the price and its audit entry together, or neither', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const frozen = await freeze(h, target);
    h.rate(target.branch, '15000');

    h.failNextCommit();
    await expect(freeze(h, target, 'Lost to the disk')).rejects.toThrow('disk');

    expect(value(await h.display.get(h.by, target)).price).toEqual(frozen);
    expect(value(await h.display.history(h.by, {})).entries).toHaveLength(1);
    expect(await freeze(h, target, 'Second attempt')).toMatchObject({ revision: 2 });
  });
});

describe('PRC-02 PRC-03 PRC-11 who may read and approve a display price, and where', () => {
  it('asks each right at the branch, and refuses a person confined elsewhere', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    await freeze(h, target);
    h.asked.length = 0;

    value(await h.display.get(h.by, target));
    expect(h.asked).toContainEqual({
      right: PRC_PERMISSIONS.display.view,
      where: { branch: target.branch },
    });

    h.bar(target.branch);
    for (const refused of [
      await h.display.get(h.by, target),
      await h.display.forItem(h.by, target.branch, target.subject.item),
      await h.display.preview(h.by, target),
      await h.display.history(h.by, { branch: target.branch }),
    ])
      expect(refused).toMatchObject({ ok: false, error: { code: 'prc.not-permitted' } });
  });

  it('PRC-11 pages the audit newest first without repeating or skipping an entry', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    for (const buy of ['13100', '13200', '13300']) {
      h.rate(target.branch, buy);
      await freeze(h, target, `At ${buy}`);
    }

    const first = value(await h.display.history(h.by, { branch: target.branch, limit: 2 }));
    expect(first.entries.map((one) => one.revision)).toEqual([3, 2]);
    expect(first.next).toBe(2);
    const second = value(
      await h.display.history(h.by, { branch: target.branch, limit: 2, before: first.next! }),
    );
    expect(second).toMatchObject({ entries: [{ revision: 1, reason: 'At 13100' }], next: null });
    expect(await h.display.history(h.by, { limit: 101 })).toMatchObject({
      ok: false,
      error: { code: 'prc.history-query-invalid' },
    });
    expect(
      await h.display.history(h.by, { branch: 'nope' } as unknown as { branch: never }),
    ).toMatchObject({ ok: false, error: { code: 'prc.history-query-invalid' } });
  });

  it('asks a history of one branch at that branch, and one of every branch at the tenant-wide place', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.asked.length = 0;

    value(await h.display.history(h.by, { branch: target.branch }));
    value(await h.display.history(h.by, {}));

    // SEC admits a question with no branch only for a tenant-wide grant, so a
    // person confined to branches reads their branches' history by naming one.
    expect(h.asked).toContainEqual({
      right: PRC_PERMISSIONS.price.history,
      where: { branch: target.branch },
    });
    expect(h.asked).toContainEqual({ right: PRC_PERMISSIONS.price.history, where: undefined });
  });

  it('refuses each operation without its right, and a system context with no person to approve', async () => {
    const h = installed();
    const { target } = await aPricedItem(h);
    h.rate(target.branch, '13100');
    const preview = value(await h.display.preview(h.by, target));
    expect(
      await h.display.approve(h.system, {
        ...target,
        expectedRevision: 0,
        proposed: preview.proposed,
        usdRevision: 1,
        rateRevision: preview.basis.rate.revision,
        reason: 'Nobody',
        operation: newId<'price-operation'>(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'prc.not-permitted' } });

    h.withhold(PRC_PERMISSIONS.display.edit);
    expect(await h.display.preview(h.by, target)).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
    h.withhold(PRC_PERMISSIONS.price.history);
    expect(await h.display.history(h.by, {})).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
    h.withhold(PRC_PERMISSIONS.display.view);
    expect(await h.display.get(h.by, target)).toMatchObject({
      ok: false,
      error: { code: 'prc.not-permitted' },
    });
  });
});
