import {
  isErr,
  isOk,
  money,
  round,
  toDecimalString,
  type Refusal,
  type Result,
} from '@vertex/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import { FX_PERMISSIONS, type NewCurrency, type TenantCurrency } from './contract.js';
import { installFx, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code}`);
}

function refusalOf<T>(result: Result<T, Refusal>): string {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error.code;
}

function codesOf(currencies: readonly TenantCurrency[]): readonly string[] {
  return currencies.map((one) => one.code);
}

/** A currency no seed ships, so that anything true of it is true of data rather than of a default. */
const AED: NewCurrency = {
  code: 'AED',
  symbol: 'د.إ',
  decimals: 2,
  roundingIncrement: '0.25',
  roundingMode: 'half-up',
};

/** Characters Arabic keyboards and pasted text carry, and that nothing on screen shows. */
const RIGHT_TO_LEFT_MARK = String.fromCodePoint(0x200f);
const LEFT_TO_RIGHT_MARK = String.fromCodePoint(0x200e);
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

let fx: Installed;

beforeEach(() => {
  fx = installFx();
});

describe('Currencies — FX-01', () => {
  it('seeds SYP, USD, TRY and EUR, each with its own symbol, decimal precision and rounding rule', async () => {
    const seeded = taken(await fx.admin.seed(fx.system));

    expect(codesOf(seeded)).toEqual(['EUR', 'SYP', 'TRY', 'USD']);
    expect(await fx.read.currencies(fx.by)).toEqual(seeded);
    for (const currency of seeded) {
      expect(currency.tenant).toBe(fx.tenant);
      expect(currency.enabled).toBe(true);
      expect(currency.symbol.trim()).not.toBe('');
    }

    const syp = await fx.read.currency(fx.by, 'SYP');
    const usd = await fx.read.currency(fx.by, 'USD');
    expect(syp).toMatchObject({ symbol: 'ل.س', decimals: 2, roundingIncrement: '10' });
    expect(usd).toMatchObject({ symbol: '$', decimals: 4, roundingIncrement: '0.01' });
    expect(await fx.read.currency(fx.by, 'TRY')).toMatchObject({ symbol: '₺' });
    expect(await fx.read.currency(fx.by, 'EUR')).toMatchObject({ symbol: '€' });
  });

  it('settles each currency by its own rule, because the record is the kernel currency itself', async () => {
    taken(await fx.admin.seed(fx.system));
    const syp = (await fx.read.currency(fx.by, 'SYP'))!;
    const usd = (await fx.read.currency(fx.by, 'USD'))!;

    // Handed straight to the kernel, with nothing converted on the way: the
    // pound settles to the ten-pound note and the dollar to the cent, and neither
    // loses what rounding took off.
    const pounds = round(money('13105', syp.code), syp);
    expect(toDecimalString(pounds.value)).toBe('13110');
    expect(toDecimalString(pounds.residual)).toBe('-5');

    const dollars = round(money('10.3664', usd.code), usd);
    expect(toDecimalString(dollars.value)).toBe('10.37');
    expect(toDecimalString(dollars.residual)).toBe('-0.0036');
  });

  it('adds a currency as data: usable at once, with no code change and no schema change', async () => {
    taken(await fx.admin.seed(fx.system));
    const before = fx.registry.migrationPlan('store-node');

    const aed = taken(await fx.admin.define(fx.by, AED));

    expect(aed).toEqual({ tenant: fx.tenant, ...AED, enabled: true });
    expect(codesOf(await fx.read.currencies(fx.by))).toEqual(['AED', 'EUR', 'SYP', 'TRY', 'USD']);
    expect(toDecimalString(round(money('10.13', aed.code), aed).value)).toBe('10.25');
    expect(fx.registry.migrationPlan('store-node')).toEqual(before);
  });

  it('revises a symbol and a rounding rule, and only what was asked', async () => {
    taken(await fx.admin.seed(fx.system));

    // The smallest note the market actually circulates is the owner's to say.
    const revised = taken(
      await fx.admin.revise(fx.by, 'SYP', { roundingIncrement: '500', roundingMode: 'down' }),
    );

    expect(revised).toMatchObject({
      code: 'SYP',
      symbol: 'ل.س',
      decimals: 2,
      roundingIncrement: '500',
      roundingMode: 'down',
      enabled: true,
    });
    expect(toDecimalString(round(money('13499', revised.code), revised).value)).toBe('13000');
    expect(await fx.read.currency(fx.by, 'SYP')).toEqual(revised);
  });

  it('seeds once, and a second seeding changes nothing the owner has revised', async () => {
    taken(await fx.admin.seed(fx.system));
    const revised = taken(await fx.admin.revise(fx.by, 'SYP', { roundingIncrement: '100' }));
    taken(await fx.admin.disable(fx.by, 'TRY'));
    const before = new Map(fx.store.committed());

    // First-run installation can be interrupted and `SYN-02` replays commands;
    // putting the shipped rule back would silently undo the owner's.
    const again = taken(await fx.admin.seed(fx.system));

    expect(again.find((one) => one.code === 'SYP')).toEqual(revised);
    expect(again.find((one) => one.code === 'TRY')?.enabled).toBe(false);
    expect(fx.store.committed()).toEqual(before);
  });

  it('seeds only what is missing, beside a currency the tenant defined first', async () => {
    const euro = taken(
      await fx.admin.define(fx.by, {
        code: 'EUR',
        symbol: 'EUR',
        decimals: 2,
        roundingIncrement: '0.05',
        roundingMode: 'half-even',
      }),
    );

    const seeded = taken(await fx.admin.seed(fx.system));

    expect(seeded.find((one) => one.code === 'EUR')).toEqual(euro);
    expect(codesOf(seeded)).toEqual(['EUR', 'SYP', 'TRY', 'USD']);
  });

  it('refuses a code that is not three capital letters, in the one spelling every amount uses', async () => {
    for (const code of ['syp', 'Syp', 'SY', 'SYPP', ' SYP', 'SYP ', 'S1P', 'ل.س', '']) {
      expect(refusalOf(await fx.admin.define(fx.by, { ...AED, code })), code).toBe(
        'fx.currency-code-invalid',
      );
    }
  });

  it('refuses to define a code twice', async () => {
    taken(await fx.admin.seed(fx.system));

    expect(refusalOf(await fx.admin.define(fx.by, { ...AED, code: 'SYP' }))).toBe(
      'fx.currency-exists',
    );
    expect((await fx.read.currency(fx.by, 'SYP'))?.roundingIncrement).toBe('10');
  });

  it('refuses a symbol with nothing visible in it, and keeps the one it takes without its padding', async () => {
    for (const symbol of ['', '   ', RIGHT_TO_LEFT_MARK, LEFT_TO_RIGHT_MARK + NO_BREAK_SPACE]) {
      expect(
        refusalOf(await fx.admin.define(fx.by, { ...AED, symbol })),
        JSON.stringify(symbol),
      ).toBe('fx.currency-symbol-required');
    }
    expect(taken(await fx.admin.define(fx.by, { ...AED, symbol: '  د.إ ' })).symbol).toBe('د.إ');
  });

  it('refuses a precision an amount could not be stored at', async () => {
    for (const decimals of [-1, 13, 1.5, Number.NaN]) {
      expect(refusalOf(await fx.admin.define(fx.by, { ...AED, decimals })), String(decimals)).toBe(
        'fx.currency-decimals-invalid',
      );
    }
  });

  it('refuses a rounding step that is not a positive exact decimal, whatever it arrived as', async () => {
    const steps: readonly unknown[] = ['0', '-0.25', '1e2', '0,25', ' 0.25', 'abc', 0.25];
    for (const roundingIncrement of steps) {
      const definition = { ...AED, roundingIncrement } as NewCurrency;
      expect(
        refusalOf(await fx.admin.define(fx.by, definition)),
        JSON.stringify(roundingIncrement),
      ).toBe('fx.currency-increment-invalid');
    }
  });

  it('refuses a rounding step finer than the precision a settled amount is stored at', async () => {
    const refused = await fx.admin.define(fx.by, { ...AED, roundingIncrement: '0.005' });

    expect(refusalOf(refused)).toBe('fx.currency-increment-too-fine');
    expect(refused.ok ? null : refused.error.values).toEqual({
      code: 'AED',
      increment: '0.005',
      decimals: '2',
    });
  });

  it('refuses a rounding direction it does not know', async () => {
    const definition = { ...AED, roundingMode: 'half_even' } as unknown as NewCurrency;

    expect(refusalOf(await fx.admin.define(fx.by, definition))).toBe(
      'fx.currency-rounding-mode-unknown',
    );
  });

  it('stores a rounding step in one spelling, however it was typed', async () => {
    const defined = taken(await fx.admin.define(fx.by, { ...AED, roundingIncrement: '0.250' }));
    expect(defined.roundingIncrement).toBe('0.25');

    const revised = taken(await fx.admin.revise(fx.by, 'AED', { roundingIncrement: '.50' }));
    expect(revised.roundingIncrement).toBe('0.5');
  });

  it('raises a precision and never lowers one, so no stored amount becomes one it cannot hold', async () => {
    taken(await fx.admin.seed(fx.system));

    const refused = await fx.admin.revise(fx.by, 'USD', { decimals: 2 });
    expect(refusalOf(refused)).toBe('fx.currency-decimals-reduced');
    expect(refused.ok ? null : refused.error.values).toEqual({ code: 'USD', from: 4, to: '2' });

    expect(taken(await fx.admin.revise(fx.by, 'SYP', { decimals: 4 })).decimals).toBe(4);
    expect((await fx.read.currency(fx.by, 'USD'))?.decimals).toBe(4);
  });

  it('judges a revision as a whole, so a step cannot be made finer than the precision it keeps', async () => {
    taken(await fx.admin.seed(fx.system));

    expect(refusalOf(await fx.admin.revise(fx.by, 'SYP', { roundingIncrement: '0.001' }))).toBe(
      'fx.currency-increment-too-fine',
    );
    expect(refusalOf(await fx.admin.revise(fx.by, 'SYP', { symbol: ' ' }))).toBe(
      'fx.currency-symbol-required',
    );
  });

  it('refuses to revise a currency the tenant does not have', async () => {
    expect(refusalOf(await fx.admin.revise(fx.by, 'AED', { symbol: 'Dh' }))).toBe(
      'fx.currency-not-found',
    );
    expect(refusalOf(await fx.admin.disable(fx.by, 'AED'))).toBe('fx.currency-not-found');
    expect(refusalOf(await fx.admin.enable(fx.by, 'AED'))).toBe('fx.currency-not-found');
  });

  it('takes a currency out of use without losing it, and puts it back', async () => {
    taken(await fx.admin.seed(fx.system));

    const withdrawn = taken(await fx.admin.disable(fx.by, 'TRY'));
    expect(withdrawn.enabled).toBe(false);

    // Out of the list a till offers, and still there for last year's documents.
    expect(codesOf(await fx.read.currencies(fx.by))).toEqual(['EUR', 'SYP', 'USD']);
    expect(codesOf(await fx.read.currencies(fx.by, { including: 'all' }))).toEqual([
      'EUR',
      'SYP',
      'TRY',
      'USD',
    ]);
    expect(await fx.read.currency(fx.by, 'TRY')).toEqual(withdrawn);

    expect(taken(await fx.admin.enable(fx.by, 'TRY')).enabled).toBe(true);
    expect(codesOf(await fx.read.currencies(fx.by))).toEqual(['EUR', 'SYP', 'TRY', 'USD']);
  });

  it('treats a repeated withdrawal as done and writes nothing, so a replayed command cannot fail', async () => {
    taken(await fx.admin.seed(fx.system));
    const first = taken(await fx.admin.disable(fx.by, 'EUR'));
    const before = new Map(fx.store.committed());

    expect(taken(await fx.admin.disable(fx.by, 'EUR'))).toEqual(first);
    expect(fx.store.committed()).toEqual(before);
  });

  it('keeps a revision of a currency out of use out of use', async () => {
    taken(await fx.admin.seed(fx.system));
    taken(await fx.admin.disable(fx.by, 'EUR'));

    expect(taken(await fx.admin.revise(fx.by, 'EUR', { symbol: 'EUR' })).enabled).toBe(false);
  });

  it('offers no way to delete a currency', () => {
    const offered = Object.keys(fx.admin);

    expect(offered).toContain('disable');
    for (const name of ['delete', 'remove', 'destroy', 'purge', 'drop']) {
      expect(offered).not.toContain(name);
    }
  });

  it('writes nothing when a command refuses', async () => {
    taken(await fx.admin.seed(fx.system));
    const before = new Map(fx.store.committed());

    expect(isErr(await fx.admin.define(fx.by, { ...AED, roundingIncrement: '0' }))).toBe(true);
    expect(isErr(await fx.admin.revise(fx.by, 'USD', { decimals: 0 }))).toBe(true);

    expect(fx.store.committed()).toEqual(before);
  });

  it('never shows one tenant the currencies of another', async () => {
    taken(await fx.admin.seed(fx.system));
    taken(await fx.admin.define(fx.by, AED));

    expect(await fx.read.currencies(fx.byOther, { including: 'all' })).toEqual([]);
    expect(await fx.read.currency(fx.byOther, 'AED')).toBeNull();
    expect(refusalOf(await fx.admin.revise(fx.byOther, 'AED', { symbol: 'Dh' }))).toBe(
      'fx.currency-not-found',
    );

    // And the other tenant's own definition of the same code is its own.
    taken(await fx.admin.define(fx.byOther, { ...AED, roundingIncrement: '0.01' }));
    expect((await fx.read.currency(fx.by, 'AED'))?.roundingIncrement).toBe('0.25');
  });
});

describe('Who may change the currencies', () => {
  it('asks the right each command declares, at the tenant-wide place, and runs nothing it is refused', async () => {
    taken(await fx.admin.seed(fx.system));
    const before = new Map(fx.store.committed());
    const { currency, functionalCurrency } = FX_PERMISSIONS;

    const commands: readonly [string, () => Promise<Result<unknown, Refusal>>, string][] = [
      ['seed', () => fx.admin.seed(fx.by), currency.create],
      ['define', () => fx.admin.define(fx.by, AED), currency.create],
      ['revise', () => fx.admin.revise(fx.by, 'SYP', { symbol: 'SYP' }), currency.edit],
      ['disable', () => fx.admin.disable(fx.by, 'EUR'), currency.withdraw],
      ['enable', () => fx.admin.enable(fx.by, 'EUR'), currency.withdraw],
      ['makeFunctional', () => fx.admin.makeFunctional(fx.by, 'EUR'), functionalCurrency.edit],
    ];

    for (const [name, run, right] of commands) {
      const asked: { right: string; where: object | undefined }[] = [];
      fx.answers((_by, one, place) => {
        asked.push({ right: one, where: place });
        return false;
      });

      const refused = await run();

      expect(refusalOf(refused), name).toBe('fx.not-permitted');
      // Named in the refusal, so a screen can say which right is missing.
      expect(refused.ok ? null : refused.error.values, name).toEqual({ right });
      // Undefined is the tenant-wide place, which a branch-confined grant never
      // reaches: a rounding rule holds in every branch at once.
      expect(asked, name).toEqual([{ right, where: undefined }]);
    }

    expect(fx.store.committed()).toEqual(before);
  });

  it('declares its rights in its own namespace, seeding the view to everyone and the rest to the owner alone', () => {
    const declared = new Map(fx.registry.permissions.map((one) => [one.id, one.seededFor ?? []]));
    const { currency, functionalCurrency } = FX_PERMISSIONS;

    expect([...declared.keys()].every((id) => id.startsWith('fx.'))).toBe(true);
    expect(declared.get(currency.view)).toContain('cashier');
    expect(declared.get(functionalCurrency.view)).toContain('cashier');
    // The owner is seeded everything the edition declares by `SEC` itself, so
    // an empty list here is "the owner alone", not "nobody".
    for (const right of [
      currency.create,
      currency.edit,
      currency.withdraw,
      functionalCurrency.edit,
    ]) {
      expect(declared.get(right)).toEqual([]);
    }
  });

  it('lets the system seed a tenant nobody has signed in to yet', async () => {
    fx.answers(() => false);

    expect(codesOf(taken(await fx.admin.seed(fx.system)))).toEqual(['EUR', 'SYP', 'TRY', 'USD']);
  });
});
