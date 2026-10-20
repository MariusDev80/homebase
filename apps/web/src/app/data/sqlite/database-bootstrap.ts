import { DataError } from '../data-error';
import { SqlExecutor } from '../sql-executor';

/**
 * Enables WAL (persistent, idempotent; cannot be set in a migration, ADR-002 §2.4),
 * then verifies it. `isDevMode` is injected to keep this file free of Angular.
 */
export async function initDatabase(executor: SqlExecutor, isDevMode = false): Promise<void> {
  await executor.execute('PRAGMA journal_mode = WAL');
  const rows = await executor.select<{ journal_mode: string }>('PRAGMA journal_mode');
  const mode = rows[0]?.journal_mode;
  if (mode !== 'wal') {
    throw new DataError('unknown', `Expected journal_mode=wal, got ${String(mode)}`);
  }
  if (isDevMode) {
    const version = await executor.select<{ v: string }>('SELECT sqlite_version() AS v');
    const migration = await executor.select<{ v: number | null }>(
      'SELECT MAX(version) AS v FROM _sqlx_migrations',
    );
    console.info(
      `[data] journal_mode = ${mode}, sqlite_version = ${String(version[0]?.v)}, migration = ${String(migration[0]?.v)}`,
    );
  }
}
