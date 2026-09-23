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
  if (seen.has(value))
    throw new TypeError('A shared or circular persisted reference is unsupported.');
  seen.add(value);
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

interface State {
  readonly version: number;
  readonly records: Map<string, StoredRow>;
  readonly changes: Map<string, StoredRow | null>;
  active: boolean;
}

export interface Snapshot {
  readonly session: MemorySession;
  readonly version: number;
  changes(): readonly Change[];
  end(): void;
}

export function snapshot(version: number, rows: readonly StoredRow[]): Snapshot {
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Corrupted store revision.');
  const records = new Map<string, StoredRow>();
  for (const row of rows) {
    decode(row);
    if (records.has(row.key)) throw new Error(`Duplicate persisted record at ${row.key}.`);
    records.set(row.key, row);
  }
  const state: State = { version, records, changes: new Map(), active: true };
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
      const row = state.changes.has(key) ? state.changes.get(key) : state.records.get(key);
      return row === null || row === undefined ? undefined : decode(row);
    },
    remove(key) {
      check();
      state.changes.set(key, null);
    },
    keys() {
      check();
      const keys = new Set(state.records.keys());
      for (const [key, row] of state.changes) {
        if (row === null) keys.delete(key);
        else keys.add(key);
      }
      return [...keys].sort();
    },
  };
  return {
    session,
    version: state.version,
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
