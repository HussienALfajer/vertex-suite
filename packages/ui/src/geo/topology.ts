import type { GeometryObject, Objects, Properties, Topology } from 'topojson-specification';

/**
 * Cutting an atlas down to the countries an edition actually ships to.
 *
 * TopoJSON's whole economy is that neighbouring shapes share the line between
 * them: a geometry holds indexes into one arc table rather than its own copy of
 * every coordinate. Filtering the geometries therefore saves nothing on its
 * own — every arc in the world stays in the file, unreferenced — so the arcs
 * have to be swept and the indexes rewritten.
 *
 * This runs at build time, not in a shop. It lives beside the runtime anyway
 * because it is the half of the generated atlas that can be wrong in a way the
 * eye cannot see: a mis-swept index draws Syria's border through Iraq, which is
 * exactly the sort of thing to hold a test against rather than a screenshot.
 */

/** An arc index, negative for an arc traversed backwards, at any nesting depth. */
type ArcTree = number | ArcTree[];

type Geometry = GeometryObject<Properties>;

function isArcTree(value: unknown): value is ArcTree[] {
  return Array.isArray(value);
}

function walk(tree: ArcTree, onIndex: (index: number) => void): void {
  if (typeof tree === 'number') {
    // `~n` is the specification's own spelling for "this arc, reversed".
    onIndex(tree < 0 ? ~tree : tree);
    return;
  }
  for (const branch of tree) walk(branch, onIndex);
}

function rewrite(tree: ArcTree, moved: ReadonlyMap<number, number>): ArcTree {
  if (typeof tree === 'number') {
    const reversed = tree < 0;
    const next = moved.get(reversed ? ~tree : tree);
    if (next === undefined) {
      throw new Error('An arc survived the sweep without being kept. This is a defect.');
    }
    return reversed ? ~next : next;
  }
  return tree.map((branch) => rewrite(branch, moved));
}

function arcsOf(geometry: Geometry): ArcTree[] | null {
  if (geometry.type === 'GeometryCollection' || geometry.type === null) return null;
  if (geometry.type === 'Point' || geometry.type === 'MultiPoint') return null;
  return isArcTree(geometry.arcs) ? geometry.arcs : null;
}

/**
 * The geometries of every collection in `topology` that `keep` accepts, and
 * nothing else — no unreferenced arc, no empty collection.
 *
 * Geometries outside a collection are kept as they are: this exists to trim a
 * country list, and inventing a rule for a shape that is not in one would be a
 * rule with no caller to check it.
 */
export function narrow(topology: Topology, keep: (geometry: Geometry) => boolean): Topology {
  const objects: Objects<Properties> = {};
  for (const [name, object] of Object.entries(topology.objects)) {
    objects[name] =
      object.type === 'GeometryCollection'
        ? { ...object, geometries: object.geometries.filter(keep) }
        : object;
  }

  const used = new Set<number>();
  for (const object of Object.values(objects)) {
    const geometries = object.type === 'GeometryCollection' ? object.geometries : [object];
    for (const geometry of geometries) {
      const arcs = arcsOf(geometry);
      if (arcs !== null) walk(arcs, (index) => used.add(index));
    }
  }

  // In their original order, so the output is a subsequence of the input rather
  // than a reshuffle: a diff of a regenerated atlas then shows what changed.
  const moved = new Map<number, number>();
  const arcs: Topology['arcs'] = [];
  topology.arcs.forEach((arc, index) => {
    if (!used.has(index)) return;
    moved.set(index, arcs.length);
    arcs.push(arc);
  });

  const narrowed: Objects<Properties> = {};
  for (const [name, object] of Object.entries(objects)) {
    if (object.type !== 'GeometryCollection') {
      narrowed[name] = object;
      continue;
    }
    narrowed[name] = {
      ...object,
      geometries: object.geometries.map((geometry) => {
        const of = arcsOf(geometry);
        return of === null ? geometry : { ...geometry, arcs: rewrite(of, moved) };
      }) as typeof object.geometries,
    };
  }

  return { ...topology, arcs, objects: narrowed };
}
