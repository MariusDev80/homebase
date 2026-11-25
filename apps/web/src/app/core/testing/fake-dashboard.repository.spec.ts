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

  it('refuses an empty batch with invalid_input', async () => {
    const dashboards = FakeDashboardRepository.linked(new FakeWidgetInstanceRepository());
    const error = await dashboards.createWithWidgets({ name: 'x' }, 's', []).catch((e) => e);
    expect(error).toBeInstanceOf(DataError);
    expect(error).toMatchObject({ kind: 'invalid_input' });
  });

  it('refuses duplicate ids with invalid_input, creating nothing', async () => {
    const instances = new FakeWidgetInstanceRepository();
    const dashboards = FakeDashboardRepository.linked(instances);
    const source = await dashboards.create({ name: 'Source' });
    const a = instances.seed({ dashboardId: source.id });
    await expect(
      dashboards.createWithWidgets({ name: 'Suite' }, source.id, [
        { id: a.id, grid: GRID },
        { id: a.id, grid: GRID },
      ]),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    expect(dashboards.items).toHaveLength(1);
  });

  it('is forbidden at 100 dashboards, moving nothing', async () => {
    const instances = new FakeWidgetInstanceRepository();
    const dashboards = FakeDashboardRepository.linked(instances);
    const source = await dashboards.create({ name: 'Source' });
    const a = instances.seed({ dashboardId: source.id });
    for (let i = 1; i < 100; i++) await dashboards.create({ name: `T${i}` });
    await expect(
      dashboards.createWithWidgets({ name: 'Suite' }, source.id, [{ id: a.id, grid: GRID }]),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(dashboards.items).toHaveLength(100);
    expect(instances.items.find((i) => i.id === a.id)?.dashboardId).toBe(source.id);
  });

  it('refuses to run without a linked instance fake', async () => {
    const dashboards = new FakeDashboardRepository();
    await expect(
      dashboards.createWithWidgets({ name: 'x' }, 's', [{ id: 'i', grid: GRID }]),
    ).rejects.toThrow(/linked/);
  });
});
