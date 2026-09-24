import { describe, expect, it } from 'vitest';

import { advance, committed, encode, newEpoch, type Committed } from './records.js';

declare const gc: (() => void) | undefined;

/** Collects until the finalisers have had their turn. */
async function collected(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    if (typeof gc !== 'function') throw new Error('Run with --expose-gc (vitest.config.ts).');
    gc();
    await new Promise((resume) => setTimeout(resume, 0));
  }
}

describe('A committed revision of the store', () => {
  it('holds no earlier revision once it is the only one held, listed or not', async () => {
    let revision: Committed = committed(0, newEpoch(), [encode('a', 1), encode('b', 2)]);
    const first = new WeakRef(revision.records);
    revision.keys();
    // Many commits, as a batch of review steps makes: some add keys, some
    // only update, some are listed and some never are.
    for (let n = 0; n < 40; n += 1) {
      const change =
        n % 2 === 0
          ? { key: `x${String(n)}`, row: encode(`x${String(n)}`, n) }
          : { key: 'a', row: encode('a', n) };
      revision = advance(revision, [change], newEpoch());
      // The last twenty are never listed: a run of commits nobody reads.
      if (n < 20 && n % 3 === 0) revision.keys();
    }

    await collected();

    expect(first.deref()).toBeUndefined();
    expect(revision.keys()).toEqual(
      ['a', 'b', ...Array.from({ length: 20 }, (_, n) => `x${String(n * 2)}`)].sort(),
    );
  });
});
