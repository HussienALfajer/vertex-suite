import type { Anchor } from './spec.js';

/**
 * Linear interpolation across an anchor table, clamped at both ends.
 *
 * Linear, not a spline. This was established by reconstruction: linear
 * interpolation reproduces every one of the twelve published lightness anchors
 * and thirty of the thirty-five ramp stops exactly, where a monotone cubic
 * reproduces fewer. The method is recorded here because Appendix A originally
 * said only "interpolated", and an unstated interpolation makes a palette that
 * cannot be reproduced.
 */
export function interpolate(at: number, anchors: readonly Anchor[]): number {
  const points = [...anchors].sort((a, b) => a.at - b.at);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('An interpolation needs at least one anchor.');
  }
  if (at <= first.at) return first.value;
  if (at >= last.at) return last.value;

  for (let i = 0; i < points.length - 1; i += 1) {
    const low = points[i];
    const high = points[i + 1];
    if (low === undefined || high === undefined) continue;
    if (at >= low.at && at <= high.at) {
      const span = high.at - low.at;
      const t = span === 0 ? 0 : (at - low.at) / span;
      return low.value + t * (high.value - low.value);
    }
  }
  return last.value;
}
