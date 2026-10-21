import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { CLOCK, SETTINGS_REPOSITORY, provideDataLayer } from './data.providers';
import { createTestDatabase } from './testing/migrations';
import type { NodeSqliteExecutor } from './testing/node-sqlite-executor';

const holder = vi.hoisted(() => ({ db: undefined as unknown }));

// The Tauri executor is replaced by the in-memory SQLite test executor.
vi.mock('./sqlite/tauri-sql-executor', () => ({
  TauriSqlExecutor: class {
    constructor() {
      return holder.db as object;
    }
  },
}));
vi.mock('../tauri-runtime', () => ({ isTauriRuntime: () => true }));

describe('provideDataLayer and CLOCK', () => {
  it('drives created_at / updated_at through the provided CLOCK', async () => {
    const db: NodeSqliteExecutor = createTestDatabase();
    holder.db = db;
    const clock = { nowIso: () => '2031-05-06T07:08:09.123Z' };
    const injector = createEnvironmentInjector(
      [{ provide: CLOCK, useValue: clock }, provideDataLayer()],
      // Root-less parent: the environment injector only needs the providers above.
      undefined as unknown as EnvironmentInjector,
    );
    const settings = injector.get(SETTINGS_REPOSITORY);
    await settings.set('time.test', 'x');
    const rows = await db.select<{ created_at: string; updated_at: string }>(
      "SELECT created_at, updated_at FROM settings WHERE key = 'time.test'",
    );
    expect(rows).toEqual([
      { created_at: '2031-05-06T07:08:09.123Z', updated_at: '2031-05-06T07:08:09.123Z' },
    ]);
    db.close();
  });
});
