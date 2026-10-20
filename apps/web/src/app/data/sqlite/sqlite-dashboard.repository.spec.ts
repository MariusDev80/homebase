import { DataError } from '../data-error';
import { FixedClock, sequentialIds } from '../testing/fixed-clock';
import { createTestDatabase } from '../testing/migrations';
import { NodeSqliteExecutor } from '../testing/node-sqlite-executor';
import { SqliteDashboardRepository } from './sqlite-dashboard.repository';
import { SqliteWidgetInstanceRepository } from './sqlite-widget-instance.repository';

describe('SqliteDashboardRepository', () => {
  let db: NodeSqliteExecutor;
  let clock: FixedClock;
  let repo: SqliteDashboardRepository;

  beforeEach(() => {
    db = createTestDatabase();
    clock = new FixedClock('2026-01-01T00:00:00.000Z');
    repo = new SqliteDashboardRepository(db, clock, sequentialIds());
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

  it('creates with a deterministic id and a frozen timestamp', async () => {
    const d = await repo.create({ name: 'Home' });
    expect(d).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Home',
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('increments sortOrder and lists in order', async () => {
    const a = await repo.create({ name: 'A' });
    const b = await repo.create({ name: 'B' });
    const c = await repo.create({ name: 'C' });
    expect([a.sortOrder, b.sortOrder, c.sortOrder]).toEqual([0, 1, 2]);
    expect((await repo.list()).map((d) => d.name)).toEqual(['A', 'B', 'C']);
    expect(await repo.get(b.id)).toEqual(b);
    expect(await repo.get('00000000-0000-4000-8000-0000000000ff')).toBeNull();
  });

  it('createIfNone creates once only', async () => {
    expect(await repo.createIfNone({ name: 'First' })).toBe(true);
    expect(await repo.createIfNone({ name: 'Second' })).toBe(false);
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('First');
  });

  it('renames with trim, not_found and invalid_input', async () => {
    const d = await repo.create({ name: 'Old' });
    clock.set('2026-03-03T00:00:00.000Z');
    const renamed = await repo.rename(d.id, '  New  ');
    expect(renamed.name).toBe('New');
    expect(renamed.updatedAt).toBe('2026-03-03T00:00:00.000Z');
    expect(renamed.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await kindOf(repo.rename('00000000-0000-4000-8000-0000000000ff', 'x'))).toBe(
      'not_found',
    );
    expect(await kindOf(repo.rename(d.id, '   '))).toBe('invalid_input');
    expect(await kindOf(repo.rename(d.id, 'x'.repeat(101)))).toBe('invalid_input');
  });

  it('remove cascades to widget instances and is idempotent', async () => {
    const ids = sequentialIds();
    const widgets = new SqliteWidgetInstanceRepository(db, clock, ids);
    const d = await repo.create({ name: 'D' });
    await widgets.create({
      dashboardId: d.id,
      widgetType: 'todo',
      grid: { x: 0, y: 0, w: 2, h: 2 },
      config: {},
      configVersion: 1,
    });
    expect(await repo.remove(d.id)).toBe(true);
    expect(await widgets.listByDashboard(d.id)).toEqual([]);
    expect(await db.select('SELECT 1 FROM widget_instances')).toEqual([]);
    expect(await repo.remove(d.id)).toBe(false);
  });
});
