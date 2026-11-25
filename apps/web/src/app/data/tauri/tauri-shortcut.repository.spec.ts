import { invoke, isTauri } from '@tauri-apps/api/core';
import { TauriShortcutRepository } from './tauri-shortcut.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

const SHORTCUT = {
  id: 's1',
  label: 'Docs',
  url: 'https://example.org',
  sortOrder: 2,
  createdAt: '2026-11-25T10:00:00.000Z',
  updatedAt: '2026-11-25T10:00:00.000Z',
};

describe('TauriShortcutRepository', () => {
  let repo: TauriShortcutRepository;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(SHORTCUT);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriShortcutRepository(() => 'gen-1');
  });

  it('list maps the DTOs', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([SHORTCUT]);
    await expect(repo.list()).resolves.toEqual([SHORTCUT]);
    expect(invoke).toHaveBeenCalledWith('shortcut_list', {});
  });

  it('create generates the id when absent and sends no extra field', async () => {
    await expect(repo.create({ label: 'Docs', url: 'https://example.org' })).resolves.toEqual(
      SHORTCUT,
    );
    expect(invoke).toHaveBeenCalledWith('shortcut_create', {
      input: { id: 'gen-1', label: 'Docs', url: 'https://example.org' },
    });
    await repo.create({ id: 'x', label: 'a', url: 'http://b' });
    expect(invoke).toHaveBeenLastCalledWith('shortcut_create', {
      input: { id: 'x', label: 'a', url: 'http://b' },
    });
  });

  it('update, remove, reorder', async () => {
    await repo.update('s1', { label: 'L', url: 'http://u' });
    expect(invoke).toHaveBeenCalledWith('shortcut_update', {
      id: 's1',
      label: 'L',
      url: 'http://u',
    });
    vi.mocked(invoke).mockResolvedValueOnce(false);
    await expect(repo.remove('s1')).resolves.toBe(false);
    expect(invoke).toHaveBeenLastCalledWith('shortcut_delete', { id: 's1' });
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(repo.reorder(['b', 'a'])).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith('shortcut_reorder', { ids: ['b', 'a'] });
  });

  it('search returns the shortcuts as is', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([SHORTCUT]);
    await expect(repo.search('doc', 3)).resolves.toEqual([SHORTCUT]);
    expect(invoke).toHaveBeenCalledWith('shortcut_search', { query: 'doc', limit: 3 });
  });

  it('maps a Rust error', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ kind: 'invalid_input', field: 'url' });
    await expect(repo.create({ label: 'a', url: 'ftp://x' })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
  });

  it('is unavailable outside Tauri, without a call', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.list()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
