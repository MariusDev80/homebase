import Database from '@tauri-apps/plugin-sql';
import { ExecuteResult, SqlExecutor, SqlParam, SqlRow, assertSqlParams } from '../sql-executor';
import { DB_URL } from './db-url';
import { toDataError } from './error-mapping';

/**
 * Production adapter over tauri-plugin-sql. The database is loaded (and migrated) at
 * startup by `plugins.sql.preload`; `Database.get` makes no IPC call (ADR-002 F14).
 */
export class TauriSqlExecutor implements SqlExecutor {
  private readonly db = Database.get(DB_URL);

  async execute(sql: string, params: readonly SqlParam[] = []): Promise<ExecuteResult> {
    assertSqlParams(params);
    try {
      const result = await this.db.execute(sql, [...params]);
      return { rowsAffected: result.rowsAffected };
    } catch (e) {
      throw toDataError(e);
    }
  }

  async select<T extends SqlRow>(sql: string, params: readonly SqlParam[] = []): Promise<T[]> {
    assertSqlParams(params);
    try {
      return await this.db.select<T[]>(sql, [...params]);
    } catch (e) {
      throw toDataError(e);
    }
  }
}
