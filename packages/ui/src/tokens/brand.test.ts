import { describe, expect, it } from 'vitest';

import { brandCustomProperties, resolveBrand, type BrandRefused } from './brand.js';
import { contrastRatio } from './contrast.js';

describe('resolveBrand — §4.5', () => {
  it('accepts a dark brand and pairs it with white', () => {
    const result = resolveBrand('#1d4ed8');
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.on).toBe('#ffffff');
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('accepts a light brand and pairs it with the darkest neutral', () => {
    const result = resolveBrand('#fde047');
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.on).not.toBe('#ffffff');
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('accepts shorthand and normalises it', () => {
    const result = resolveBrand('#08F');
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.fill).toBe('#0088ff');
  });

  it('refuses anything that is not a hex colour, and says so', () => {
    for (const input of ['rgb(1,2,3)', 'blue', '', '#12345', 'zzzzzz']) {
      const result = resolveBrand(input);
      expect(result.accepted, input).toBe(false);
      if (result.accepted) continue;
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('refuses a mid-tone that cannot carry either foreground', () => {
    // Too dark for white and too light for the darkest neutral. The document
    // requires such a colour to be refused at upload with an explanation rather
    // than silently accepted, because the alternative is a sign-in screen
    // nobody can read.
    //
    // The band is narrow — among greys it is about one step of luminance wide,
    // which is why the refusal message has to be genuinely helpful: a tenant
    // who lands in it will be surprised.
    const result = resolveBrand('#787878');
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.bestRatio).toBeLessThan(4.5);
    expect(result.reason).toContain('4.5:1 is required');
  });

  it('the refusal band is real and not merely theoretical', () => {
    // Guards the test above from rotting: if a future change to the neutral
    // ramp widened the two foregrounds enough to accept everything, §4.5's
    // refusal path would become dead code and nobody would notice.
    const firstRefusal = (): BrandRefused | null => {
      for (let r = 0; r < 256; r += 8) {
        for (let g = 0; g < 256; g += 8) {
          for (let b = 0; b < 256; b += 8) {
            const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
            const result = resolveBrand(hex);
            if (!result.accepted) return result;
          }
        }
      }
      return null;
    };
    expect(firstRefusal()).not.toBeNull();
  });

  it('never accepts a pair below the target, for any colour', () => {
    // Swept rather than sampled: the invariant is that acceptance and
    // readability are the same thing.
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 51) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          const result = resolveBrand(hex);
          if (result.accepted) {
            expect(contrastRatio(result.on, result.fill), hex).toBeGreaterThanOrEqual(4.5);
          } else {
            expect(result.bestRatio, hex).toBeLessThan(4.5);
          }
        }
      }
    }
  });

  it('exposes exactly the two custom properties the theme expects', () => {
    const result = resolveBrand('#1d4ed8');
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(brandCustomProperties(result)).toEqual({
      '--vx-fill-brand': '#1d4ed8',
      '--vx-on-brand': '#ffffff',
    });
  });
});
