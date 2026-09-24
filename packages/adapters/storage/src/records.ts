import { createHash, randomBytes } from 'node:crypto';
import { SerialisationConflictError, type MemorySession } from '@vertex/platform';

export interface StoredRow {
  readonly key: string;
  readonly value: string;
  readonly digest: string;
}

export interface Change {
  readonly key: string;
  readonly row: StoredRow | null;
}

function valid(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) return;
    throw new TypeError('A persisted number must be an exact safe integer; use a decimal string.');
  }
  if (typeof value !== 'object')
    throw new TypeError('An unsupported or undefined persisted value.');
  if (seen.has(value)) throw new TypeError('A circular persisted reference is unsupported.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const extra = Reflect.ownKeys(value).filter(
        (key) =>
          typeof key !== 'string' ||
          (key !== 'length' && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)),
      );
      if (extra.length !== 0) throw new TypeError('Extra array properties cannot be persisted.');
      for (let i = 0; i < value.length; i += 1) {
        if (!(i in value)) throw new TypeError('A sparse persisted array is unsupported.');
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          throw new TypeError('A persisted array index must be an enumerable value.');
        }
        valid(descriptor.value, seen);
      }
    } else {
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype) {
        throw new TypeError('A persisted value must contain plain objects and arrays only.');
      }
      if (Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError('Symbol properties cannot be persisted.');
      }
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (!('value' in descriptor)) throw new TypeError('A persisted accessor is unsupported.');
        if (!descriptor.enumerable)
          throw new TypeError('A non-enumerable persisted property is unsupported.');
        valid(descriptor.value, seen);
      }
    }
  } finally {
    // JSON duplicates a shared child on each path. Only an ancestor still on
    // the current path is a cycle; SEC roles share their rights and seed arrays.
    seen.delete(value);
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function encode(key: string, value: unknown): StoredRow {
  if (typeof key !== 'string') throw new TypeError('A record key must be a string.');
  valid(value, new Set());
  const text = JSON.stringify(value);
  return { key, value: text, digest: digest(text) };
}

export function decode(row: StoredRow): unknown {
  if (
    typeof row.key !== 'string' ||
    typeof row.value !== 'string' ||
    typeof row.digest !== 'string' ||
    digest(row.value) !== row.digest
  ) {
    throw new Error(`Corrupted persisted record at ${row.key}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(row.value) as unknown;
    valid(value, new Set());
  } catch (cause) {
    throw new Error(`Unsupported persisted record at ${row.key}.`, { cause });
  }
  return value;
}

/**
 * What is committed at one revision of the store, read and verified once, and
 * shared by every transaction that begins at that revision.
 *
 * A transaction used to begin by reading and verifying every row in the store:
 * the digest recomputed, the JSON parsed, the shape walked. That is a cost in
 * proportion to the whole store paid by every command, however little it
 * touched — at thirty thousand items (`CAT-15`) it alone was more than the
 * register's whole budget for a search. The revision counter is what makes it
 * unnecessary. Every commit through these drivers advances it in the same
 * database transaction as its rows, so two readings of the same revision are
 * readings of the same rows, and the second can be the first one's memory.
 *
 * Verification moves with the read, not away: a row is still checked against
 * its digest before anything is served from it — when it is loaded, which is
 * when the store is opened and whenever another process has committed since.
 * What changes is that a row corrupted on disk behind a running store is
 * found by the next load rather than by the next command; until then the
 * running store serves the value it verified, never the damaged one.
 *
 * Immutable once built: a commit produces the next revision as a new value
 * (`advance`), so a transaction that began earlier goes on reading exactly
 * the revision it began at.
 */
export interface Committed {
  readonly version: number;
  /**
   * Written with the counter by every commit, and never the same twice. The
   * counter alone can repeat: restore a backup under a running store and let
   * another process commit back up to the number this one holds, and the same
   * number names different rows. The pair cannot.
   */
  readonly epoch: string;
  readonly records: ReadonlyMap<string, StoredRow>;
  /**
   * The keys, sorted: computed once per revision, on the first listing that asks.
   * A function rather than a method: it uses no `this`, so a later revision
   * can hold the function alone.
   */
  readonly keys: () => readonly string[];
}

function committedFrom(
  version: number,
  epoch: string,
  records: ReadonlyMap<string, StoredRow>,
  sortedKeys: () => readonly string[],
): Committed {
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Corrupted store revision.');
  let keys: readonly string[] | undefined;
  // Released once the listing exists. What derives it reaches back to the
  // revision before this one, and a revision held for its listing used to
  // hold every revision before it, each with a whole copy of the store's
  // records: a batch of a hundred commits over a store of half a million rows
  // kept gigabytes alive that nothing could read.
  let derive: (() => readonly string[]) | null = sortedKeys;
  return {
    version,
    epoch,
    records,
    keys: () => {
      if (keys === undefined) {
        if (derive === null) throw new Error('A revision lost its listing.');
        keys = Object.freeze([...derive()]);
        derive = null;
      }
      return keys;
    },
  };
}

/** A fresh epoch for a commit to write beside the counter it advances. */
export function newEpoch(): string {
  return randomBytes(16).toString('hex');
}

/** Verifies every row read at one revision; a single bad row refuses the whole load. */
export function committed(version: number, epoch: string, rows: readonly StoredRow[]): Committed {
  const records = new Map<string, StoredRow>();
  for (const row of rows) {
    decode(row);
    if (records.has(row.key)) throw new Error(`Duplicate persisted record at ${row.key}.`);
    records.set(row.key, row);
  }
  return committedFrom(version, epoch, records, () => [...records.keys()].sort());
}

/**
 * A sorted listing with keys added and removed, without sorting it again:
 * the few changed keys are sorted and merged into the many that were already
 * in order. A commit that creates an item adds three keys to a store of a
 * hundred thousand, and re-sorting all of them for that was most of its cost.
 */
function reshape(
  sorted: readonly string[],
  added: ReadonlySet<string>,
  removed: ReadonlySet<string>,
): readonly string[] {
  const incoming = [...added].sort();
  const merged: string[] = [];
  let at = 0;
  for (const key of sorted) {
    while (at < incoming.length && (incoming[at] ?? '') < key) merged.push(incoming[at++] ?? '');
    if (!removed.has(key)) merged.push(key);
  }
  while (at < incoming.length) merged.push(incoming[at++] ?? '');
  return merged;
}

/** Which keys a set of changes adds to, or removes from, what is already there. */
function delta(
  has: (key: string) => boolean,
  changes: Iterable<readonly [string, StoredRow | null]>,
): { added: Set<string>; removed: Set<string> } {
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const [key, row] of changes) {
    if (row === null) {
      added.delete(key);
      if (has(key)) removed.add(key);
    } else if (!has(key)) added.add(key);
    else removed.delete(key);
  }
  return { added, removed };
}

/**
 * The revision a successful commit produced: the one it began at, with its
 * changes applied, under the epoch the commit wrote. Only a driver that has
 * just committed may call this — the commit's own revision check is what
 * proves that nothing else came between.
 */
export function advance(base: Committed, changes: readonly Change[], epoch: string): Committed {
  const records = new Map(base.records);
  const { added, removed } = delta(
    (key) => base.records.has(key),
    changes.map(({ key, row }) => [key, row] as const),
  );
  for (const { key, row } of changes) {
    if (row === null) records.delete(key);
    else records.set(key, row);
  }
  return committedFrom(base.version + 1, epoch, records, listingAfter(base.keys, added, removed));
}

/**
 * How a revision's listing is derived from the one before it: the earlier
 * listing, with the keys this commit added and removed.
 *
 * Built here and not inline in `advance`, because every closure made inside a
 * function shares that function's scope: one written beside `advance`'s own
 * `base.records.has` would hold `base` — a whole copy of the store — and
 * through its listing every revision before it, for as long as this revision
 * is held and unlisted. This closure holds the earlier listing's function and
 * the two sets, and nothing else.
 *
 * Most commits only update; they keep the listing as it was. The listing is
 * derived lazily either way, so a revision nobody lists never pays for it.
 */
function listingAfter(
  earlier: () => readonly string[],
  added: ReadonlySet<string>,
  removed: ReadonlySet<string>,
): () => readonly string[] {
  return () =>
    added.size === 0 && removed.size === 0 ? earlier() : reshape(earlier(), added, removed);
}

/**
 * The one revision a store keeps in memory: the latest it has read or written.
 *
 * It answers only for the exact revision and epoch it holds. A revision read
 * from the database always replaces it, because the database is the truth —
 * including after a restore that moved the counter backwards.
 * One produced by a commit replaces it only when it is newer, so two commands
 * finishing out of order cannot leave the older behind.
 */
export interface Revisions {
  at(version: number, epoch: string): Committed | null;
  loaded(revision: Committed): void;
  advanced(revision: Committed): void;
}

export function revisions(): Revisions {
  let latest: Committed | null = null;
  return {
    at: (version, epoch) => (latest?.version === version && latest.epoch === epoch ? latest : null),
    loaded(revision) {
      latest = revision;
    },
    advanced(revision) {
      if (latest === null || latest.version < revision.version) latest = revision;
    },
  };
}

interface State {
  readonly base: Committed;
  readonly changes: Map<string, StoredRow | null>;
  /** This transaction's listing, until it next writes. */
  listed: readonly string[] | null;
  active: boolean;
}

export interface Snapshot {
  readonly session: MemorySession;
  readonly version: number;
  /** The revision this transaction reads, and the one its commit advances. */
  readonly base: Committed;
  changes(): readonly Change[];
  end(): void;
}

/**
 * Parses a row that has already been verified — on load, or by `encode` when
 * this transaction wrote it. A fresh value every time, as a database would
 * return: a command that edits what it read has not edited the store.
 */
function parse(row: StoredRow): unknown {
  return JSON.parse(row.value) as unknown;
}

export function snapshot(base: Committed): Snapshot {
  const state: State = { base, changes: new Map(), listed: null, active: true };
  const check = (): void => {
    if (!state.active) throw new Error('This transaction has already ended.');
  };
  const session: MemorySession = {
    put(key, value) {
      check();
      state.changes.set(key, encode(key, value));
      state.listed = null;
    },
    get(key) {
      check();
      const row = state.changes.has(key) ? state.changes.get(key) : state.base.records.get(key);
      return row === null || row === undefined ? undefined : parse(row);
    },
    remove(key) {
      check();
      state.changes.set(key, null);
      state.listed = null;
    },
    keys() {
      check();
      if (state.changes.size === 0) return state.base.keys();
      // Kept until this transaction next writes, so a command that lists twice
      // after a write merges its changes once.
      if (state.listed === null) {
        const { added, removed } = delta((key) => state.base.records.has(key), state.changes);
        state.listed = Object.freeze([...reshape(state.base.keys(), added, removed)]);
      }
      return state.listed;
    },
  };
  return {
    session,
    version: state.base.version,
    base: state.base,
    changes() {
      check();
      return [...state.changes].map(([key, row]) => ({ key, row }));
    },
    end() {
      state.active = false;
      state.changes.clear();
    },
  };
}

export function conflict(): SerialisationConflictError {
  return new SerialisationConflictError(
    'Another command committed after this snapshot. Nothing was written; retry the command against the current store.',
  );
}
