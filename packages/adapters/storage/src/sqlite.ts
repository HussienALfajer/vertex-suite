import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordJournal, type MemorySession } from '@vertex/platform';
import type { PersistentStore } from './index.js';
import {
  advance,
  committed,
  conflict,
  newEpoch,
  revisions,
  snapshot,
  type Snapshot,
  type StoredRow,
} from './records.js';

/** Opens a terminal database at an explicit absolute filesystem path. */
export async function openSqliteStore(path: string): Promise<PersistentStore> {
  if (!path || !isAbsolute(path)) {
    throw new TypeError('The terminal database needs an absolute filesystem path.');
  }
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(
        'CREATE TABLE IF NOT EXISTS vertex_revision (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL CHECK (version >= 0));',
      );
      db.exec(
        'CREATE TABLE IF NOT EXISTS vertex_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, digest TEXT NOT NULL);',
      );
      // Added to stores created before it existed; see `Committed.epoch`.
      const columns = db.prepare('PRAGMA table_info(vertex_revision)').all() as { name: string }[];
      if (!columns.some((column) => column.name === 'epoch'))
        db.exec("ALTER TABLE vertex_revision ADD COLUMN epoch TEXT NOT NULL DEFAULT '';");
      db.exec('INSERT OR IGNORE INTO vertex_revision (id, version) VALUES (1, 0);');
      db.exec('COMMIT');
    } catch (cause) {
      db.exec('ROLLBACK');
      throw cause;
    }
  } catch (cause) {
    db.close();
    throw cause;
  }
  let closed = false;
  const active = new Map<MemorySession, Snapshot>();
  const check = (): void => {
    if (closed) throw new Error('The terminal store is closed.');
  };
  const known = (session: MemorySession): Snapshot => {
    check();
    const one = active.get(session);
    if (!one) throw new Error('This session does not belong to this store, or has already ended.');
    return one;
  };
  const end = (session: MemorySession): void => {
    const one = active.get(session);
    one?.end();
    active.delete(session);
  };
  const held = revisions();
  return {
    journal: recordJournal(),
    driver: {
      // Node's SQLite API is synchronous. Yielding keeps failures on the
      // SessionDriver promise path, including conflicts handled by untilCommitted.
      async begin() {
        await Promise.resolve();
        check();
        // One statement, so one consistent reading of the counter; the rows
        // are read only when it names a revision this store does not hold.
        const current = db
          .prepare('SELECT version, epoch FROM vertex_revision WHERE id = 1')
          .get() as { version: number; epoch: string } | undefined;
        const cached = current === undefined ? null : held.at(current.version, current.epoch);
        if (cached !== null) {
          const one = snapshot(cached);
          active.set(one.session, one);
          return one.session;
        }
        db.exec('BEGIN');
        try {
          const revision = db
            .prepare('SELECT version, epoch FROM vertex_revision WHERE id = 1')
            .get() as { version: number; epoch: string } | undefined;
          if (!revision) throw new Error('The store revision is missing.');
          const rows = db
            .prepare('SELECT key, value, digest FROM vertex_records')
            .all() as unknown as StoredRow[];
          const loaded = committed(revision.version, revision.epoch, rows);
          db.exec('COMMIT');
          held.loaded(loaded);
          const one = snapshot(loaded);
          active.set(one.session, one);
          return one.session;
        } catch (cause) {
          db.exec('ROLLBACK');
          if (isBusy(cause)) throw conflict();
          throw cause;
        }
      },
      async commit(session) {
        await Promise.resolve();
        const one = known(session);
        try {
          const changes = one.changes();
          if (changes.length === 0) return;
          let started = false;
          try {
            db.exec('BEGIN IMMEDIATE');
            started = true;
            const revision = db
              .prepare('SELECT version FROM vertex_revision WHERE id = 1')
              .get() as { version: number } | undefined;
            if (revision?.version !== one.version) throw conflict();
            const put = db.prepare(
              'INSERT INTO vertex_records (key, value, digest) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, digest = excluded.digest',
            );
            const remove = db.prepare('DELETE FROM vertex_records WHERE key = ?');
            for (const { key, row } of changes) {
              if (row === null) remove.run(key);
              else put.run(key, row.value, row.digest);
            }
            const epoch = newEpoch();
            db.prepare(
              'UPDATE vertex_revision SET version = version + 1, epoch = ? WHERE id = 1',
            ).run(epoch);
            db.exec('COMMIT');
            held.advanced(advance(one.base, changes, epoch));
          } catch (cause) {
            if (started) db.exec('ROLLBACK');
            if (isBusy(cause)) throw conflict();
            throw cause;
          }
        } finally {
          end(session);
        }
      },
      async rollback(session) {
        await Promise.resolve();
        known(session);
        end(session);
      },
    },
    async close() {
      await Promise.resolve();
      if (closed) return;
      closed = true;
      for (const one of active.values()) one.end();
      active.clear();
      db.close();
    },
  };
}

function isBusy(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause.code === 'SQLITE_BUSY' ||
      cause.code === 'SQLITE_BUSY_SNAPSHOT' ||
      cause.code === 'SQLITE_LOCKED')
  );
}
