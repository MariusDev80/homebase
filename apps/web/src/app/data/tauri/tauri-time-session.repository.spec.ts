import { invoke, isTauri } from '@tauri-apps/api/core';
import { TauriTimeSessionRepository } from './tauri-time-session.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

describe('TauriTimeSessionRepository', () => {
  let repo: TauriTimeSessionRepository;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriTimeSessionRepository(() => 'generated-id');
  });

  it('listRunning', async () => {
    await repo.listRunning();
    expect(invoke).toHaveBeenCalledWith('session_list_running', undefined);
  });

  it('history without and with a cursor', async () => {
    await repo.history({ limit: 100 });
    expect(invoke).toHaveBeenLastCalledWith('session_history', { before: null, limit: 100 });
    await repo.history({
      before: { startedAt: '2026-11-16T10:00:00.000Z', id: 's1' },
      limit: 20,
    });
    expect(invoke).toHaveBeenLastCalledWith('session_history', {
      before: { startedAt: '2026-11-16T10:00:00.000Z', id: 's1' },
      limit: 20,
    });
  });

  it('start generates the id when absent', async () => {
    await repo.start({ kind: 'countdown', label: 'Tea', durationMs: 180000 });
    expect(invoke).toHaveBeenCalledWith('session_start', {
      input: { id: 'generated-id', kind: 'countdown', label: 'Tea', durationMs: 180000 },
    });
  });

  it('start keeps a given id and sends a null duration for a stopwatch', async () => {
    await repo.start({ id: 'mine', kind: 'stopwatch', label: '', durationMs: null });
    expect(invoke).toHaveBeenCalledWith('session_start', {
      input: { id: 'mine', kind: 'stopwatch', label: '', durationMs: null },
    });
  });

  it('refuses an unsafe duration without calling Rust', async () => {
    for (const durationMs of [1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(repo.start({ kind: 'countdown', label: '', durationMs })).rejects.toMatchObject({
        kind: 'invalid_input',
      });
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stop, rename, remove', async () => {
    await repo.stop('s1');
    expect(invoke).toHaveBeenLastCalledWith('session_stop', { id: 's1' });
    await repo.rename('s1', 'New');
    expect(invoke).toHaveBeenLastCalledWith('session_rename', { id: 's1', label: 'New' });
    await repo.remove('s1');
    expect(invoke).toHaveBeenLastCalledWith('session_delete', { id: 's1' });
  });

  it('is unavailable outside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.stop('s1')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
