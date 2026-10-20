import { DataError } from '../data-error';
import { GridRect } from '../models';
import { FixedClock, sequentialIds } from '../testing/fixed-clock';
import { createTestDatabase } from '../testing/migrations';
import { NodeSqliteExecutor } from '../testing/node-sqlite-executor';
import { SqliteDashboardRepository } from './sqlite-dashboard.repository';
import {
  SqliteWidgetInstanceRepository,
  UPDATE_LAYOUT_SQL,
} from './sqlite-widget-instance.repository';

describe('SqliteWidgetInstanceRepository', () => {
  let db: NodeSqliteExecutor;
  let clock: FixedClock;
  let repo: SqliteWidgetInstanceRepository;
  let dashboardId: string;

  beforeEach(async () => {
    db = createTestDatabase();
    clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const ids = sequentialIds();
    repo = new SqliteWidgetInstanceRepository(db, clock, ids);
    const dashboards = new SqliteDashboardRepository(db, clock, ids);
    dashboardId = (await dashboards.create({ name: 'Main' })).id;
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

  const rect = (x: number, y: number, w = 2, h = 2): GridRect => ({ x, y, w, h });

  async function add(grid: GridRect, widgetType = 'todo') {
    return repo.create({ dashboardId, widgetType, grid, config: {}, configVersion: 1 });
  }

  it('creates and reads back a record with a nested config', async () => {
    const created = await repo.create({
      dashboardId,
      widgetType: 'todo',
      grid: rect(1, 2, 3, 4),
      config: { filters: { done: false, tags: ['a', 'b'] }, limit: 10 },
      configVersion: 2,
    });
    expect(created).toEqual({
      id: created.id,
      dashboardId,
      widgetType: 'todo',
      grid: { x: 1, y: 2, w: 3, h: 4 },
      config: { filters: { done: false, tags: ['a', 'b'] }, limit: 10 },
      configVersion: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await repo.get(created.id)).toEqual(created);
    expect(await repo.get('00000000-0000-4000-8000-0000000000ff')).toBeNull();
  });

  it('refuses an instance on a missing dashboard with constraint', async () => {
    const p = repo.create({
      dashboardId: '00000000-0000-4000-8000-0000000000ff',
      widgetType: 'todo',
      grid: rect(0, 0),
      config: {},
      configVersion: 1,
    });
    expect(await kindOf(p)).toBe('constraint');
  });

  it('reports corrupt_data when the stored config is not an object', async () => {
    const w = await add(rect(0, 0));
    // The schema CHECK forbids non-object JSON, so bypass it to simulate a corrupted row.
    db.exec('PRAGMA ignore_check_constraints = ON');
    await db.execute("UPDATE widget_instances SET config = '[1]' WHERE id = $1", [w.id]);
    db.exec('PRAGMA ignore_check_constraints = OFF');
    expect(await kindOf(repo.get(w.id))).toBe('corrupt_data');
  });

  it('updates config, version and updated_at, or throws not_found', async () => {
    const w = await add(rect(0, 0));
    clock.set('2026-04-04T00:00:00.000Z');
    const updated = await repo.updateConfig(w.id, { a: 1 }, 3);
    expect(updated.config).toEqual({ a: 1 });
    expect(updated.configVersion).toBe(3);
    expect(updated.updatedAt).toBe('2026-04-04T00:00:00.000Z');
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await kindOf(repo.updateConfig('00000000-0000-4000-8000-0000000000ff', {}, 1))).toBe(
      'not_found',
    );
  });

  it('updates the layout of a batch of 3', async () => {
    const [a, b, c] = [await add(rect(0, 0)), await add(rect(1, 0)), await add(rect(2, 0))];
    const n = await repo.updateLayout(dashboardId, [
      { id: a.id, grid: rect(5, 5, 1, 1) },
      { id: b.id, grid: rect(6, 6, 2, 2) },
      { id: c.id, grid: rect(7, 7, 3, 3) },
    ]);
    expect(n).toBe(3);
    expect((await repo.get(a.id))?.grid).toEqual(rect(5, 5, 1, 1));
    expect((await repo.get(b.id))?.grid).toEqual(rect(6, 6, 2, 2));
    expect((await repo.get(c.id))?.grid).toEqual(rect(7, 7, 3, 3));
  });

  it('ignores unknown ids in a layout batch', async () => {
    const a = await add(rect(0, 0));
    const n = await repo.updateLayout(dashboardId, [
      { id: a.id, grid: rect(3, 3) },
      { id: '00000000-0000-4000-8000-0000000000ff', grid: rect(4, 4) },
    ]);
    expect(n).toBe(1);
    expect((await repo.get(a.id))?.grid).toEqual(rect(3, 3));
  });

  it('does not touch an instance of another dashboard', async () => {
    const dashboards = new SqliteDashboardRepository(db, clock, sequentialIds());
    const other = await dashboards.create({
      id: '00000000-0000-4000-8000-0000000000aa',
      name: 'Other',
    });
    const w = await add(rect(0, 0));
    expect(await repo.updateLayout(other.id, [{ id: w.id, grid: rect(9, 9) }])).toBe(0);
    expect((await repo.get(w.id))?.grid).toEqual(rect(0, 0));
  });

  it('returns 0 for an empty batch without querying', async () => {
    const spy = vi.spyOn(db, 'execute');
    expect(await repo.updateLayout(dashboardId, [])).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects invalid batches with invalid_input before any query', async () => {
    const a = await add(rect(0, 0));
    const spy = vi.spyOn(db, 'execute');
    const id = a.id;
    expect(
      await kindOf(
        repo.updateLayout(dashboardId, [
          { id, grid: rect(1, 1) },
          { id, grid: rect(2, 2) },
        ]),
      ),
    ).toBe('invalid_input');
    expect(await kindOf(repo.updateLayout(dashboardId, [{ id, grid: rect(1, 1, 0, 1) }]))).toBe(
      'invalid_input',
    );
    expect(await kindOf(repo.updateLayout(dashboardId, [{ id, grid: rect(1.5, 1) }]))).toBe(
      'invalid_input',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('is atomic: one invalid row in the statement leaves all rows untouched', async () => {
    const rows = [await add(rect(0, 0)), await add(rect(1, 0)), await add(rect(2, 0))];
    const payload = JSON.stringify([
      { id: rows[0].id, x: 5, y: 5, w: 1, h: 1 },
      { id: rows[1].id, x: 6, y: 6, w: 0, h: 1 },
      { id: rows[2].id, x: 7, y: 7, w: 1, h: 1 },
    ]);
    let kind = 'no error';
    try {
      await db.execute(UPDATE_LAYOUT_SQL, [dashboardId, payload, clock.nowIso()]);
    } catch (e) {
      kind = e instanceof DataError ? e.kind : 'other';
    }
    expect(kind).toBe('constraint');
    for (const [i, r] of rows.entries()) {
      expect((await repo.get(r.id))?.grid).toEqual(rect(i, 0));
    }
  });

  it('lists ordered by grid_y, grid_x, created_at, id', async () => {
    const b = await add(rect(1, 0));
    const c = await add(rect(0, 1));
    const a = await add(rect(0, 0));
    expect((await repo.listByDashboard(dashboardId)).map((w) => w.id)).toEqual([a.id, b.id, c.id]);
  });

  it('removes idempotently', async () => {
    const w = await add(rect(0, 0));
    expect(await repo.remove(w.id)).toBe(true);
    expect(await repo.remove(w.id)).toBe(false);
  });
});
