import { TestBed } from '@angular/core/testing';
import { CLOCK, DataError, SETTINGS_REPOSITORY } from '../../data';
import { TODO_REPOSITORY } from '../../data/content.tokens';
import { CalendarAggregator } from '../../core/calendar/calendar-aggregator';
import { rangeLocalDates } from '../../core/calendar/calendar-range';
import type { CalendarEvent, CalendarRange } from '../../core/calendar/calendar-source';
import { fixtureDefinition } from '../../core/testing/fixture-definitions';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { FakeTodoRepository } from '../../core/testing/fake-todo.repository';
import {
  RECURRENCE_ENGINE,
  SYSTEM_TIME_ZONE_READER,
  addDays,
  compareLocalDates,
  startOfDay,
} from '../../core/time';
import { FakeRecurrenceEngine } from '../../core/time/testing/fake-recurrence-engine';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { provideWidget } from '../../core/widgets/widget-registry';
import { TodoCalendarSource } from './todo.calendar-source';

// 2026-11-18 12:00 in Paris (a Wednesday).
const NOW = '2026-11-18T11:00:00.000Z';
const RANGE: CalendarRange = {
  from: startOfDay('2026-11-09', 'Europe/Paris'),
  to: startOfDay('2026-11-23', 'Europe/Paris'),
  timeZone: 'Europe/Paris',
};
// November month grid: 2026-10-26 .. 2026-12-06.
const MONTH: CalendarRange = {
  from: startOfDay('2026-10-26', 'Europe/Paris'),
  to: startOfDay('2026-12-07', 'Europe/Paris'),
  timeZone: 'Europe/Paris',
};

/** Consecutive dates every `step` days from `start` (what the Rust engine would give). */
function series(start: string, step: number, until: string): string[] {
  const dates: string[] = [];
  for (let d = start; compareLocalDates(d, until) <= 0; d = addDays(d, step)) dates.push(d);
  return dates;
}

