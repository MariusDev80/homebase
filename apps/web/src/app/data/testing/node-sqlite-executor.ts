import Database from 'better-sqlite3';
import { DataError } from '../data-error';
import { ExecuteResult, SqlExecutor, SqlParam, SqlRow, assertSqlParams } from '../sql-executor';
import { toDataError } from '../sqlite/error-mapping';

/** Test adapter: real SQLite engine (better-sqlite3), in memory. */
export class NodeSqliteExecutor implements SqlExecutor {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(':memory:');
    this.db.pragma('foreign_keys = ON'); // mimics sqlx (ADR-002 F10)
  }

  execute(sql: string, params: readonly SqlParam[] = []): Promise<ExecuteResult> {
    try {
      assertSqlParams(params);
      const { sql: rewritten, bound } = this.bind(sql, params);
      const info = this.db.prepare(rewritten).run(bound);
      return Promise.resolve({ rowsAffected: info.changes });
    } catch (e) {
      return Promise.reject(toDataError(e));
    }
  }

  select<T extends SqlRow>(sql: string, params: readonly SqlParam[] = []): Promise<T[]> {
    try {
      assertSqlParams(params);
      const { sql: rewritten, bound } = this.bind(sql, params);
      return Promise.resolve(this.db.prepare(rewritten).all(bound) as T[]);
    } catch (e) {
      return Promise.reject(toDataError(e));
    }
  }

  /** Raw multi-statement execution, used to apply migrations. */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  /** `$N` becomes `@pN`; only parameters actually referenced are bound (sqlx-like, F12). */
  private bind(sql: string, params: readonly SqlParam[]): { sql: string; bound: SqlBound } {
    const used = new Set<number>();
    const rewritten = sql.replace(/\$(\d+)/g, (_m, n: string) => {
      used.add(Number(n));
      return `@p${n}`;
    });
    const bound: SqlBound = {};
    for (const n of used) {
      if (n < 1 || n > params.length) {
        throw new DataError('invalid_input', `Missing parameter $${n}`);
      }
      bound[`p${n}`] = params[n - 1];
    }
    return { sql: rewritten, bound };
  }
}

type SqlBound = Record<string, SqlParam>;
