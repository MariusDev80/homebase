import { TestBed } from '@angular/core/testing';
import { CLOCK, DataError, SETTINGS_REPOSITORY } from '../../data';
import { HABIT_REPOSITORY } from '../../data/schedule.tokens';
import type { CalendarRange } from '../../core/calendar/calendar-source';
import { FakeHabitRepository } from '../../core/testing/fake-habit.repository';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { HabitsCalendarSource } from './habits.calendar-source';

const RANGE: CalendarRange = {
  from: '2026-11-08T23:00:00.000Z',
  to: '2026-11-24T23:00:00.000Z',
  timeZone: 'Europe/Paris',
};

describe('HabitsCalendarSource (CA-CO3-3)', () => {
  let repo: FakeHabitRepository;

  function source(): HabitsCalendarSource {
    const clock = new ManualClock('2026-11-18T11:00:00.000Z');
    repo = new FakeHabitRepository(clock);
    TestBed.configureTestingModule({
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: HABIT_REPOSITORY, useValue: repo },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
      ],
    });
    return TestBed.inject(HabitsCalendarSource);
  }

  it('reads list and checks over the local days of the range', async () => {
    const s = source();
    const created = await repo.create({
      title: 'Read',
      schedule: { kind: 'days', days: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] },
      startOn: '2026-11-01',
      reminder: null,
    });
    await repo.setCheck(created.id, '2026-11-17', true);
    const checks = vi.spyOn(repo, 'checks');
    const listSpy = vi.spyOn(repo, 'list');
    const events = await s.listEvents(RANGE);
    expect(checks).toHaveBeenCalledWith({ from: '2026-11-08', to: '2026-11-25' });
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.occurrenceKey === '2026-11-17')?.status).toBe('done');
    expect(events.find((e) => e.occurrenceKey === '2026-11-16')).toBeUndefined();
    expect(events.find((e) => e.occurrenceKey === '2026-11-20')?.status).toBe('planned');
  });

  it('starts both reads before either settles', async () => {
    const s = source();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(repo, 'list').mockImplementation(async () => {
      started.push('list');
      await gate;
      return [];
    });
    vi.spyOn(repo, 'checks').mockImplementation(async () => {
      started.push('checks');
      await gate;
      return [];
    });
    const pending = s.listEvents(RANGE);
    expect(started).toEqual(['list', 'checks']);
    release();
    await pending;
  });

  it('rejects when list rejects (unavailable included), and when checks rejects', async () => {
    const s = source();
    vi.spyOn(repo, 'list').mockRejectedValueOnce(new DataError('unavailable', 'x'));
    await expect(s.listEvents(RANGE)).rejects.toMatchObject({ kind: 'unavailable' });
    vi.spyOn(repo, 'checks').mockRejectedValueOnce(new DataError('unknown', 'y'));
    await expect(s.listEvents(RANGE)).rejects.toBeInstanceOf(DataError);
  });
});