describe('TodoCalendarSource', () => {
  let repo: FakeTodoRepository;
  let engine: FakeRecurrenceEngine;
  let source: TodoCalendarSource;
  let listId: string;

  beforeEach(() => {
    const clock = new ManualClock(NOW);
    repo = new FakeTodoRepository(clock);
    engine = new FakeRecurrenceEngine();
    listId = repo.seedList('w1').id;
    TestBed.configureTestingModule({
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: TODO_REPOSITORY, useValue: repo },
        { provide: RECURRENCE_ENGINE, useValue: engine },
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
    expect(events.map((e) => [e.sourceId, e.tone, e.status])).toEqual([
      [overdue.id, 'danger', 'overdue'],
      [today.id, 'neutral', undefined],
      [later.id, 'neutral', undefined],
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
    // Today (11-18) is in the range: listDue starts at today, the overdue read covers the rest.
    expect(repo.calls).toContain(`listDue:2026-11-18:${lastOn}:1000`);
    expect(repo.calls).toContain(`listRepeatingDueBy:${lastOn}:1000`);
  });

  it('does not return completed todos or todos outside the range', async () => {
    repo.seed(listId, 'done', { dueOn: '2026-11-19', completedAt: NOW });
    repo.seed(listId, 'outside', { dueOn: '2026-12-25' });
    repo.seed(listId, 'no date');
    expect(await source.listEvents(RANGE)).toEqual([]);
    expect(engine.expandCalls).toEqual([]);
  });

  describe('repeating todos (November month, today 2026-11-18)', () => {
    /** What Rust would return from each anchor, clipped to the requested range. */
    function scriptEngine(): void {
      engine.respond = (spec) => {
        if (spec.anchor.kind !== 'date') throw new Error('date anchor expected');
        const start = spec.anchor.startOn;
        if (start === '2026-11-01') throw new Error('expansion_limit');
        let dates: string[];
        if (spec.rrule === 'FREQ=WEEKLY') dates = series(start, 7, '2027-01-31');
        else if (spec.rrule === 'FREQ=DAILY') dates = series(start, 1, '2027-01-31');
        else dates = ['2026-10-31', '2026-11-30', '2026-12-31'];
        return {
          occurrences: dates
            .filter((d) => d >= '2026-10-26' && d <= '2026-12-06')
            .map((d) => ({ kind: 'date' as const, key: d, date: d })),
          truncated: false,
        };
      };
    }

    const summary = (events: readonly CalendarEvent[]) =>
      events.map((e) => [
        e.occurrenceKey,
        e.time.kind === 'all-day' ? e.time.startOn : '?',
        e.tone,
        e.status,
      ]);

    it('T1 weekly: current due then the projections', async () => {
      scriptEngine();
      const t1 = repo.seed(listId, 'T1', { dueOn: '2026-11-18', rrule: 'FREQ=WEEKLY' });
      const events = await source.listEvents(MONTH);
      expect(events.map((e) => e.id)).toEqual([
        `todo:${t1.id}:2026-11-18`,
        `todo:${t1.id}:2026-11-25`,
        `todo:${t1.id}:2026-12-02`,
      ]);
      expect(summary(events)).toEqual([
        ['2026-11-18', '2026-11-18', 'neutral', undefined],
        ['2026-11-25', '2026-11-25', 'neutral', 'projected'],
        ['2026-12-02', '2026-12-02', 'neutral', 'projected'],
      ]);
    });

    it('T2 daily and late: overdue line, nothing in between, then one per day', async () => {
      scriptEngine();
      repo.seed(listId, 'T2', { dueOn: '2026-11-10', rrule: 'FREQ=DAILY' });
      const events = await source.listEvents(MONTH);
      expect(events[0]).toMatchObject({
        occurrenceKey: '2026-11-10',
        tone: 'danger',
        status: 'overdue',
      });
      const projected = events.slice(1);
      expect(projected).toHaveLength(18);
      expect(projected.every((e) => e.status === 'projected' && e.tone === 'neutral')).toBe(true);
      expect(projected[0].occurrenceKey).toBe('2026-11-19');
      expect(projected[17].occurrenceKey).toBe('2026-12-06');
    });

    it('T3 last day of the month and late', async () => {
      scriptEngine();
      repo.seed(listId, 'T3', {
        dueOn: '2026-10-31',
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      });
      const events = await source.listEvents(MONTH);
      // 31/10 is in the month grid: overdue current due, then 30/11 (31/12 is out of range).
      expect(summary(events)).toEqual([
        ['2026-10-31', '2026-11-18', 'danger', 'overdue'],
        ['2026-11-30', '2026-11-30', 'neutral', 'projected'],
      ]);
    });

    it('T4 without a rule and T5 outside the subset: key null, no expansion', async () => {
      scriptEngine();
      const t4 = repo.seed(listId, 'T4', { dueOn: '2026-11-20' });
      const t5 = repo.seed(listId, 'T5', { dueOn: '2026-11-23', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
      const events = await source.listEvents(MONTH);
      expect(events.map((e) => [e.id, e.occurrenceKey])).toEqual([
        [`todo:${t4.id}:`, null],
        [`todo:${t5.id}:`, null],
      ]);
      expect(engine.expandCalls).toEqual([]);
    });

    it('T6 due on the last day of the range: itself only, no expansion', async () => {
      scriptEngine();
      const t6 = repo.seed(listId, 'T6', { dueOn: '2026-12-06', rrule: 'FREQ=WEEKLY' });
      const events = await source.listEvents(MONTH);
      expect(events.map((e) => e.id)).toEqual([`todo:${t6.id}:2026-12-06`]);
      expect(engine.expandCalls).toEqual([]);
    });

    it('does not read a repeating todo due after the range', async () => {
      scriptEngine();
      repo.seed(listId, 'future', { dueOn: '2026-12-20', rrule: 'FREQ=WEEKLY' });
      expect(await source.listEvents(MONTH)).toEqual([]);
      expect(engine.expandCalls).toEqual([]);
    });

    it('T7 expansion failure: the current due stays, the others are intact', async () => {
      scriptEngine();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const t1 = repo.seed(listId, 'T1', { dueOn: '2026-11-18', rrule: 'FREQ=WEEKLY' });
      const t2 = repo.seed(listId, 'T2', { dueOn: '2026-11-10', rrule: 'FREQ=DAILY' });
      const t3 = repo.seed(listId, 'T3', {
        dueOn: '2026-10-31',
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      });
      const t7 = repo.seed(listId, 'T7', { dueOn: '2026-11-01', rrule: 'FREQ=DAILY' });
      const events = await source.listEvents(MONTH);
      const of = (id: string) => events.filter((e) => e.sourceId === id);
      expect(of(t7.id).map((e) => [e.id, e.status])).toEqual([
        [`todo:${t7.id}:2026-11-01`, 'overdue'],
      ]);
      expect(of(t1.id)).toHaveLength(3);
      expect(of(t2.id)).toHaveLength(19);
      expect(of(t3.id)).toHaveLength(2);
      // Identifier only in the log, never the title.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(t7.id));
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('T7'));
    });

    it('expands with a dated anchor, the range of the caller and a limit of 62', async () => {
      scriptEngine();
      repo.seed(listId, 'T1', { dueOn: '2026-11-18', rrule: 'FREQ=WEEKLY' });
      await source.listEvents(MONTH);
      expect(engine.expandCalls).toHaveLength(1);
      expect(engine.expandCalls[0]).toEqual({
        spec: {
          anchor: { kind: 'date', startOn: '2026-11-18' },
          rrule: 'FREQ=WEEKLY',
          exdates: [],
        },
        range: { from: MONTH.from, to: MONTH.to, timeZone: 'Europe/Paris', limit: 62 },
      });
    });

    it('runs at most 8 expansions at once', async () => {
      scriptEngine();
      for (let i = 0; i < 20; i++) {
        repo.seed(listId, `R${i}`, { dueOn: '2026-11-18', rrule: 'FREQ=WEEKLY' });
      }
      let inFlight = 0;
      let peak = 0;
      const original = engine.expand.bind(engine);
      engine.expand = async (spec, range) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        inFlight--;
        return original(spec, range);
      };
      const events = await source.listEvents(MONTH);
      expect(events).toHaveLength(20 * 3);
      expect(peak).toBe(8);
    });

    it('late before the range: the current due on today, then the projections', async () => {
      scriptEngine();
      repo.seed(listId, 'old', { dueOn: '2026-10-20', rrule: 'FREQ=DAILY' });
      const events = await source.listEvents(MONTH);
      expect(events).toHaveLength(19);
      expect(events[0]).toMatchObject({
        occurrenceKey: '2026-10-20',
        status: 'overdue',
        originalOn: '2026-10-20',
        time: { kind: 'all-day', startOn: '2026-11-18', lastOn: '2026-11-18' },
      });
      expect(events.slice(1).every((e) => e.status === 'projected')).toBe(true);
      expect(events[1].occurrenceKey).toBe('2026-11-19');
    });

    it('a rejection of listRepeatingDueBy rejects the source', async () => {
      scriptEngine();
      vi.spyOn(repo, 'listRepeatingDueBy').mockRejectedValue(new DataError('unknown', 'boom'));
      await expect(source.listEvents(MONTH)).rejects.toMatchObject({ kind: 'unknown' });
    });

    it('a completed repeating todo shows nothing', async () => {
      scriptEngine();
      repo.seed(listId, 'done', {
        dueOn: '2026-11-20',
        rrule: 'FREQ=WEEKLY',
        completedAt: NOW,
      });
      expect(await source.listEvents(MONTH)).toEqual([]);
      expect(engine.expandCalls).toEqual([]);
    });

    it('lets the real aggregator keep every event (nothing dropped)', async () => {
      scriptEngine();
      const aggregatorSetup = () => {
        TestBed.resetTestingModule();
        const clock = new ManualClock(NOW);
        TestBed.configureTestingModule({
          providers: [
            provideWidget(
              fixtureDefinition({
                type: 'todo',
                loadCalendarSource: () => Promise.resolve(TodoCalendarSource),
              }),
            ),
            { provide: CLOCK, useValue: clock },
            { provide: TODO_REPOSITORY, useValue: repo },
            { provide: RECURRENCE_ENGINE, useValue: engine },
            { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
            { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
          ],
        });
        return TestBed.inject(CalendarAggregator);
      };
      repo.seed(listId, 'T1', { dueOn: '2026-11-18', rrule: 'FREQ=WEEKLY' });
      repo.seed(listId, 'T2', { dueOn: '2026-11-10', rrule: 'FREQ=DAILY' });
      repo.seed(listId, 'T4', { dueOn: '2026-11-20' });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const direct = await source.listEvents(MONTH);
      const result = await aggregatorSetup().listEvents(MONTH);
      expect(result.failedSources).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.events).toHaveLength(direct.length);
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Calendar event dropped'));
    });
  });

  describe('overdue todos carried over to today (2026-11-18)', () => {
    const PAST: CalendarRange = {
      from: startOfDay('2026-10-01', 'Europe/Paris'),
      to: startOfDay('2026-11-01', 'Europe/Paris'),
      timeZone: 'Europe/Paris',
    };
    const NEXT: CalendarRange = {
      from: startOfDay('2026-12-01', 'Europe/Paris'),
      to: startOfDay('2027-01-01', 'Europe/Paris'),
      timeZone: 'Europe/Paris',
    };

    const span = (from: string, to: string): CalendarRange => ({
      from: startOfDay(from, 'Europe/Paris'),
      to: startOfDay(to, 'Europe/Paris'),
      timeZone: 'Europe/Paris',
    });

    it.each([
      ['today is the first date', '2026-11-18', '2026-11-25'],
      ['today is the last date', '2026-11-12', '2026-11-19'],
    ])('carries over when %s of the range', async (_label, from, to) => {
      const late = repo.seed(listId, 'late', { dueOn: '2026-11-10' });
      const events = await source.listEvents(span(from, to));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        sourceId: late.id,
        originalOn: '2026-11-10',
        time: { kind: 'all-day', startOn: '2026-11-18', lastOn: '2026-11-18' },
      });
      expect(repo.calls).toContain('listOverdueBefore:2026-11-18:1000');
    });

    it('reads nothing for a past range', async () => {
      repo.seed(listId, 'late', { dueOn: '2026-10-10' });
      expect(await source.listEvents(PAST)).toEqual([]);
      expect(repo.calls).toEqual([]);
    });

    it('a future range reads the due dates and the repeating ones, not the overdue', async () => {
      await source.listEvents(NEXT);
      expect(repo.calls).toEqual([
        'listDue:2026-12-01:2026-12-31:1000',
        'listRepeatingDueBy:2026-12-31:1000',
      ]);
    });

    it('moves a todo due yesterday onto the new day after midnight', async () => {
      const t = repo.seed(listId, 't', { dueOn: '2026-11-18' });
      expect((await source.listEvents(RANGE))[0].status).toBeUndefined();
      // 2026-11-19 00:30 in Paris.
      (TestBed.inject(CLOCK) as ManualClock).set('2026-11-18T23:30:00.000Z');
      window.dispatchEvent(new Event('focus'));
      const [event] = await source.listEvents(RANGE);
      expect(event).toMatchObject({
        sourceId: t.id,
        status: 'overdue',
        originalOn: '2026-11-18',
        time: { kind: 'all-day', startOn: '2026-11-19', lastOn: '2026-11-19' },
      });
    });

    it('shows a simple overdue todo on today with its original date and unchanged id', async () => {
      const late = repo.seed(listId, 'late', { dueOn: '2026-11-10' });
      expect(await source.listEvents(RANGE)).toEqual([
        {
          id: `todo:${late.id}:`,
          sourceType: 'todo',
          sourceId: late.id,
          occurrenceKey: null,
          title: 'late',
          time: { kind: 'all-day', startOn: '2026-11-18', lastOn: '2026-11-18' },
          tone: 'danger',
          status: 'overdue',
          originalOn: '2026-11-10',
        },
      ]);
    });

    it('carries over an overdue todo due before firstOn', async () => {
      const old = repo.seed(listId, 'old', { dueOn: '2026-08-01' });
      const events = await source.listEvents(RANGE);
      expect(events.map((e) => [e.sourceId, e.originalOn])).toEqual([[old.id, '2026-08-01']]);
      expect(repo.calls).toContain('listOverdueBefore:2026-11-18:1000');
    });

    it('does not duplicate an overdue todo that is also inside the range', async () => {
      repo.seed(listId, 'late', { dueOn: '2026-11-10' });
      repo.seed(listId, 'repeat', { dueOn: '2026-11-12', rrule: 'FREQ=WEEKLY' });
      const events = await source.listEvents(RANGE);
      expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
      expect(events.filter((e) => e.status === 'overdue')).toHaveLength(2);
    });

    it('a range without today shows nothing carried over and reads no overdue', async () => {
      repo.seed(listId, 'late', { dueOn: '2026-10-10' });
      expect(await source.listEvents(PAST)).toEqual([]);
      expect(await source.listEvents(NEXT)).toEqual([]);
      expect(repo.calls.some((c) => c.startsWith('listOverdueBefore'))).toBe(false);
    });

    it('a repeating overdue todo: current due on today, projections unchanged', async () => {
      engine.respond = () => ({
        occurrences: series('2026-11-10', 7, '2026-12-06').map((d) => ({
          kind: 'date' as const,
          key: d,
          date: d,
        })),
        truncated: false,
      });
      const t = repo.seed(listId, 'T', { dueOn: '2026-11-10', rrule: 'FREQ=WEEKLY' });
      const events = await source.listEvents(MONTH);
      expect(events.map((e) => [e.id, e.time.kind === 'all-day' ? e.time.startOn : '?'])).toEqual([
        [`todo:${t.id}:2026-11-10`, '2026-11-18'],
        [`todo:${t.id}:2026-11-24`, '2026-11-24'],
        [`todo:${t.id}:2026-12-01`, '2026-12-01'],
      ]);
      expect(events[0]).toMatchObject({ status: 'overdue', originalOn: '2026-11-10' });
    });

    it('orders carried-over todos by due date then sort order, before today', async () => {
      const today = repo.seed(listId, 'today', { dueOn: '2026-11-18' });
      const b = repo.seed(listId, 'b', { dueOn: '2026-11-12' });
      const a = repo.seed(listId, 'a', { dueOn: '2026-11-12' });
      const first = repo.seed(listId, 'first', { dueOn: '2026-11-01' });
      await repo.reorder(listId, [today.id, a.id, b.id, first.id]);
      const events = await source.listEvents(RANGE);
      expect(events.map((e) => e.sourceId)).toEqual([first.id, a.id, b.id, today.id]);
    });

    it('the real aggregator keeps them with originalOn', async () => {
      TestBed.resetTestingModule();
      const clock = new ManualClock(NOW);
      TestBed.configureTestingModule({
        providers: [
          provideWidget(
            fixtureDefinition({
              type: 'todo',
              loadCalendarSource: () => Promise.resolve(TodoCalendarSource),
            }),
          ),
          { provide: CLOCK, useValue: clock },
          { provide: TODO_REPOSITORY, useValue: repo },
          { provide: RECURRENCE_ENGINE, useValue: engine },
          { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
          { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
        ],
      });
      repo.seed(listId, 'late', { dueOn: '2026-11-10' });
      const result = await TestBed.inject(CalendarAggregator).listEvents(RANGE);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].originalOn).toBe('2026-11-10');
    });
  });
});
