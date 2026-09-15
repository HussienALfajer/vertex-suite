import { describe, expect, it } from 'vitest';

import {
  andThen,
  err,
  isErr,
  isOk,
  mapError,
  mapOk,
  ok,
  orThrow,
  refusal,
  refuse,
  unwrapOr,
  type Refusal,
  type Result,
} from './result.js';

const success: Result<number, string> = ok(1);
const failure: Result<number, string> = err('no');

describe('Result', () => {
  it('narrows to one branch or the other', () => {
    expect(isOk(success) && success.value).toBe(1);
    expect(isErr(failure) && failure.error).toBe('no');
  });

  it('transforms one side and leaves the other untouched', () => {
    expect(mapOk(success, (n: number) => n * 2)).toEqual(ok(2));
    expect(mapOk(failure, (n: number) => n * 2)).toEqual(err('no'));
    expect(mapError(failure, (e: string) => `${e}!`)).toEqual(err('no!'));
    expect(mapError(success, (e: string) => `${e}!`)).toEqual(ok(1));
  });

  it('carries the first refusal out of a chain', () => {
    const chain = (start: Result<number, string>): Result<string, string> =>
      andThen(
        andThen(start, (n) => (n > 0 ? ok(n + 1) : err('not positive'))),
        (n) => ok(String(n)),
      );

    expect(chain(ok(1))).toEqual(ok('2'));
    expect(chain(ok(-1))).toEqual(err('not positive'));
    expect(chain(err('nothing to start from'))).toEqual(err('nothing to start from'));
  });

  it('falls back to a stated value', () => {
    expect(unwrapOr(failure, 7)).toBe(7);
    expect(unwrapOr(success, 7)).toBe(1);
  });

  it('gives up in the terms of whichever boundary gave up', () => {
    expect(orThrow(success, () => new Error('unreachable'))).toBe(1);
    expect(() => orThrow(failure, (e) => new Error(e))).toThrow('no');
  });
});

describe('Refusal', () => {
  it('carries a code and its values, never a sentence', () => {
    const over = refusal('sal.credit-limit-exceeded', { customer: 'Abu Ahmad', excess: 125_000 });
    expect(over.code).toBe('sal.credit-limit-exceeded');
    expect(over.values).toEqual({ customer: 'Abu Ahmad', excess: 125_000 });
  });

  it('copies and freezes its values, so nothing can edit a refusal it was handed', () => {
    const values = { period: '2026-03' };
    const closed = refusal('fin.period-closed', values);
    values.period = '2026-04';

    expect(closed.values).toEqual({ period: '2026-03' });
    expect(Object.isFrozen(closed)).toBe(true);
    expect(Object.isFrozen(closed.values)).toBe(true);
  });

  it('builds a refused outcome in one call', () => {
    const outcome: Result<never, Refusal<'prc.below-minimum'>> = refuse('prc.below-minimum', {
      item: 'SKU-1',
    });
    expect(isErr(outcome) && outcome.error.code).toBe('prc.below-minimum');
  });

  it('needs no values at all', () => {
    expect(refusal('cnt.session-frozen').values).toEqual({});
  });
});
