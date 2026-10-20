import { Clock, IdGenerator } from '../clock';
import { DataError } from '../data-error';
import { JsonValue, parseJsonValue } from '../json';
import { SettingsRepository } from '../repositories';
import { SqlExecutor } from '../sql-executor';

const SECRET_KEY = /(secret|token|passw(or)?d|api[-_.]?key|credential)/i;
const KEY_FORMAT = /^[a-z][a-z0-9._-]{0,127}$/;

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly clock: Clock,
    // Settings use a natural key; the generator only keeps the constructor signature uniform.
    protected readonly newId?: IdGenerator,
  ) {}

  async get(key: string): Promise<JsonValue | undefined> {
    const rows = await this.executor.select<{ value: string }>(
      'SELECT value FROM settings WHERE key = $1',
      [key],
    );
    return rows.length === 0 ? undefined : parseJsonValue(rows[0].value);
  }

  async getAll(): Promise<ReadonlyMap<string, JsonValue>> {
    const rows = await this.executor.select<{ key: string; value: string }>(
      'SELECT key, value FROM settings ORDER BY key',
    );
    return new Map(rows.map((r) => [r.key, parseJsonValue(r.value)]));
  }

  async set(key: string, value: JsonValue): Promise<void> {
    if (SECRET_KEY.test(key)) {
      throw new DataError('forbidden', 'Secrets must not be stored in settings');
    }
    if (!KEY_FORMAT.test(key)) {
      throw new DataError('invalid_input', 'Invalid settings key');
    }
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new DataError('invalid_input', 'Value is not serializable to JSON');
    }
    await this.executor.execute(
      `INSERT INTO settings (key, value, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, json, this.clock.nowIso()],
    );
  }

  async remove(key: string): Promise<boolean> {
    const result = await this.executor.execute('DELETE FROM settings WHERE key = $1', [key]);
    return result.rowsAffected > 0;
  }
}
