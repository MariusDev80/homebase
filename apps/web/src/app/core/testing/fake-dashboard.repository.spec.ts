import { DataError } from '../../data';
import { FakeDashboardRepository } from './fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from './fake-widget-instance.repository';

const GRID = { x: 0, y: 0, w: 2, h: 2 };

describe('FakeDashboardRepository.createWithWidgets', () => {
  it('creates the dashboard and moves the listed instances of the source', async () => {
    const instances = new FakeWidgetInstanceRepository();
    const dashboards = FakeDashboardRepository.linked(instances);
    const source = await dashboards.create({ name: 'Source' });
    const a = instances.seed({ dashboardId: source.id });
    const b = instances.seed({ dashboardId: source.id });
    const result = await dashboards.createWithWidgets({ name: 'Suite' }, source.id, [
      { id: a.id, grid: { ...GRID, x: 4 } },
    ]);
    expect(result.moved).toBe(1);
    expect(dashboards.items).toHaveLength(2);
    expect(instances.items.find((i) => i.id === a.id)).toMatchObject({
      dashboardId: result.dashboard.id,
      grid: { ...GRID, x: 4 },
    });
    expect(instances.items.find((i) => i.id === b.id)?.dashboardId).toBe(source.id);
  });

  it('is a conflict, creating nothing, when no listed instance belongs to the source', async () => {
    const instances = new FakeWidgetInstanceRepository();
    const dashboards = FakeDashboardRepository.linked(instances);
    const other = instances.seed({ dashboardId: 'elsewhere' });
    await expect(
      dashboards.createWithWidgets({ name: 'Suite' }, 'source', [{ id: other.id, grid: GRID }]),
    ).rejects.toMatchObject({ kind: 'conflict' });
    expect(dashboards.items).toHaveLength(0);
  });

  it('refuses an empty batch', async () => {
    const dashboards = new FakeDashboardRepository();
    await expect(dashboards.createWithWidgets({ name: 'x' }, 's', [])).rejects.toBeInstanceOf(
      DataError,
    );
  });
});
