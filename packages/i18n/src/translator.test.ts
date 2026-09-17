import { describe, expect, it } from 'vitest';

import { formattingLocale, MissingMessageError, Translator } from './translator.js';

const catalogue = {
  'item.count':
    '{count, plural, zero {لا {term:item}} one {{term:item} واحد} two {{term:item}ان} few {# {term:item}} many {# {term:item}} other {# {term:item}}}',
  'item.title': '{term:item}',
  'branch.title': '{term:branch}',
  greeting: 'مرحبا {name}',
};

const terms = { item: 'صنف', branch: 'فرع' };

const arabic = (tenantTerms?: Record<string, string>): Translator =>
  new Translator({
    locale: 'ar',
    catalogue,
    terms,
    ...(tenantTerms === undefined ? {} : { tenantTerms }),
  });

describe('Translator', () => {
  it('interpolates a value', () => {
    expect(arabic().format('greeting', { name: 'حسين' })).toBe('مرحبا حسين');
  });

  it('selects all six Arabic plural categories', () => {
    // Arabic distinguishes zero, one, two, few, many and other. A message
    // format that only knows one and other is wrong in four of them, which is
    // why ICU is not optional here.
    const t = arabic();
    const shapes = [0, 1, 2, 3, 11, 100].map((count) => t.format('item.count', { count }));
    expect(new Set(shapes).size).toBe(6);
    expect(shapes[0]).toBe('لا صنف');
    expect(shapes[1]).toBe('صنف واحد');
    expect(shapes[2]).toBe('صنفان');
  });

  it('resolves the product term when the tenant overrides nothing', () => {
    expect(arabic().format('item.title')).toBe('صنف');
  });

  it('lets a tenant rename a concept without touching a message', () => {
    // The mechanism SYS-08 will be built on; the feature is U27's to prove.
    const t = arabic({ item: 'مادة' });
    expect(t.format('item.title')).toBe('مادة');
    // And the renaming reaches inside a plural, not just a bare label.
    expect(t.format('item.count', { count: 1 })).toBe('مادة واحد');
  });

  it('a tenant override does not disturb the terms it does not name', () => {
    const t = arabic({ item: 'مادة' });
    expect(t.format('branch.title')).toBe('فرع');
  });

  it('throws on a missing key by default', () => {
    expect(() => arabic().format('nope')).toThrow(MissingMessageError);
  });

  it('can be told to degrade instead of throwing', () => {
    const t = new Translator({
      locale: 'ar',
      catalogue,
      onMissing: (key) => key,
    });
    expect(t.format('nope')).toBe('nope');
  });

  it('reports what it can answer for', () => {
    expect(arabic().has('item.title')).toBe(true);
    expect(arabic().has('nope')).toBe(false);
  });

  it('formats Western digits by default, as §5.5 requires', () => {
    // Arabic-Indic digits are a per-tenant *display* setting and must never
    // affect a stored value or a parse.
    expect(arabic().format('item.count', { count: 100 })).toContain('100');
  });
});

describe('Translator — what a plain object would answer by accident', () => {
  it('answers only for its own keys and terms, not for what every object inherits', () => {
    const t = arabic();
    expect(t.has('toString')).toBe(false);
    expect(() => t.format('constructor')).toThrow(MissingMessageError);

    const naming = new Translator({ locale: 'ar', catalogue: { odd: '{term:constructor}' } });
    expect(naming.format('odd')).toBe('constructor');
  });
});

describe('Translator — §5.5 numerals', () => {
  const counted = { 'items.count': '{count, number} صنف' };

  it('writes Western digits by default even where the locale writes Arabic-Indic ones', () => {
    // `ar-SY` is the market this product is sold in, and its ICU default is
    // Arabic-Indic — a message printed `١٢` beside money printed `12`.
    const t = new Translator({ locale: 'ar-SY', catalogue: counted });
    expect(t.format('items.count', { count: 1234 })).toBe('1,234 صنف');
  });

  it('writes Arabic-Indic digits when the tenant chose them, and changes nothing else', () => {
    const t = new Translator({ locale: 'ar', catalogue: counted }).withNumerals('arab');
    expect(t.numerals).toBe('arab');
    expect(t.format('items.count', { count: 12 })).toBe('١٢ صنف');
  });

  it('builds a formatting locale for a tag that already carries an extension', () => {
    // Appending `-u-nu-latn` to `ar-u-ca-gregory` makes a tag Intl refuses.
    expect(formattingLocale('ar-u-ca-gregory', 'latn')).toBe('ar-u-ca-gregory-nu-latn');
    expect(() => new Intl.NumberFormat(formattingLocale('ar-u-ca-gregory', 'arab'))).not.toThrow();
  });
});
