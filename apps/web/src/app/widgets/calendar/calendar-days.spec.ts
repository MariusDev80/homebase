import { groupByDay, withToday } from './calendar-days';
import { CALENDAR_FIXTURES, F10_COUNT, fixture } from './testing/calendar-fixtures';

const days = (zone: string, first = '2026-10-19', last = '2026-11-29') =>
  groupByDay(CALENDAR_FIXTURES, first, last, zone);
const keysOf = (zone: string, day: string) =>
  days(zone)
    .find((g) => g.day === day)
    ?.events.map((e) => e.sourceId) ?? [];

describe('groupByDay', () => {
  it('Paris: F2 and F3 on the 18th, F10 on the 20th, F11 on Sunday', () => {
    expect(keysOf('Europe/Paris', '2026-11-18')).toEqual(['F4', 'F3', 'F1', 'F2']);
    expect(keysOf('Europe/Paris', '2026-11-20')).toHaveLength(F10_COUNT);
    expect(keysOf('Europe/Paris', '2026-11-22')).toEqual(['F11']);
    expect(keysOf('Europe/Paris', '2026-10-25')).toEqual(['F6']);
  });

  it('Santiago: F3 moves to the 17th, F6 to 24 October, F11 to Sunday 19:30', () => {
    expect(keysOf('America/Santiago', '2026-11-17')).toEqual(['F3']);
    expect(keysOf('America/Santiago', '2026-11-18')).toEqual(['F4', 'F1', 'F2']);
    expect(keysOf('America/Santiago', '2026-10-24')).toEqual(['F6']);
    expect(keysOf('America/Santiago', '2026-11-22')).toEqual(['F11']);
  });

  it('lists a multi-day event under each of its days (F5)', () => {
    for (const day of ['2026-11-23', '2026-11-24', '2026-11-25']) {
      expect(keysOf('Europe/Paris', day)).toContain('F5');
    }
    expect(keysOf('Europe/Paris', '2026-11-26')).not.toContain('F5');
  });

  it('clips to the range and sorts the days', () => {
    const groups = groupByDay([fixture('F5')], '2026-11-24', '2026-11-24', 'Europe/Paris');
    expect(groups.map((g) => g.day)).toEqual(['2026-11-24']);
    const all = days('Europe/Paris');
    expect(all.map((g) => g.day)).toEqual([...all.map((g) => g.day)].sort());
  });

  it('adds an empty group for today only when needed', () => {
    const groups = groupByDay([fixture('F1')], '2026-11-17', '2026-11-20', 'Europe/Paris');
    expect(withToday(groups, '2026-11-17', '2026-11-17', '2026-11-20').map((g) => g.day)).toEqual([
      '2026-11-17',
      '2026-11-18',
    ]);
    expect(withToday(groups, '2026-11-18', '2026-11-17', '2026-11-20')).toHaveLength(1);
    expect(withToday(groups, '2026-12-01', '2026-11-17', '2026-11-20')).toHaveLength(1);
  });
});
