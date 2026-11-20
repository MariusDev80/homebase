import { invoke, isTauri } from '@tauri-apps/api/core';
import type { HabitInput } from '../models';
import { TauriHabitRepository } from './tauri-habit.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

const INPUT: HabitInput = {
  title: 'Meditate',
  schedule: { kind: 'days', days: ['MO', 'WE'] },
  startOn: '2026-11-16',
  reminder: { time: '20:00', days: ['MO', 'WE'], timeZone: 'Europe/Paris', enabled: true },
};

describe('TauriHabitRepository', () => {
  let repo: TauriHabitRepository;
  let counter: number;

  beforeEach(() => {
    counter = 0;
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriHabitRepository(() => `id-${++counter}`);
  });

  it('list', async () => {
    await repo.list();
    expect(invoke).toHaveBeenCalledWith('habit_list', {});
  });

  it('create generates the habit and reminder ids', async () => {
    await repo.create(INPUT);
    expect(invoke).toHaveBeenCalledWith('habit_create', {
      input: {
        id: 'id-1',
        title: 'Meditate',
        schedule: { kind: 'days', days: ['MO', 'WE'] },
        startOn: '2026-11-16',
        reminder: {
          id: 'id-2',
          time: '20:00',
          days: ['MO', 'WE'],
          timeZone: 'Europe/Paris',
          enabled: true,
        },
      },
    });
  });

  it('create keeps a given id, sends no extra field and a null reminder', async () => {
    const extra = {
      ...INPUT,
      id: 'mine',
      schedule: { kind: 'weekly', target: 3, extra: 1 },
      reminder: null,
      archivedAt: 'x',
    } as unknown as HabitInput & { id: string };
    await repo.create(extra);
    expect(invoke).toHaveBeenCalledWith('habit_create', {
      input: {
        id: 'mine',
        title: 'Meditate',
        schedule: { kind: 'weekly', target: 3 },
        startOn: '2026-11-16',
        reminder: null,
      },
    });
  });

  it('update always sends the reminder key (null removes it)', async () => {
    await repo.update('h1', { ...INPUT, reminder: null });
    expect(invoke).toHaveBeenCalledWith('habit_update', {
      id: 'h1',
      input: {
        title: 'Meditate',
        schedule: { kind: 'days', days: ['MO', 'WE'] },
        startOn: '2026-11-16',
        reminder: null,
      },
    });
  });

  it('update with a reminder', async () => {
    await repo.update('h1', INPUT);
    const call = vi.mocked(invoke).mock.calls[0];
    expect(call[0]).toBe('habit_update');
    expect(call[1]).toMatchObject({
      id: 'h1',
      input: { reminder: { id: 'id-1', time: '20:00', enabled: true } },
    });
  });

  it('setArchived, remove, checks, setCheck', async () => {
    await repo.setArchived('h1', true);
    expect(invoke).toHaveBeenLastCalledWith('habit_set_archived', { id: 'h1', archived: true });
    await repo.remove('h1');
    expect(invoke).toHaveBeenLastCalledWith('habit_delete', { id: 'h1' });
    await repo.checks({ from: '2025-10-14', to: '2026-11-17' });
    expect(invoke).toHaveBeenLastCalledWith('habit_checks', {
      from: '2025-10-14',
      to: '2026-11-17',
    });
    await repo.setCheck('h1', '2026-11-17', true);
    expect(invoke).toHaveBeenLastCalledWith('habit_set_check', {
      habitId: 'h1',
      dayOn: '2026-11-17',
      done: true,
    });
  });

  it('is unavailable outside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.list()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('maps limit_reached to forbidden', async () => {
    vi.mocked(invoke).mockRejectedValue({ kind: 'limit_reached' });
    await expect(repo.create(INPUT)).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
