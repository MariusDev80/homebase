import { invoke, isTauri } from '@tauri-apps/api/core';
import { TauriWidgetInstanceRepository } from './tauri-widget-instance.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

const GRID = { x: 1, y: 2, w: 3, h: 4 };
const WIRE = {
  id: 'w1',
  dashboardId: 'd1',
  widgetType: 'todo',
  grid: GRID,
  configJson: '{"k":1}',
  configVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};
const MODEL = {
  id: 'w1',
  dashboardId: 'd1',
  widgetType: 'todo',
  grid: GRID,
  config: { k: 1 },
  configVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};

describe('TauriWidgetInstanceRepository', () => {
  let repo: TauriWidgetInstanceRepository;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(WIRE);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriWidgetInstanceRepository(() => 'new-id');
  });

  it('listByDashboard', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([WIRE]);
    await expect(repo.listByDashboard('d1')).resolves.toEqual([MODEL]);
    expect(invoke).toHaveBeenCalledWith('widget_list', { dashboardId: 'd1' });
  });

  it('get is null when absent', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(repo.get('x')).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('widget_get', { id: 'x' });
  });

  it('is corrupt_data when the stored config is not an object', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...WIRE, configJson: '"x"' });
    await expect(repo.get('w1')).rejects.toMatchObject({ kind: 'corrupt_data' });
  });

  it('create generates the id and sends no extra field', async () => {
    const input = {
      dashboardId: 'd1',
      widgetType: 'todo',
      grid: { ...GRID, extra: 1 } as typeof GRID,
      config: { k: 1 },
      configVersion: 2,
      stray: true,
    };
    await expect(repo.create(input)).resolves.toEqual(MODEL);
    expect(invoke).toHaveBeenCalledWith('widget_create', {
      input: {
        id: 'new-id',
        dashboardId: 'd1',
        widgetType: 'todo',
        grid: GRID,
        configJson: '{"k":1}',
        configVersion: 2,
      },
    });
  });

  it('updateConfig', async () => {
    await repo.updateConfig('w1', { k: 1 }, 2);
    expect(invoke).toHaveBeenCalledWith('widget_update_config', {
      id: 'w1',
      configJson: '{"k":1}',
      configVersion: 2,
    });
  });

  it('updateLayout sends the items with exact grids and returns the count', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(2);
    await expect(
      repo.updateLayout('d1', [
        { id: 'a', grid: GRID },
        { id: 'b', grid: GRID },
      ]),
    ).resolves.toBe(2);
    expect(invoke).toHaveBeenCalledWith('widget_update_layout', {
      dashboardId: 'd1',
      items: [
        { id: 'a', grid: GRID },
        { id: 'b', grid: GRID },
      ],
    });
  });

  it('findFirstOfType', async () => {
    await expect(repo.findFirstOfType('todo')).resolves.toEqual(MODEL);
    expect(invoke).toHaveBeenCalledWith('widget_find_first_of_type', { widgetType: 'todo' });
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(repo.findFirstOfType('none')).resolves.toBeNull();
  });

  it('remove calls widget_delete', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(false);
    await expect(repo.remove('w1')).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledWith('widget_delete', { id: 'w1' });
  });

  it('is unavailable outside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.get('w1')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
