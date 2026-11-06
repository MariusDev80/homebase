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
      icon: 'th-large',
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

  it('creates with and without an icon', async () => {
    expect((await repo.create({ name: 'A' })).icon).toBe('th-large');
    expect((await repo.create({ name: 'B', icon: 'briefcase' })).icon).toBe('briefcase');
    expect(await kindOf(repo.create({ name: 'C', icon: 'pi pi-x' }))).toBe('invalid_input');
    expect(await kindOf(repo.create({ name: 'C', icon: '' }))).toBe('invalid_input');
    expect(await repo.list()).toHaveLength(2);
  });

  it('updates name and icon with trim, not_found and invalid_input', async () => {
    const d = await repo.create({ name: 'Old' });
    clock.set('2026-03-03T00:00:00.000Z');
    const updated = await repo.update(d.id, { name: '  New  ', icon: 'home' });
    expect(updated.name).toBe('New');
    expect(updated.icon).toBe('home');
    expect(updated.updatedAt).toBe('2026-03-03T00:00:00.000Z');
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await repo.get(d.id)).toEqual(updated);
    const missing = '00000000-0000-4000-8000-0000000000ff';
    expect(await kindOf(repo.update(missing, { name: 'x', icon: 'home' }))).toBe('not_found');
    expect(await kindOf(repo.update(d.id, { name: '   ', icon: 'home' }))).toBe('invalid_input');
    expect(await kindOf(repo.update(d.id, { name: 'x'.repeat(101), icon: 'home' }))).toBe(
      'invalid_input',
    );
    for (const icon of ['', 'A', 'pi pi-x', 'a'.repeat(33)]) {
      expect(await kindOf(repo.update(d.id, { name: 'x', icon }))).toBe('invalid_input');
    }
    expect(await repo.get(d.id)).toEqual(updated);
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
