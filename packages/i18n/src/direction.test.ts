import { describe, expect, it } from 'vitest';

import { directionOf } from './direction.js';

describe('directionOf', () => {
  it('reads the languages this product ships in', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('ar-SY')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('en-GB')).toBe('ltr');
  });

  it('lets the script overrule the language', () => {
    // Kurdish is written in both directions depending on where it is written.
    expect(directionOf('ckb-Arab-IQ')).toBe('rtl');
    expect(directionOf('ku-Latn-TR')).toBe('ltr');
    expect(directionOf('ar-Latn')).toBe('ltr');
  });

  it('accepts the tags older systems still emit', () => {
    expect(directionOf('iw')).toBe('rtl');
    expect(directionOf('ji')).toBe('rtl');
    expect(directionOf('AR_sy')).toBe('rtl');
    expect(directionOf('  he  ')).toBe('rtl');
  });

  it('treats what it does not recognise as left-to-right', () => {
    expect(directionOf('')).toBe('ltr');
    expect(directionOf('zz')).toBe('ltr');
    expect(directionOf('not a locale')).toBe('ltr');
  });
});
