import type { MemorySession, MigrationJournal, SessionDriver } from '@vertex/platform';

export { openPostgresStore, type PostgresStoreOptions } from './postgres.js';
export { openSqliteStore } from './sqlite.js';

/** The module record port stays synchronous; database reads and commits are asynchronous driver operations. */
export interface PersistentStore {
  readonly driver: SessionDriver<MemorySession>;
  readonly journal: MigrationJournal<MemorySession>;
  close(): Promise<void>;
}
