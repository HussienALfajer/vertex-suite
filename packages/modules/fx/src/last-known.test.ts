import type { BranchId } from '@vertex/contracts';
import { isOk, newId, type Refusal, type Result } from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RateQuote } from './contract.js';
import { DAY, installFx, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code}`);
}

function refused<T>(result: Result<T, Refusal>): Refusal {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error;
}

const POUNDS: RateQuote = { form: 'units-per-functional', buy: '13100', sell: '12900' };
const EUROS: RateQuote = { form: 'functional-per-unit', buy: '1.07', sell: '1.09' };

let fx: Installed;
let aleppo: BranchId;

beforeEach(async () => {
  fx = installFx();
  taken(await fx.admin.seed(fx.system));
  aleppo = fx.openBranch();
});

/**
 * Yesterday's rates, synced to the register before the line went down, and then
 * the night passes: today there is no rate, and the register cannot ask for one.
 */
async function aRegisterCutOffOvernight() {
  const pounds = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
  const euros = taken(await fx.rateAdmin.record(fx.by, aleppo, 'EUR', EUROS));
  fx.clock.advance(DAY);
  const till = fx.openRegister(aleppo);
  return { pounds, euros, till, atTill: fx.at(till.device) };
}

describe('A register that cannot reach the store node — FX-04', () => {
  it('trades on its most recent synced rate only once a supervisor standing at it confirms that', async () => {
    const { pounds, euros, till, atTill } = await aRegisterCutOffOvernight();

    // Before the confirmation, the rule holds at the register as everywhere.
    expect(refused(await fx.rates.current(atTill, aleppo, 'SYP')).code).toBe('fx.rate-missing');

    const confirmed = taken(await fx.rateAdmin.confirmLastKnown(atTill, aleppo));

    expect(confirmed).toMatchObject({
      tenant: fx.tenant,
      branch: aleppo,
      register: till.register,
      device: till.device,
      day: '2026-09-18',
      confirmedBy: atTill.actor,
    });
    expect(confirmed.rates).toEqual([
      { currency: 'EUR', revision: euros.id, rateDay: '2026-09-17' },
      { currency: 'SYP', revision: pounds.id, rateDay: '2026-09-17' },
    ]);
    expect(taken(await fx.rates.current(atTill, aleppo, 'SYP'))).toEqual({
      revision: pounds,
      lastKnown: confirmed,
    });
  });

  it('says which day the rate is from every time it is read, so no screen can show it as today’s', async () => {
    const { pounds, atTill } = await aRegisterCutOffOvernight();
    taken(await fx.rateAdmin.confirmLastKnown(atTill, aleppo));

    const inForce = taken(await fx.rates.current(atTill, aleppo, 'SYP'));

    expect(inForce.revision.day).toBe('2026-09-17');
    expect(inForce.lastKnown?.day).toBe('2026-09-18');
    expect(inForce.lastKnown?.rates.find((one) => one.currency === 'SYP')?.rateDay).toBe(
      pounds.day,
    );
  });

  it('confirms for that register alone: the store node and the till beside it still have no rate', async () => {
    const { atTill } = await aRegisterCutOffOvernight();
    const beside = fx.openRegister(aleppo);
    taken(await fx.rateAdmin.confirmLastKnown(atTill, aleppo));

    expect(refused(await fx.rates.current(fx.by, aleppo, 'SYP')).code).toBe('fx.rate-missing');
    expect(refused(await fx.rates.current(fx.at(beside.device), aleppo, 'SYP')).code).toBe(
      'fx.rate-missing',
    );
  });

  it('gives way to today’s rate the moment one is there', async () => {
    const { atTill } = await aRegisterCutOffOvernight();
    taken(await fx.rateAdmin.confirmLastKnown(atTill, aleppo));

    const today = taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));

    expect(taken(await fx.rates.current(atTill, aleppo, 'SYP'))).toEqual({
      revision: today,
      lastKnown: null,
    });
  });

  it('lasts for the day it was confirmed on, and a new day needs a new confirmation', async () => {
    const { atTill } = await aRegisterCutOffOvernight();
    taken(await fx.rateAdmin.confirmLastKnown(atTill, aleppo));
    fx.clock.advance(DAY);

    expect(refused(await fx.rates.current(atTill, aleppo, 'SYP')).code).toBe('fx.rate-missing');
  });

  it('confirms once per register per day, and confirming again changes nothing', async () => {
    const { till, atTill } = await aRegisterCutOffOvernight();
    const first = taken(await fx.rateAdmin.confirmLastKnown(atTill, aleppo));
    const before = new Map(fx.store.committed());

    // A second supervisor at the same till, after the shift changes hands.
    const again = taken(await fx.rateAdmin.confirmLastKnown(fx.at(till.device), aleppo));

    expect(again).toEqual(first);
    expect(fx.store.committed()).toEqual(before);
  });

  it('knows the machine however its identifier is spelt, as SYS knows which till it holds', async () => {
    // A UUID is case-insensitive by specification, and `SYS` stores the machine
    // holding a till through `parseId`. A context carrying the same machine in
    // upper case once found no register to confirm at — and a confirmation it
    // did give would have been filed under a key the lower-cased one never read.
    const { till, atTill } = await aRegisterCutOffOvernight();
    const shouted = fx.at(
      till.device.toUpperCase() as typeof till.device,
      atTill.actor ?? undefined,
    );

    const confirmed = taken(await fx.rateAdmin.confirmLastKnown(shouted, aleppo));
    expect(confirmed.device).toBe(till.device);
    expect(confirmed.register).toBe(till.register);

    expect(taken(await fx.rates.current(atTill, aleppo, 'SYP')).lastKnown).toEqual(confirmed);
    expect(taken(await fx.rates.current(shouted, aleppo, 'SYP')).lastKnown).toEqual(confirmed);
  });

  it('covers only the currencies missing today’s rate', async () => {
    const { pounds, atTill } = await aRegisterCutOffOvernight();
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'EUR', EUROS));

    const confirmed = taken(await fx.rateAdmin.confirmLastKnown(atTill, aleppo));

    expect(confirmed.rates).toEqual([
      { currency: 'SYP', revision: pounds.id, rateDay: '2026-09-17' },
    ]);
    expect(taken(await fx.rates.current(atTill, aleppo, 'EUR')).lastKnown).toBeNull();
  });

  it('is not given while today’s rates are all there', async () => {
    const till = fx.openRegister(aleppo);
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'SYP', POUNDS));
    taken(await fx.rateAdmin.record(fx.by, aleppo, 'EUR', EUROS));
    taken(
      await fx.rateAdmin.record(fx.by, aleppo, 'TRY', {
        form: 'units-per-functional',
        buy: '41.5',
        sell: '41.2',
      }),
    );

    expect(refused(await fx.rateAdmin.confirmLastKnown(fx.at(till.device), aleppo)).code).toBe(
      'fx.rates-current',
    );
  });

  it('cannot stand in a rate the register never had', async () => {
    const till = fx.openRegister(aleppo);

    const nothing = refused(await fx.rateAdmin.confirmLastKnown(fx.at(till.device), aleppo));

    expect(nothing.code).toBe('fx.rate-missing');
    expect(nothing.values).toEqual({ branch: aleppo, day: '2026-09-17' });
  });

  it('is confirmed only by somebody standing at a register of that branch', async () => {
    await aRegisterCutOffOvernight();
    const inHoms = fx.openRegister(fx.openBranch());
    const before = new Map(fx.store.committed());

    // At no machine at all: the back office, or the store node's own console.
    expect(refused(await fx.rateAdmin.confirmLastKnown(fx.by, aleppo)).code).toBe(
      'fx.not-at-register',
    );
    // At a till, but one in another branch.
    expect(refused(await fx.rateAdmin.confirmLastKnown(fx.at(inHoms.device), aleppo)).code).toBe(
      'fx.not-at-register',
    );
    // At a machine no till in the shop is assigned to.
    expect(
      refused(await fx.rateAdmin.confirmLastKnown(fx.at(newId<'device'>()), aleppo)).code,
    ).toBe('fx.not-at-register');
    expect(fx.store.committed()).toEqual(before);
  });
});
