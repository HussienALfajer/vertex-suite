import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordJournal, type MemorySession } from '@vertex/platform';
import type { PersistentStore } from './index.js';
import { conflict, snapshot, type Snapshot, type StoredRow } from './records.js';

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
  return {
    journal: recordJournal(),
    driver: {
      // Node's SQLite API is synchronous. Yielding keeps failures on the
      // SessionDriver promise path, including conflicts handled by untilCommitted.
      async begin() {
        await Promise.resolve();
        check();
        db.exec('BEGIN');
        try {
          const revision = db.prepare('SELECT version FROM vertex_revision WHERE id = 1').get() as
            { version: number } | undefined;
          if (!revision) throw new Error('The store revision is missing.');
          const rows = db
            .prepare('SELECT key, value, digest FROM vertex_records ORDER BY key')
            .all() as unknown as StoredRow[];
          const one = snapshot(revision.version, rows);
          db.exec('COMMIT');
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
            db.prepare('UPDATE vertex_revision SET version = version + 1 WHERE id = 1').run();
            db.exec('COMMIT');
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
