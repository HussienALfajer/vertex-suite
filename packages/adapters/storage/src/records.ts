import { createHash } from 'node:crypto';
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
  readonly records: ReadonlyMap<string, StoredRow>;
  /** The keys, sorted: computed once per revision, on the first listing that asks. */
  keys(): readonly string[];
}

function committedFrom(
  version: number,
  records: ReadonlyMap<string, StoredRow>,
  sorted?: readonly string[],
): Committed {
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Corrupted store revision.');
  let keys = sorted;
  return {
    version,
    records,
    keys() {
      keys ??= Object.freeze([...records.keys()].sort());
      return keys;
    },
  };
}

/** Verifies every row read at one revision; a single bad row refuses the whole load. */
export function committed(version: number, rows: readonly StoredRow[]): Committed {
  const records = new Map<string, StoredRow>();
  for (const row of rows) {
    decode(row);
    if (records.has(row.key)) throw new Error(`Duplicate persisted record at ${row.key}.`);
    records.set(row.key, row);
  }
  return committedFrom(version, records);
}

/**
 * The revision a successful commit produced: the one it began at, with its
 * changes applied. Only a driver that has just committed may call this — the
 * commit's own revision check is what proves that nothing else came between.
 */
export function advance(base: Committed, changes: readonly Change[]): Committed {
  const records = new Map(base.records);
  let reshaped = false;
  for (const { key, row } of changes) {
    if (row === null) reshaped = records.delete(key) || reshaped;
    else {
      reshaped = reshaped || !records.has(key);
      records.set(key, row);
    }
  }
  // An update that neither adds nor removes a key leaves the listing as it
  // was, which is most commits; only one that reshapes the store sorts again.
  return committedFrom(base.version + 1, records, reshaped ? undefined : base.keys());
}

/**
 * The one revision a store keeps in memory: the latest it has read or written.
 *
 * A revision read from the database always replaces it, because the database
 * is the truth — including after a restore that moved the counter backwards.
 * One produced by a commit replaces it only when it is newer, so two commands
 * finishing out of order cannot leave the older behind.
 */
export interface Revisions {
  at(version: number): Committed | null;
  loaded(revision: Committed): void;
  advanced(revision: Committed): void;
}

export function revisions(): Revisions {
  let latest: Committed | null = null;
  return {
    at: (version) => (latest?.version === version ? latest : null),
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
  const state: State = { base, changes: new Map(), active: true };
  const check = (): void => {
    if (!state.active) throw new Error('This transaction has already ended.');
  };
  const session: MemorySession = {
    put(key, value) {
      check();
      state.changes.set(key, encode(key, value));
    },
    get(key) {
      check();
      const row = state.changes.has(key) ? state.changes.get(key) : state.base.records.get(key);
      return row === null || row === undefined ? undefined : parse(row);
    },
    remove(key) {
      check();
      state.changes.set(key, null);
    },
    keys() {
      check();
      if (state.changes.size === 0) return state.base.keys();
      const keys = new Set(state.base.keys());
      for (const [key, row] of state.changes) {
        if (row === null) keys.delete(key);
        else keys.add(key);
      }
      return [...keys].sort();
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
