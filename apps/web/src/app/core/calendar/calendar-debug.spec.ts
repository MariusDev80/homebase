import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CLOCK, SETTINGS_REPOSITORY, TODO_REPOSITORY } from '../../data';
import { DashboardStore } from '../dashboard/dashboard.store';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeTodoRepository } from '../testing/fake-todo.repository';
import { SYSTEM_TIME_ZONE_READER } from '../time';
import { ManualClock } from '../time/testing/manual-clock';
import { clearSeededTodos, seedRepeatingTodos } from './calendar-debug';

describe('calendar debug todo seeding (PV-CO2)', () => {
  let repo: FakeTodoRepository;

  function setup(instances: { id: string; widgetType: string }[]): Injector {
    const clock = new ManualClock('2026-11-18T11:00:00.000Z');
    repo = new FakeTodoRepository(clock);
    TestBed.configureTestingModule({
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: TODO_REPOSITORY, useValue: repo },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
        { provide: DashboardStore, useValue: { instances: () => instances } },
      ],
    });
    return TestBed.inject(Injector);
  }

  it('creates N daily repeating todos due today in the list of the first todo widget', async () => {
    const injector = setup([
      { id: 'n1', widgetType: 'notes' },
      { id: 'w1', widgetType: 'todo' },
      { id: 'w2', widgetType: 'todo' },
    ]);
    const first = repo.seedList('w1');
    const second = repo.seedList('w2');
    await seedRepeatingTodos(injector, 3);
    expect(repo.items).toHaveLength(3);
    expect(repo.items.every((t) => t.listId === first.id)).toBe(true);
    expect(repo.items.map((t) => [t.title, t.rrule, t.dueOn])).toEqual([
      ['pv-co-0', 'FREQ=DAILY', '2026-11-18'],
      ['pv-co-1', 'FREQ=DAILY', '2026-11-18'],
      ['pv-co-2', 'FREQ=DAILY', '2026-11-18'],
    ]);
    expect(second.id).not.toBe(first.id);
  });

  it('clearSeededTodos removes only the seeded todos', async () => {
    const injector = setup([{ id: 'w1', widgetType: 'todo' }]);
    const list = repo.seedList('w1');
    repo.seed(list.id, 'keep me');
    await seedRepeatingTodos(injector, 2);
    await clearSeededTodos(injector);
    expect(repo.items.map((t) => t.title)).toEqual(['keep me']);
  });

  it('rejects with a clear message without a todo widget', async () => {
    const injector = setup([{ id: 'n1', widgetType: 'notes' }]);
    await expect(seedRepeatingTodos(injector, 1)).rejects.toThrow(/no todo widget/);
    expect(repo.items).toEqual([]);
  });
});
