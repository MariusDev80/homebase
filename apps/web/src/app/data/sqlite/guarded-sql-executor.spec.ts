import { DataError } from '../data-error';
import { SqlExecutor } from '../sql-executor';
import { createTestDatabase } from '../testing/migrations';
import { NodeSqliteExecutor } from '../testing/node-sqlite-executor';
import { DataLayerHealth, GuardedSqlExecutor } from './guarded-sql-executor';
import { initDatabase } from './database-bootstrap';

describe('DataLayerHealth / GuardedSqlExecutor', () => {
  let db: NodeSqliteExecutor;
  beforeEach(() => {
    db = createTestDatabase();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('does not reject when the bootstrap fails and memorises the DataError', async () => {
    const health = new DataLayerHealth();
    await expect(
      health.initialize(() => {
        throw new DataError('unavailable', 'no tauri');
      }),
    ).resolves.toBeUndefined();
    expect(health.failure?.kind).toBe('unavailable');
  });

  it('wraps a non-DataError bootstrap failure', async () => {
    const health = new DataLayerHealth();
    await health.initialize(() => Promise.reject(new Error('boom')));
    expect(health.failure).toBeInstanceOf(DataError);
  });

  it('rejects every call with the memorised error and never creates the executor', async () => {
    const health = new DataLayerHealth();
    await health.initialize(() => {
      throw new DataError('unavailable', 'no tauri');
    });
    const create = vi.fn(() => db);
    const guarded = new GuardedSqlExecutor(health, create);
    await expect(guarded.select('SELECT 1')).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(guarded.execute('DELETE FROM settings')).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('delegates when healthy', async () => {
    const health = new DataLayerHealth();
    await health.initialize(() => undefined);
    const guarded = new GuardedSqlExecutor(health, () => db);
    await expect(guarded.select('SELECT 1 AS one')).resolves.toEqual([{ one: 1 }]);
  });

  it('maps an executor creation failure to a DataError', async () => {
    const guarded = new GuardedSqlExecutor(new DataLayerHealth(), () => {
      throw new Error('Database.get failed');
    });
    await expect(guarded.select('SELECT 1')).rejects.toBeInstanceOf(DataError);
  });
});

describe('initDatabase', () => {
  function fake(mode: string): SqlExecutor {
    return {
      execute: () => Promise.resolve({ rowsAffected: 0 }),
      select: <T>() => Promise.resolve([{ journal_mode: mode }] as unknown as T[]),
    } as SqlExecutor;
  }

  it('succeeds when WAL is active', async () => {
    await expect(initDatabase(fake('wal'))).resolves.toBeUndefined();
  });

  it('fails when WAL is not active', async () => {
    await expect(initDatabase(fake('delete'))).rejects.toBeInstanceOf(DataError);
  });
});

describe('NodeSqliteExecutor parameter binding', () => {
  it('rejects a $N without a matching parameter', async () => {
    const db = createTestDatabase();
    try {
      await expect(db.select('SELECT $1 AS a, $2 AS b', ['x'])).rejects.toMatchObject({
        kind: 'invalid_input',
      });
    } finally {
      db.close();
    }
  });
});
