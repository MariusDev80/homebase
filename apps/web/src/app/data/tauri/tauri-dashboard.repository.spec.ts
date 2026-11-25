import { invoke, isTauri } from '@tauri-apps/api/core';
import { TauriDashboardRepository } from './tauri-dashboard.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

const WIRE = {
  id: 'd1',
  name: 'Accueil',
  sortOrder: 0,
  icon: 'home',
  themeJson: '{"cardBody":"coral"}',
  themeVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const MODEL = {
  id: 'd1',
  name: 'Accueil',
  sortOrder: 0,
  icon: 'home',
  theme: { cardBody: 'coral' },
  themeVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const GRID = { x: 1, y: 2, w: 3, h: 4 };

describe('TauriDashboardRepository', () => {
  let repo: TauriDashboardRepository;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(WIRE);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriDashboardRepository(() => 'new-id');
  });

  it('list converts every DTO', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([WIRE]);
    await expect(repo.list()).resolves.toEqual([MODEL]);
    expect(invoke).toHaveBeenCalledWith('dashboard_list', {});
  });

  it('get is null when absent', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(repo.get('x')).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('dashboard_get', { id: 'x' });
    await expect(repo.get('d1')).resolves.toEqual(MODEL);
  });

  it('list is corrupt_data when the stored theme is not an object', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([{ ...WIRE, themeJson: '[1]' }]);
    await expect(repo.list()).rejects.toMatchObject({ kind: 'corrupt_data' });
  });

  it('create sends exact fields with a generated id and default theme', async () => {
    await expect(repo.create({ name: 'N' })).resolves.toEqual(MODEL);
    expect(invoke).toHaveBeenCalledWith('dashboard_create', {
      input: { id: 'new-id', name: 'N', themeJson: '{}', themeVersion: 1 },
    });
  });

  it('create keeps the given id, icon, theme and version', async () => {
    await repo.create({
      id: 'mine',
      name: 'N',
      icon: 'star',
      theme: { a: 1 },
      themeVersion: 3,
    });
    expect(invoke).toHaveBeenCalledWith('dashboard_create', {
      input: { id: 'mine', name: 'N', icon: 'star', themeJson: '{"a":1}', themeVersion: 3 },
    });
  });

  it('create is invalid_input for an invalid theme version, before any call', async () => {
    await expect(repo.create({ name: 'N', themeVersion: 0 })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('createIfNone calls dashboard_ensure_default', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);
    await expect(repo.createIfNone({ name: 'Accueil' })).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('dashboard_ensure_default', {
      input: { id: 'new-id', name: 'Accueil', themeJson: '{}', themeVersion: 1 },
    });
  });

  it('update sends id, name and icon', async () => {
    await repo.update('d1', { name: 'B', icon: 'home' });
    expect(invoke).toHaveBeenCalledWith('dashboard_update', { id: 'd1', name: 'B', icon: 'home' });
  });

  it('updateTheme sends the serialized theme and the version', async () => {
    await repo.updateTheme('d1', { cardBody: 'coral' }, 2);
    expect(invoke).toHaveBeenCalledWith('dashboard_update_theme', {
      id: 'd1',
      themeJson: '{"cardBody":"coral"}',
      themeVersion: 2,
    });
  });

  it('createWithWidgets sends the exact nested input and converts the result', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ dashboard: WIRE, moved: 2 });
    const items = [{ id: 'w1', grid: { ...GRID, extra: 1 } as typeof GRID }];
    await expect(
      repo.createWithWidgets({ name: 'Suite', icon: 'home' }, 'src', items),
    ).resolves.toEqual({ dashboard: MODEL, moved: 2 });
    expect(invoke).toHaveBeenCalledWith('dashboard_create_with_widgets', {
      input: {
        dashboard: { id: 'new-id', name: 'Suite', icon: 'home', themeJson: '{}', themeVersion: 1 },
        sourceDashboardId: 'src',
        items: [{ id: 'w1', grid: GRID }],
      },
    });
  });

  it('is unavailable outside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.list()).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
