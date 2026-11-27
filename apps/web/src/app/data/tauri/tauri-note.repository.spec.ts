import { invoke, isTauri } from '@tauri-apps/api/core';
import { TauriNoteRepository } from './tauri-note.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

const NOTE = {
  id: 'n1',
  widgetInstanceId: null,
  title: 'T',
  body: 'B',
  createdAt: '2026-11-25T10:00:00.000Z',
  updatedAt: '2026-11-25T10:00:00.000Z',
};

describe('TauriNoteRepository', () => {
  let repo: TauriNoteRepository;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(NOTE);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriNoteRepository(() => 'gen-1');
  });

  it('get maps the DTO, null when absent', async () => {
    await expect(repo.get('n1')).resolves.toEqual(NOTE);
    expect(invoke).toHaveBeenCalledWith('note_get', { id: 'n1' });
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(repo.get('n2')).resolves.toBeNull();
  });

  it('create defaults id, owner, title and body, and sends no extra field', async () => {
    await repo.create();
    expect(invoke).toHaveBeenCalledWith('note_create', {
      input: { id: 'gen-1', widgetInstanceId: null, title: '', body: '' },
    });
    await repo.create({ id: 'x', widgetInstanceId: 'w1', title: 'a', body: 'b' });
    expect(invoke).toHaveBeenLastCalledWith('note_create', {
      input: { id: 'x', widgetInstanceId: 'w1', title: 'a', body: 'b' },
    });
  });

  it('update and remove', async () => {
    await repo.update('n1', 'a', 'b');
    expect(invoke).toHaveBeenCalledWith('note_update', { id: 'n1', title: 'a', body: 'b' });
    vi.mocked(invoke).mockResolvedValueOnce(true);
    await expect(repo.remove('n1')).resolves.toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('note_delete', { id: 'n1' });
  });

  it('search computes the excerpt from the body around the trimmed query', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { id: 'n1', title: 'T', body: 'hello  big\nworld', widgetInstanceId: 'w1' },
      { id: 'n2', title: 'World', body: '', widgetInstanceId: null },
    ]);
    await expect(repo.search('  big ', 5)).resolves.toEqual([
      { id: 'n1', title: 'T', widgetInstanceId: 'w1', excerpt: 'hello big world' },
      { id: 'n2', title: 'World', widgetInstanceId: null, excerpt: '' },
    ]);
    expect(invoke).toHaveBeenCalledWith('note_search', { query: '  big ', limit: 5 });
  });

  it('maps a Rust error', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ kind: 'not_found' });
    await expect(repo.update('n1', 'a', 'b')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('is unavailable outside Tauri, without a call', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.get('n1')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
