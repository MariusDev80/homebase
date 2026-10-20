import { DataError } from '../data-error';
import { JsonValue } from '../json';
import { FixedClock, sequentialIds } from '../testing/fixed-clock';
import { createTestDatabase } from '../testing/migrations';
import { NodeSqliteExecutor } from '../testing/node-sqlite-executor';
import { SqliteSettingsRepository } from './sqlite-settings.repository';

describe('SqliteSettingsRepository', () => {
  let db: NodeSqliteExecutor;
  let clock: FixedClock;
  let repo: SqliteSettingsRepository;

  beforeEach(() => {
    db = createTestDatabase();
    clock = new FixedClock('2026-01-01T00:00:00.000Z');
    repo = new SqliteSettingsRepository(db, clock, sequentialIds());
  });
  afterEach(() => db.close());

  async function kindOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof DataError) return e.kind;
      throw e;
    }
    return 'no error';
  }

  it('round-trips JSON values', async () => {
    const values: JsonValue[] = [{ a: [1, { b: 'c' }] }, [1, 2, 3], 42, 'text', true, false, null];
    for (const [i, value] of values.entries()) {
      await repo.set(`k.${i}`, value);
      expect(await repo.get(`k.${i}`)).toEqual(value);
    }
    expect((await repo.getAll()).size).toBe(values.length);
  });

  it('returns undefined for an absent key', async () => {
    expect(await repo.get('missing')).toBeUndefined();
  });

  it('updates value and updated_at on a second set, keeping created_at', async () => {
    await repo.set('ui.theme', 'dark');
    clock.set('2026-02-02T00:00:00.000Z');
    await repo.set('ui.theme', 'light');
    expect(await repo.get('ui.theme')).toBe('light');
    const rows = await db.select<{ created_at: string; updated_at: string }>(
      "SELECT created_at, updated_at FROM settings WHERE key = 'ui.theme'",
    );
    expect(rows).toEqual([
      { created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-02-02T00:00:00.000Z' },
    ]);
  });

  it('remove returns true then false', async () => {
    await repo.set('a', 1);
    expect(await repo.remove('a')).toBe(true);
    expect(await repo.remove('a')).toBe(false);
  });

  it('refuses secret-like keys', async () => {
    for (const key of ['github.token', 'bank.apiKey', 'x.password', 'My.SECRET']) {
      expect(await kindOf(repo.set(key, 'v'))).toBe('forbidden');
    }
  });

  it('refuses malformed keys', async () => {
    for (const key of ['Bad Key', '']) {
      expect(await kindOf(repo.set(key, 'v'))).toBe('invalid_input');
    }
  });

  it('refuses values larger than 65536 characters with constraint', async () => {
    expect(await kindOf(repo.set('big', 'x'.repeat(65536)))).toBe('constraint');
  });
});
