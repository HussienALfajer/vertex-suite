import pg from 'pg';
import { recordJournal, type MemorySession } from '@vertex/platform';
import type { PersistentStore } from './index.js';
import {
  advance,
  committed,
  conflict,
  newEpoch,
  revisions,
  snapshot,
  type Committed,
  type Snapshot,
  type StoredRow,
} from './records.js';

const { Pool } = pg;

/** Rows per statement when a commit writes; well inside PostgreSQL's parameter and message limits. */
const BATCH = 1000;

export interface PostgresStoreOptions {
  readonly connectionString: string;
  /** A dedicated schema for one store installation. Defaults to public. */
  readonly schema?: string;
}

/** Opens a PostgreSQL store. The host owns the database and connection string. */
export async function openPostgresStore(options: PostgresStoreOptions): Promise<PersistentStore> {
  if (!options.connectionString) throw new TypeError('A PostgreSQL connection string is required.');
  const schema = options.schema ?? 'public';
  if (!/^[a-z_][a-z0-9_]*$/u.test(schema)) throw new TypeError('Invalid PostgreSQL schema name.');
  const revisionTable = `"${schema}".vertex_revision`;
  const recordsTable = `"${schema}".vertex_records`;
  const pool = new Pool({
    connectionString: options.connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${revisionTable} (id integer PRIMARY KEY CHECK (id = 1), version bigint NOT NULL CHECK (version >= 0))`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${recordsTable} (key text PRIMARY KEY, value text NOT NULL, digest text NOT NULL)`,
      );
      // Added to stores created before it existed; see `Committed.epoch`.
      await client.query(
        `ALTER TABLE ${revisionTable} ADD COLUMN IF NOT EXISTS epoch text NOT NULL DEFAULT ''`,
      );
      await client.query(
        `INSERT INTO ${revisionTable} (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
      );
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  } catch (cause) {
    await pool.end();
    throw cause;
  }
  let closed = false;
  const active = new Map<MemorySession, Snapshot>();
  const check = (): void => {
    if (closed) throw new Error('The PostgreSQL store is closed.');
  };
  const known = (session: MemorySession): Snapshot => {
    check();
    const one = active.get(session);
    if (!one) throw new Error('This session does not belong to this store, or has already ended.');
    return one;
  };
  const end = (session: MemorySession): void => {
    active.get(session)?.end();
    active.delete(session);
  };
  const held = revisions();
  /**
   * Every row, with the revision they are at, in one snapshot of the database,
   * and verified before anything is served from them (`Committed`).
   */
  const load = async (): Promise<Committed> => {
    const client = await pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const revision = await client.query<{ version: string; epoch: string }>(
        `SELECT version, epoch FROM ${revisionTable} WHERE id = 1`,
      );
      const first = revision.rows[0];
      if (revision.rows.length !== 1 || !first) throw new Error('The store revision is missing.');
      const rows = await client.query<StoredRow>(`SELECT key, value, digest FROM ${recordsTable}`);
      const loaded = committed(Number(first.version), first.epoch, rows.rows);
      await client.query('COMMIT');
      held.loaded(loaded);
      return loaded;
    } catch (cause) {
      try {
        await client.query('ROLLBACK');
      } catch {
        releaseError = new Error('The PostgreSQL connection could not roll back.');
      }
      throw cause;
    } finally {
      client.release(releaseError);
    }
  };
  return {
    journal: recordJournal(),
    driver: {
      async begin() {
        check();
        // One statement, so one consistent reading of the counter. When it
        // names the revision already held, nothing else needs to be read.
        const current = await pool.query<{ version: string; epoch: string }>(
          `SELECT version, epoch FROM ${revisionTable} WHERE id = 1`,
        );
        const now = current.rows.length === 1 ? current.rows[0] : undefined;
        const cached = now === undefined ? null : held.at(Number(now.version), now.epoch);
        const one = snapshot(cached ?? (await load()));
        check();
        active.set(one.session, one);
        return one.session;
      },
      async commit(session) {
        const one = known(session);
        try {
          const changes = one.changes();
          if (changes.length === 0) return;
          const epoch = newEpoch();
          const client = await pool.connect();
          let releaseError: Error | undefined;
          try {
            await client.query('BEGIN');
            await client.query('SET LOCAL synchronous_commit = on');
            const updated = await client.query(
              `UPDATE ${revisionTable} SET version = version + 1, epoch = $2 WHERE id = 1 AND version = $1 RETURNING version`,
              [one.version, epoch],
            );
            if (updated.rowCount !== 1) throw conflict();
            // In batches rather than a statement per row: a command that
            // writes thousands of records — an import, a rebuilt index — is
            // otherwise thousands of round trips holding the revision lock.
            const removed = changes.filter((change) => change.row === null).map(({ key }) => key);
            const written = changes.flatMap(({ row }) => (row === null ? [] : [row]));
            for (let at = 0; at < removed.length; at += BATCH)
              await client.query(`DELETE FROM ${recordsTable} WHERE key = ANY($1::text[])`, [
                removed.slice(at, at + BATCH),
              ]);
            for (let at = 0; at < written.length; at += BATCH) {
              const batch = written.slice(at, at + BATCH);
              await client.query(
                `INSERT INTO ${recordsTable} (key, value, digest) SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT (key) DO UPDATE SET value = excluded.value, digest = excluded.digest`,
                [
                  batch.map((row) => row.key),
                  batch.map((row) => row.value),
                  batch.map((row) => row.digest),
                ],
              );
            }
            await client.query('COMMIT');
            held.advanced(advance(one.base, changes, epoch));
          } catch (cause) {
            try {
              await client.query('ROLLBACK');
            } catch {
              releaseError = new Error('The PostgreSQL connection could not roll back.');
            }
            if (
              typeof cause === 'object' &&
              cause !== null &&
              'code' in cause &&
              (cause.code === '40001' || cause.code === '40P01')
            )
              throw conflict();
            throw cause;
          } finally {
            client.release(releaseError);
          }
        } finally {
          end(session);
        }
      },
      rollback(session) {
        known(session);
        end(session);
        return Promise.resolve();
      },
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const one of active.values()) one.end();
      active.clear();
      await pool.end();
    },
  };
}
