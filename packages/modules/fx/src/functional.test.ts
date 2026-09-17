import { isOk, type Refusal, type Result } from '@vertex/kernel';
import { systemContext } from '@vertex/platform';
import { beforeEach, describe, expect, it } from 'vitest';

import { installFx, type Installed } from './edition.fixture.js';

function taken<T>(result: Result<T, Refusal>): T {
  if (isOk(result)) return result.value;
  throw new Error(`refused: ${result.error.code}`);
}

function refusalOf<T>(result: Result<T, Refusal>): string {
  if (isOk(result)) throw new Error('Expected a refusal; the command succeeded.');
  return result.error.code;
}

let fx: Installed;

beforeEach(() => {
  fx = installFx();
});

describe('Functional currency — FX-02', () => {
  it('keeps the books in USD for a tenant that has not chosen otherwise', async () => {
    taken(await fx.admin.seed(fx.system));

    const functional = await fx.read.functional(fx.by);

    expect(functional?.code).toBe('USD');
    expect(functional).toEqual(await fx.read.currency(fx.by, 'USD'));
  });

  it('is a setting of each tenant rather than a constant: two tenants keep their books in two currencies', async () => {
    taken(await fx.admin.seed(fx.system));
    taken(await fx.admin.seed(systemContext(fx.otherTenant)));

    const lira = taken(await fx.admin.makeFunctional(fx.byOther, 'TRY'));

    expect(lira.code).toBe('TRY');
    expect((await fx.read.functional(fx.byOther))?.code).toBe('TRY');
    expect((await fx.read.functional(fx.by))?.code).toBe('USD');
  });

  it('answers with the currency itself, carrying the rules its figures are kept by', async () => {
    taken(await fx.admin.seed(fx.system));
    taken(await fx.admin.revise(fx.by, 'EUR', { decimals: 6 }));

    taken(await fx.admin.makeFunctional(fx.by, 'EUR'));

    expect(await fx.read.functional(fx.by)).toMatchObject({ code: 'EUR', decimals: 6 });
  });

  it('answers null for a tenant never set up, rather than assuming a currency for it', async () => {
    expect(await fx.read.functional(fx.by)).toBeNull();

    taken(await fx.admin.seed(fx.system));
    expect(await fx.read.functional(fx.byOther)).toBeNull();
  });

  it('refuses a currency the tenant does not take, or does not have', async () => {
    taken(await fx.admin.seed(fx.system));
    taken(await fx.admin.disable(fx.by, 'EUR'));

    expect(refusalOf(await fx.admin.makeFunctional(fx.by, 'EUR'))).toBe('fx.currency-disabled');
    expect(refusalOf(await fx.admin.makeFunctional(fx.by, 'GBP'))).toBe('fx.currency-not-found');
    expect((await fx.read.functional(fx.by))?.code).toBe('USD');
  });

  it('refuses to take the functional currency out of use, which would leave the books in nothing', async () => {
    taken(await fx.admin.seed(fx.system));

    expect(refusalOf(await fx.admin.disable(fx.by, 'USD'))).toBe('fx.currency-is-functional');
    expect((await fx.read.currency(fx.by, 'USD'))?.enabled).toBe(true);

    // Once the books move elsewhere, the dollar is an ordinary currency again.
    taken(await fx.admin.makeFunctional(fx.by, 'SYP'));
    expect(taken(await fx.admin.disable(fx.by, 'USD')).enabled).toBe(false);
  });

  it('writes nothing when the currency chosen is the one already chosen', async () => {
    taken(await fx.admin.seed(fx.system));
    const before = new Map(fx.store.committed());

    expect(taken(await fx.admin.makeFunctional(fx.by, 'USD')).code).toBe('USD');
    expect(fx.store.committed()).toEqual(before);
  });

  it('never replaces a choice the tenant made before it was seeded', async () => {
    taken(
      await fx.admin.define(fx.by, {
        code: 'EUR',
        symbol: '€',
        decimals: 4,
        roundingIncrement: '0.01',
        roundingMode: 'half-up',
      }),
    );
    taken(await fx.admin.makeFunctional(fx.by, 'EUR'));

    taken(await fx.admin.seed(fx.system));

    expect((await fx.read.functional(fx.by))?.code).toBe('EUR');
  });

  it('will not seed the dollar as the functional currency of a tenant that took it out of use', async () => {
    const dollar = {
      code: 'USD',
      symbol: '$',
      decimals: 4,
      roundingIncrement: '0.01',
      roundingMode: 'half-up',
    } as const;
    taken(await fx.admin.define(fx.by, dollar));
    taken(await fx.admin.disable(fx.by, 'USD'));
    const before = new Map(fx.store.committed());

    // Making it functional anyway would break the rule above, and putting it
    // back into use would overrule the owner — so seeding stops and says so,
    // before it has written a single currency.
    expect(refusalOf(await fx.admin.seed(fx.system))).toBe('fx.currency-disabled');
    expect(fx.store.committed()).toEqual(before);
    expect(await fx.read.functional(fx.by)).toBeNull();

    // The owner puts it back, and seeding then completes.
    taken(await fx.admin.enable(fx.by, 'USD'));
    taken(await fx.admin.seed(fx.system));
    expect((await fx.read.functional(fx.by))?.code).toBe('USD');
  });
});
