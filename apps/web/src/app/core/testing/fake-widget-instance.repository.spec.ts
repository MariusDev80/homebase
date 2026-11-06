import { FakeWidgetInstanceRepository } from './fake-widget-instance.repository';

describe('FakeWidgetInstanceRepository', () => {
  it('moveToDashboard moves the listed instances with their new rectangles', async () => {
    const repo = new FakeWidgetInstanceRepository();
    const a = repo.seed({ dashboardId: 'd1' });
    const b = repo.seed({ dashboardId: 'd1' });
    const n = await repo.moveToDashboard('d2', [{ id: a.id, grid: { x: 1, y: 2, w: 3, h: 4 } }]);
    expect(n).toBe(1);
    expect(repo.items.find((i) => i.id === a.id)).toMatchObject({
      dashboardId: 'd2',
      grid: { x: 1, y: 2, w: 3, h: 4 },
    });
    expect(repo.items.find((i) => i.id === b.id)?.dashboardId).toBe('d1');
  });

  it('findFirstOfType returns null when no instance has the type', async () => {
    const repo = new FakeWidgetInstanceRepository();
    repo.seed({ dashboardId: 'd1', widgetType: 'todo' });
    expect(await repo.findFirstOfType('search')).toBeNull();
  });

  it('findFirstOfType follows dashboardOrder first, then the grid order', async () => {
    const repo = new FakeWidgetInstanceRepository();
    const late = repo.seed({ dashboardId: 'd2', widgetType: 'search' });
    const lower = repo.seed({
      dashboardId: 'd1',
      widgetType: 'search',
      grid: { x: 0, y: 3, w: 2, h: 2 },
    });
    const upper = repo.seed({
      dashboardId: 'd1',
      widgetType: 'search',
      grid: { x: 4, y: 0, w: 2, h: 2 },
    });
    repo.dashboardOrder = ['d1', 'd2'];
    expect((await repo.findFirstOfType('search'))?.id).toBe(upper.id);
    repo.dashboardOrder = ['d2', 'd1'];
    expect((await repo.findFirstOfType('search'))?.id).toBe(late.id);
    expect(lower.id).not.toBe(upper.id);
  });
});
