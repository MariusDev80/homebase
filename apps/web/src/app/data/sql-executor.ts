import { DataError } from './data-error';

/** No boolean, no object: the plugin would bind them as JSON text (ADR-002 F13). */
export type SqlParam = string | number | null;
export type SqlRow = Record<string, string | number | null>;
export interface ExecuteResult {
  rowsAffected: number;
}

export interface SqlExecutor {
  /** One statement per call. Never BEGIN/COMMIT (ADR-002 §2.3). */
  execute(sql: string, params?: readonly SqlParam[]): Promise<ExecuteResult>;
  select<T extends SqlRow>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;
}

/** Runtime guard shared by both adapters: string, finite number or null only. */
export function assertSqlParams(params: readonly unknown[]): void {
  for (const p of params) {
    const ok = p === null || typeof p === 'string' || (typeof p === 'number' && Number.isFinite(p));
    if (!ok) {
      throw new DataError('invalid_input', 'SQL parameters must be string, finite number or null');
    }
  }
}
