import type { Habit, HabitCheck, HabitReminder, HabitSchedule } from '../../data';
import type { CalendarRange } from '../../core/calendar/calendar-source';
import { habitEvents, habitTime } from './habit-calendar';

const ALL = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const PARIS_RANGE: CalendarRange = {
  from: '2026-11-08T23:00:00.000Z',
  to: '2026-11-24T23:00:00.000Z',
  timeZone: 'Europe/Paris',
};
const DAYS = { firstOn: '2026-11-09', lastOn: '2026-11-24' };
const TODAY = '2026-11-18';

function reminder(over: Partial<HabitReminder> = {}): HabitReminder {
  return {
    reminderId: 'r',
    time: '20:00',
    days: ALL,
    timeZone: 'Europe/Paris',
    enabled: true,
    nextFireAt: null,
    nextFireKey: null,
    status: 'scheduled',
    ...over,
  };
}

function habit(
  id: string,
  schedule: HabitSchedule,
  startOn: string,
  over: Partial<Habit> = {},
): Habit {
  return {
    id,
    title: `Habit ${id}`,
    schedule,
    startOn,
    archivedAt: null,
    reminder: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

const check = (habitId: string, dayOn: string): HabitCheck => ({
  habitId,
  dayOn,
});

function run(habits: Habit[], checks: HabitCheck[]) {
  return habitEvents(habits, checks, PARIS_RANGE, DAYS, TODAY);
}

const summary = (events: ReturnType<typeof run>, id: string) =>
  events.filter((e) => e.sourceId === id).map((e) => [e.occurrenceKey, e.status, e.tone] as const);

describe('habitEvents (CA-CO3-1, O9)', () => {
  const h1 = habit('h1', { kind: 'days', days: ['MO', 'WE', 'FR'] }, '2026-11-01');
  const h2 = habit('h2', { kind: 'weekly', target: 3 }, '2026-11-01');
  const h3 = habit('h3', { kind: 'days', days: ALL }, '2026-11-01', {
    archivedAt: '2026-11-10T00:00:00.000Z',
  });
  const h4 = habit('h4', { kind: 'days', days: ALL }, '2026-11-20');
  const checks = [
    check('h1', '2026-11-13'),
    check('h1', '2026-11-17'),
    check('h1', '2026-11-18'),
    check('h2', '2026-11-17'),
    check('h3', '2026-11-18'),
    check('h4', '2026-11-19'),
  ];
  const events = run([h1, h2, h3, h4], checks);

  it('shows checked days as done, planned days from today as planned, no gaps filled', () => {
    expect(summary(events, 'h1')).toEqual([
      ['2026-11-13', 'done', 'success'],
      ['2026-11-17', 'done', 'success'],
      ['2026-11-18', 'done', 'success'],
      ['2026-11-20', 'planned', 'neutral'],
      ['2026-11-23', 'planned', 'neutral'],
    ]);
  });

  it('shows a weekly habit on its checked days only', () => {
    expect(summary(events, 'h2')).toEqual([['2026-11-17', 'done', 'success']]);
  });

  it('excludes archived habits', () => {
    expect(summary(events, 'h3')).toEqual([]);
  });

  it('shows nothing before the start date, even checked', () => {
    expect(summary(events, 'h4').map(([day]) => day)).toEqual([
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
    ]);
  });

  it('builds ids, keys and all-day times', () => {
    const first = events.find((e) => e.id === 'habits:h1:2026-11-13');
    expect(first).toEqual({
      id: 'habits:h1:2026-11-13',
      sourceType: 'habits',
      sourceId: 'h1',
      occurrenceKey: '2026-11-13',
      title: 'Habit h1',
      time: { kind: 'all-day', startOn: '2026-11-13', lastOn: '2026-11-13' },
      tone: 'success',
      status: 'done',
    });
  });
});

describe('habitEvents reminder time (CA-CO3-2, O10)', () => {
  const daily = (over: Partial<Habit>) =>
    habit('h', { kind: 'days', days: ALL }, '2026-01-01', over);

  it('is timed at the reminder time in the reminder zone', () => {
    const events = run([daily({ reminder: reminder() })], [check('h', '2026-11-18')]);
    const event = events.find((e) => e.occurrenceKey === '2026-11-18');
    expect(event?.time).toEqual({
      kind: 'timed',
      start: '2026-11-18T19:00:00.000Z',
      end: null,
      timeZone: 'Europe/Paris',
    });
    expect(event?.status).toBe('done');
  });

  it('keeps the time of a disabled reminder', () => {
    const events = run([daily({ reminder: reminder({ enabled: false, status: 'disabled' }) })], []);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.time.kind === 'timed')).toBe(true);
  });

  it('is all-day for an invalid reminder, whose fake time is never used', () => {
    const h = daily({ reminder: reminder({ status: 'invalid', time: '00:00' }) });
    expect(habitTime(h)).toBeNull();
    const events = run([h], []);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.time.kind === 'all-day')).toBe(true);
  });

  it('shifts a nonexistent time forward (K2)', () => {
    const range: CalendarRange = {
      from: '2027-03-27T23:00:00.000Z',
      to: '2027-03-29T22:00:00.000Z',
      timeZone: 'Europe/Paris',
    };
    const h = daily({ reminder: reminder({ time: '02:30' }) });
    const events = habitEvents(
      [h],
      [check('h', '2027-03-28')],
      range,
      { firstOn: '2027-03-28', lastOn: '2027-03-29' },
      '2027-03-28',
    );
    expect(events.find((e) => e.occurrenceKey === '2027-03-28')?.time).toMatchObject({
      start: '2027-03-28T01:30:00.000Z',
    });
  });

  it('keeps the first occurrence of a doubled time, once (K3)', () => {
    const range: CalendarRange = {
      from: '2026-10-24T22:00:00.000Z',
      to: '2026-10-25T23:00:00.000Z',
      timeZone: 'Europe/Paris',
    };
    const h = daily({ reminder: reminder({ time: '02:30' }) });
    const events = habitEvents(
      [h],
      [check('h', '2026-10-25')],
      range,
      { firstOn: '2026-10-25', lastOn: '2026-10-25' },
      '2026-10-25',
    );
    expect(events).toHaveLength(1);
    expect(events[0].time).toMatchObject({ start: '2026-10-25T00:30:00.000Z' });
  });

  it('keeps 09:00 local on both sides of the autumn change (K4)', () => {
    const range: CalendarRange = {
      from: '2026-10-23T22:00:00.000Z',
      to: '2026-10-26T23:00:00.000Z',
      timeZone: 'Europe/Paris',
    };
    const h = daily({ reminder: reminder({ time: '09:00' }) });
    const events = habitEvents(
      [h],
      [],
      range,
      { firstOn: '2026-10-24', lastOn: '2026-10-26' },
      '2026-10-24',
    );
    const starts = events.map((e) => (e.time.kind === 'timed' ? e.time.start : null));
    expect(starts.slice(0, 2)).toEqual(['2026-10-24T07:00:00.000Z', '2026-10-25T08:00:00.000Z']);
  });

  it('falls back to all-day, without throwing, for an unknown zone', () => {
    const h = daily({ reminder: reminder({ timeZone: 'Mars/Olympus' }) });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events = run([h], [check('h', '2026-11-18')]);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.time.kind === 'all-day')).toBe(true);
  });

  it('does not emit a start outside [from, to) (K5)', () => {
    const range: CalendarRange = {
      from: '2026-11-17T10:00:00.000Z', // 2026-11-18T00:00 in Kiritimati (UTC+14)
      to: '2026-11-18T10:00:00.000Z',
      timeZone: 'Pacific/Kiritimati',
    };
    const h = daily({ reminder: reminder() });
    const events = habitEvents(
      [h],
      [],
      range,
      { firstOn: '2026-11-18', lastOn: '2026-11-18' },
      TODAY,
    );
    // 20:00 Paris on the 18th is 19:00Z, after the end of the range.
    expect(events).toEqual([]);
  });
});

