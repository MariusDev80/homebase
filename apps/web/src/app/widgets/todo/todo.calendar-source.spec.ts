import { TestBed } from '@angular/core/testing';
import { CLOCK, SETTINGS_REPOSITORY, TODO_REPOSITORY } from '../../data';
import { rangeLocalDates } from '../../core/calendar/calendar-range';
import type { CalendarRange } from '../../core/calendar/calendar-source';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { FakeTodoRepository } from '../../core/testing/fake-todo.repository';
import { SYSTEM_TIME_ZONE_READER, startOfDay } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { TodoCalendarSource } from './todo.calendar-source';

// 2026-11-18 12:00 in Paris.
const NOW = '2026-11-18T11:00:00.000Z';
const RANGE: CalendarRange = {
  from: startOfDay('2026-11-09', 'Europe/Paris'),
  to: startOfDay('2026-11-23', 'Europe/Paris'),
  timeZone: 'Europe/Paris',
};

describe('TodoCalendarSource', () => {
  let repo: FakeTodoRepository;
  let source: TodoCalendarSource;
  let listId: string;

  beforeEach(() => {
    const clock = new ManualClock(NOW);
    repo = new FakeTodoRepository(clock);
    listId = repo.seedList('w1').id;
    TestBed.configureTestingModule({
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: TODO_REPOSITORY, useValue: repo },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
      ],
    });
    source = TestBed.inject(TodoCalendarSource);
  });

  it('gives danger to an overdue todo and neutral to today and later', async () => {
    const overdue = repo.seed(listId, 'overdue', { dueOn: '2026-11-17' });
    const today = repo.seed(listId, 'today', { dueOn: '2026-11-18' });
    const later = repo.seed(listId, 'later', { dueOn: '2026-11-19' });
    const events = await source.listEvents(RANGE);
    expect(events.map((e) => [e.sourceId, e.tone])).toEqual([
      [overdue.id, 'danger'],
      [today.id, 'neutral'],
      [later.id, 'neutral'],
    ]);
  });

  it('builds an all-day event with the todo identifiers', async () => {
    const todo = repo.seed(listId, 'Pay rent', { dueOn: '2026-11-19' });
    expect(await source.listEvents(RANGE)).toEqual([
      {
        id: `todo:${todo.id}:`,
        sourceType: 'todo',
        sourceId: todo.id,
        occurrenceKey: null,
        title: 'Pay rent',
        time: { kind: 'all-day', startOn: '2026-11-19', lastOn: '2026-11-19' },
        tone: 'neutral',
      },
    ]);
  });

  it('asks the repository for the local dates of the range with a limit of 1000', async () => {
    await source.listEvents(RANGE);
    const { firstOn, lastOn } = rangeLocalDates(RANGE);
    expect(firstOn).toBe('2026-11-09');
    expect(lastOn).toBe('2026-11-22');
    expect(repo.calls).toContain(`listDue:${firstOn}:${lastOn}:1000`);
  });

  it('does not return completed todos or todos outside the range', async () => {
    repo.seed(listId, 'done', { dueOn: '2026-11-19', completedAt: NOW });
    repo.seed(listId, 'outside', { dueOn: '2026-12-25' });
    repo.seed(listId, 'no date');
    expect(await source.listEvents(RANGE)).toEqual([]);
  });
});
