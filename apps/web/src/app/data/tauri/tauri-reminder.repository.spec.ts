import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ReminderInput } from '../models';
import { TauriReminderRepository } from './tauri-reminder.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

const INPUT: ReminderInput = {
  title: 'Pills',
  startLocal: '2026-11-17T08:00:00',
  timeZone: 'Europe/Paris',
  rrule: 'FREQ=DAILY',
  exdates: ['2026-11-18T08:00:00'],
  enabled: true,
};

describe('TauriReminderRepository', () => {
  let repo: TauriReminderRepository;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriReminderRepository(() => 'generated-id');
  });

  it('list', async () => {
    await repo.list();
    expect(invoke).toHaveBeenCalledWith('reminder_list', undefined);
  });

  it('create generates the id when absent', async () => {
    await repo.create(INPUT);
    expect(invoke).toHaveBeenCalledWith('reminder_create', {
      input: { id: 'generated-id', ...INPUT },
    });
  });

  it('create keeps a given id and sends no extra field', async () => {
    await repo.create({ ...INPUT, id: 'mine', nextFireAt: 'x' } as ReminderInput & { id: string });
    expect(invoke).toHaveBeenCalledWith('reminder_create', { input: { id: 'mine', ...INPUT } });
  });

  it('update', async () => {
    await repo.update('r1', INPUT);
    expect(invoke).toHaveBeenCalledWith('reminder_update', { id: 'r1', input: INPUT });
  });

  it('remove', async () => {
    await repo.remove('r1');
    expect(invoke).toHaveBeenCalledWith('reminder_delete', { id: 'r1' });
  });

  it('unseenDeliveries', async () => {
    await repo.unseenDeliveries(50);
    expect(invoke).toHaveBeenCalledWith('reminder_unseen_deliveries', { limit: 50 });
  });

  it('markSeen all and one', async () => {
    await repo.markSeen({ kind: 'all' });
    expect(invoke).toHaveBeenLastCalledWith('reminder_mark_seen', { target: { kind: 'all' } });
    await repo.markSeen({ kind: 'one', reminderId: 'r1', occurrenceKey: '2026-11-17T08:00:00' });
    expect(invoke).toHaveBeenLastCalledWith('reminder_mark_seen', {
      target: { kind: 'one', reminderId: 'r1', occurrenceKey: '2026-11-17T08:00:00' },
    });
  });

  it('is unavailable outside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.list()).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
