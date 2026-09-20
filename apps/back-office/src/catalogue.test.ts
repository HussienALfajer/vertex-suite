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

  it('can say every refusal that points at a line, for a line', () => {
    // The mirror of the first test: a message that parses can still throw when
    // it is formatted, over a value it names and was not given. Every message
    // that points somewhere is formatted here with exactly what `FIN` sends
    // for a line of a manual entry, which is the path a screen walks last.
    const pointing = Object.entries(catalogue)
      .filter(([key, message]) => key.startsWith('refusal.fin.') && message.includes('{where'))
      .map(([key]) => key.replace('refusal.', ''));

    expect(pointing).not.toEqual([]);
    for (const code of pointing) {
      const written = messageForRefusal(say, {
        code,
        values: {
          line: 3,
          amount: '1.005',
          currency: 'USD',
          decimals: 2,
          functional: 'USD',
          account: 'USD',
          original: 'EUR',
          reserved: 'cash',
          mediaType: 'text/html',
          size: 11,
          limit: 10,
        },
      });

      expect(written, code).toContain(say.format('refusal.place.line', { line: 3 }));
    }
  });

  it('points a refusal at the opening figure it is about, never at a line nobody saw', () => {
    // `FIN` counts the figures it was given and refuses at "line 2", which is
    // the customers' debts on one form and the till on another, and in an
    // order no screen shows. What the accountant entered is a figure, and the
    // refusal has to say which — and for a till, in which currency.
    const debts = messageForRefusal(say, {
      code: 'fin.line-amount-valueless',
      values: { line: 2, figure: 'customer-debts' },
    });
    expect(debts).toContain(catalogue['opening.figure.customer-debts']);
    expect(debts).not.toContain(say.format('refusal.place.line', { line: 2 }));

    const till = messageForRefusal(say, {
      code: 'fin.line-currency-unknown',
      values: { line: 1, figure: 'till', currency: 'TRY' },
    });
    expect(till).toContain(say.format('refusal.place.till', { currency: 'TRY' }));
    expect(till).not.toContain(say.format('refusal.place.line', { line: 1 }));
  });

  it('says which attachment a refusal is about — or that the list itself was not one', () => {
    // `fin.attachment-invalid` is the one refusal `FIN` makes both about a
    // file, by its place, and about the list of them, with no place at all: a
    // command off a wire whose `attachments` is not a list. The second used to
    // throw over the ordinal it did not have, which is a crash in place of the
    // reason.
    const second = messageForRefusal(say, {
      code: 'fin.attachment-invalid',
      values: { attachment: 2 },
    });
    expect(second).toContain(say.format('refusal.place.attachment', { attachment: 2 }));

    const list = messageForRefusal(say, { code: 'fin.attachment-invalid', values: {} });
    expect(list).toContain(catalogue['refusal.place.attachments']);
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
