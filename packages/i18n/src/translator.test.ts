import { describe, expect, it } from 'vitest';

import { MissingMessageError, Translator } from './translator.js';

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

  it('lets a tenant rename a concept without touching a message — SYS-08', () => {
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
