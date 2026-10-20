import { DataError } from '../data-error';
import { ExecuteResult, SqlExecutor, SqlParam, SqlRow } from '../sql-executor';
import { toDataError } from './error-mapping';

/** Remembers why the database could not be initialised (ADR-002 §3.5, amended after phase 0 review). */
export class DataLayerHealth {
  private failureState: DataError | undefined;

  get failure(): DataError | undefined {
    return this.failureState;
  }

  /**
   * Runs the bootstrap and never rejects: a failure is memorised and surfaced by the
   * repositories, so the application still starts and can display an error.
   */
  async initialize(bootstrap: () => Promise<void> | void): Promise<void> {
    try {
      await bootstrap();
    } catch (error: unknown) {
      this.failureState = toDataError(error);
      console.error('Database initialisation failed', error);
    }
  }
}

/**
 * Executor handed to the repositories: rejects with the memorised failure when the
 * bootstrap failed, otherwise delegates to the (lazily created) real executor.
 */
export class GuardedSqlExecutor implements SqlExecutor {
  constructor(
    private readonly health: DataLayerHealth,
    private readonly createExecutor: () => SqlExecutor,
  ) {}

  execute(sql: string, params: readonly SqlParam[] = []): Promise<ExecuteResult> {
    return this.delegate((executor) => executor.execute(sql, params));
  }

  select<T extends SqlRow>(sql: string, params: readonly SqlParam[] = []): Promise<T[]> {
    return this.delegate((executor) => executor.select<T>(sql, params));
  }

  private async delegate<R>(call: (executor: SqlExecutor) => Promise<R>): Promise<R> {
    if (this.health.failure) throw this.health.failure;
    try {
      return await call(this.createExecutor());
    } catch (error: unknown) {
      throw toDataError(error);
    }
  }
}
