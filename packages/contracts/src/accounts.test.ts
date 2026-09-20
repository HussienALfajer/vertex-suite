import { describe, expect, it } from 'vitest';

import {
  isReservedAccount,
  PER_CURRENCY_ACCOUNT,
  RESERVED_ACCOUNTS,
  type ReservedAccount,
} from './accounts.js';

describe('the purposes of the system-reserved accounts', () => {
  // Named without a feature identifier on purpose: a test's name is a claim of
  // proof, and this one proves a list, not the ledger.
  it('names the seven the ledger reserves, and the two that rounding and opening balances cannot do without', () => {
    expect(RESERVED_ACCOUNTS).toEqual([
      'inventory',
      'cogs',
      'receivables',
      'payables',
      'cash',
      'fx-gain-loss',
      'shrinkage',
      'rounding',
      'opening-equity',
    ]);
    expect(Object.isFrozen(RESERVED_ACCOUNTS)).toBe(true);
  });

  it('judges a name at run time, because a declaration reaches the platform off a wire too', () => {
    for (const purpose of RESERVED_ACCOUNTS) expect(isReservedAccount(purpose)).toBe(true);
    expect(isReservedAccount('Inventory')).toBe(false);
    expect(isReservedAccount('stock')).toBe(false);
    expect(isReservedAccount('')).toBe(false);
  });

  it('resolves cash per currency, and every other purpose on its own', () => {
    const cash: ReservedAccount = PER_CURRENCY_ACCOUNT;
    expect(cash).toBe('cash');
    expect(RESERVED_ACCOUNTS.filter((one) => one === PER_CURRENCY_ACCOUNT)).toHaveLength(1);
  });
});
