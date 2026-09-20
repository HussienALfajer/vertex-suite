import { describe, expect, it } from 'vitest';

import { catalogue, createTranslator, messageForRefusal } from './catalogue.js';

/**
 * Every sentence this application can say, read by the thing that will say it.
 *
 * A message is ICU source, not a string: braces, `select` branches, `plural`
 * categories and number skeletons are compiled the first time the message is
 * formatted, and a message the compiler cannot read **throws** rather than
 * printing badly. Nothing in this repository notices — the key exists, the
 * screen that uses it compiles, and the sentence is only ever built on the path
 * where something was refused, which is the path nobody walks while building
 * the thing that refuses.
 *
 * `refusal.fin.account-reserved` was exactly that. `ReservedAccount` spells two
 * of its nine purposes with hyphens, an ICU selector is an identifier, and a
 * `select` branch called `fx-gain-loss` made the whole message unparseable —
 * so an accountant putting an account under a reserved one would have been
 * shown a crash instead of the reason. It was written, reviewed and merged
 * past a green suite; what found it was parsing the file.
 */

const say = createTranslator();

describe('the catalogue', () => {
  it('holds only messages ICU can read', () => {
    // Formatted with nothing, which is enough: a malformed message fails while
    // it is being **parsed**, before any value is looked at. A missing value is
    // a different complaint, in a different error, and is not what this is for
    // — the arguments a message needs are the business of the screen that
    // sends them, and its own test.
    const unreadable = Object.keys(catalogue).filter((key) => {
      try {
        say.format(key, {});
      } catch (cause) {
        return cause instanceof SyntaxError;
      }
      return false;
    });

    expect(unreadable).toEqual([]);
  });

  it('says why an account is reserved in words, and never in the ledger’s own', () => {
    // The purpose reaches this file as `FIN` spells it. What a shopkeeper reads
    // is the word for it — and the hyphenated ones are the two that broke the
    // message they were once selected inside.
    for (const purpose of ['fx-gain-loss', 'opening-equity', 'inventory']) {
      const written = messageForRefusal(say, {
        code: 'fin.account-reserved',
        values: { account: 'x', reserved: purpose },
      });

      expect(written).not.toContain(purpose);
      expect(written).toContain(catalogue[`account.reserved.${purpose}` as keyof typeof catalogue]);
    }
  });
});
