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

  it('does not mistake a numbering system or a private-use tag for a script', () => {
    // `en-u-nu-arab` is English written with Arabic-Indic digits — the tag
    // `formattingLocale` builds for the numeral setting — and `arab` after the
    // `u` singleton is the numbering system, not the script. It once read as
    // right-to-left, and `ar-u-nu-latn` would have read as left-to-right.
    expect(directionOf('en-u-nu-arab')).toBe('ltr');
    expect(directionOf('ar-u-nu-latn')).toBe('rtl');
    expect(directionOf('en-x-arab')).toBe('ltr');
    // A script before the extension still counts.
    expect(directionOf('ku-Arab-u-nu-latn')).toBe('rtl');
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