describe('habitEvents range edges (K5, other reminder zone)', () => {
  const daily = (time: string, timeZone: string): Habit =>
    habit('h', { kind: 'days', days: ALL }, '2026-01-01', {
      reminder: reminder({ time, timeZone }),
    });

  it('shows the habit of lastOn + 1 on the last visible day (01:00 Paris, Santiago display)', () => {
    const range: CalendarRange = {
      from: '2026-11-09T03:00:00.000Z', // midnight of the 9th in Santiago (UTC-3)
      to: '2026-11-25T03:00:00.000Z',
      timeZone: 'America/Santiago',
    };
    const events = habitEvents([daily('01:00', 'Europe/Paris')], [], range, DAYS, TODAY);
    const last = events[events.length - 1];
    expect(last.occurrenceKey).toBe('2026-11-25');
    expect(last.time).toMatchObject({ start: '2026-11-25T00:00:00.000Z' });
  });

  it('drops the side that starts before from (08:00 Kiritimati, Paris display)', () => {
    const events = habitEvents(
      [daily('08:00', 'Pacific/Kiritimati')],
      [],
      PARIS_RANGE,
      DAYS,
      '2026-11-01', // every day planned
    );
    // 08:00 on the 9th in Kiritimati (UTC+14) is the 8th at 18:00Z, before from (23:00Z).
    expect(events[0].occurrenceKey).toBe('2026-11-10');
  });

  it('keeps start == from and drops start == to', () => {
    const h = daily('09:00', 'Europe/Paris'); // 08:00Z on 2026-11-18
    const exact = (from: string, to: string) =>
      habitEvents(
        [h],
        [check('h', '2026-11-18')],
        { from, to, timeZone: 'Europe/Paris' },
        { firstOn: '2026-11-18', lastOn: '2026-11-18' },
        TODAY,
      ).filter((e) => e.occurrenceKey === '2026-11-18');
    expect(exact('2026-11-18T08:00:00.000Z', '2026-11-18T23:00:00.000Z')).toHaveLength(1);
    expect(exact('2026-11-17T23:00:00.000Z', '2026-11-18T08:00:00.000Z')).toHaveLength(0);
  });
});
