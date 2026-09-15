import type { Pixel } from './projection.js';

/**
 * Markers that would overlap, gathered into one that says how many (`SYS-14`).
 *
 * Greedy and in the order it was given, rather than bucketed into a grid. A
 * grid is faster and wrong in a way somebody notices: two shops either side of
 * a cell boundary stay apart however close together they are, and which side
 * of the boundary they fall on changes with the zoom, so markers merge and part
 * as the map moves for no reason a person can see. At the scale this runs at —
 * a chain has branches in tens, not millions — the straightforward answer is
 * both correct and free.
 *
 * Deterministic, which matters twice: the same places always produce the same
 * clusters, so a test can state one; and the order is stable, so the focus
 * order of the markers does not reshuffle under a keyboard between renders.
 */

export interface Placed<T> {
  readonly of: T;
  readonly at: Pixel;
}

export interface Cluster<T> {
  /** Stable across renders: the key of the member that opened the cluster. */
  readonly key: string;
  readonly at: Pixel;
  readonly members: readonly T[];
}

function distance(one: Pixel, two: Pixel): number {
  return Math.hypot(one.x - two.x, one.y - two.y);
}

/**
 * Gathers markers closer together than `radius` pixels.
 *
 * The cluster sits at the mean of its members, recomputed as each joins, so a
 * cluster of three is drawn between them rather than on whichever of them
 * happened to be first.
 */
export function cluster<T>(
  placed: readonly Placed<T>[],
  radius: number,
  keyOf: (of: T) => string,
): readonly Cluster<T>[] {
  const clusters: { key: string; at: Pixel; members: T[] }[] = [];

  for (const one of placed) {
    const near = clusters.find((each) => distance(each.at, one.at) <= radius);
    if (near === undefined) {
      clusters.push({ key: keyOf(one.of), at: one.at, members: [one.of] });
      continue;
    }
    near.members.push(one.of);
    const count = near.members.length;
    near.at = {
      x: near.at.x + (one.at.x - near.at.x) / count,
      y: near.at.y + (one.at.y - near.at.y) / count,
    };
  }

  return clusters.map(({ key, at, members }) => ({ key, at, members }));
}
