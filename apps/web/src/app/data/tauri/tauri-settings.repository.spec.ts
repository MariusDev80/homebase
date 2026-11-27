import { invoke, isTauri } from '@tauri-apps/api/core';
import { TauriSettingsRepository } from './tauri-settings.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

describe('TauriSettingsRepository', () => {
  let repo: TauriSettingsRepository;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriSettingsRepository();
  });

  it('get parses valueJson, and is undefined when absent', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('{"a":1}');
    await expect(repo.get('ui.x')).resolves.toEqual({ a: 1 });
    expect(invoke).toHaveBeenCalledWith('setting_get', { key: 'ui.x' });
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(repo.get('ui.y')).resolves.toBeUndefined();
  });

  it('get is corrupt_data on a stored text that is not JSON', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('{oops');
    await expect(repo.get('ui.x')).rejects.toMatchObject({ kind: 'corrupt_data' });
  });

  it('getAll builds a map from setting_list', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { key: 'a', valueJson: '1' },
      { key: 'b', valueJson: '"x"' },
    ]);
    const all = await repo.getAll();
    expect(invoke).toHaveBeenCalledWith('setting_list', {});
    expect([...all]).toEqual([
      ['a', 1],
      ['b', 'x'],
    ]);
  });

  it('set sends the JSON text as is', async () => {
    await repo.set('ui.x', { b: 2, a: [1, 1] });
    expect(invoke).toHaveBeenCalledWith('setting_set', {
      key: 'ui.x',
      valueJson: '{"b":2,"a":[1,1]}',
    });
  });

  it('set is invalid_input for a value without JSON form, before any call', async () => {
    await expect(repo.set('ui.x', undefined as never)).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('remove calls setting_delete', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);
    await expect(repo.remove('ui.x')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('setting_delete', { key: 'ui.x' });
  });

  it('is unavailable outside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.get('a')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
