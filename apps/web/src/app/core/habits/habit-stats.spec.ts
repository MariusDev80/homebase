import type { HabitSchedule, LocalDateIso } from '../../data';
import { addDays } from '../time/local-date';
import {
  currentStreak,
  isExpected,
  ratePercent,
  successRate,
  weekProgress,
  weekdayCode,
  type HabitPlan,
} from './habit-stats';

const TODAY = '2026-11-17'; // Tuesday
const WINDOW = addDays(TODAY, -399);
const EVERY_DAY: HabitSchedule = {
  kind: 'days',
  days: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'],
};

function plan(schedule: HabitSchedule, startOn: LocalDateIso): HabitPlan {
  return { schedule, startOn };
}

function range(from: LocalDateIso, to: LocalDateIso): LocalDateIso[] {
  const days: LocalDateIso[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

function set(...days: LocalDateIso[]): Set<LocalDateIso> {
  return new Set(days);
}

describe('habit-stats', () => {
  it('weekdayCode and isExpected', () => {
    expect(weekdayCode('2026-11-16')).toBe('MO');
    expect(weekdayCode('2026-11-22')).toBe('SU');
    const mwf: HabitSchedule = { kind: 'days', days: ['MO', 'WE', 'FR'] };
    expect(isExpected(mwf, '2026-11-16')).toBe(true);
    expect(isExpected(mwf, '2026-11-17')).toBe(false);
    expect(isExpected({ kind: 'weekly', target: 2 }, '2026-11-17')).toBe(true);
  });

  describe('days', () => {
    it('C1: streak of 7, then 8 once today is checked', () => {
      const habit = plan(EVERY_DAY, '2026-11-10');
      const checked = set(...range('2026-11-10', '2026-11-16'));
      expect(currentStreak(habit, checked, TODAY, WINDOW)).toEqual({
        count: 7,
        unit: 'days',
        truncated: false,
      });
      checked.add(TODAY);
      expect(currentStreak(habit, checked, TODAY, WINDOW).count).toBe(8);
    });

    it('C2: a missed day breaks the streak', () => {
      const habit = plan(EVERY_DAY, '2026-11-10');
      const checked = set(...range('2026-11-10', '2026-11-16').filter((d) => d !== '2026-11-11'));
      expect(currentStreak(habit, checked, TODAY, WINDOW).count).toBe(5);
    });

    it('C3: Mon/Wed/Fri skips unplanned days and ignores bonus checks', () => {
      const habit = plan({ kind: 'days', days: ['MO', 'WE', 'FR'] }, '2026-11-02');
      const checked = set(
        '2026-11-02',
        '2026-11-04',
        '2026-11-06',
        '2026-11-09',
        '2026-11-11',
        '2026-11-13',
        '2026-11-16',
        '2026-11-14',
      );
      expect(currentStreak(habit, checked, TODAY, WINDOW).count).toBe(7);
      checked.delete('2026-11-13');
      expect(currentStreak(habit, checked, TODAY, WINDOW).count).toBe(1);
    });

    it('ignores checks before the start date', () => {
      const habit = plan(EVERY_DAY, '2026-11-15');
      const checked = set('2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16');
      expect(currentStreak(habit, checked, TODAY, WINDOW).count).toBe(2);
    });

    it('is truncated when the window ends before the streak', () => {
      const habit = plan(EVERY_DAY, '2025-01-01');
      const checked = set(...range(WINDOW, TODAY));
      expect(currentStreak(habit, checked, TODAY, WINDOW)).toEqual({
        count: 400,
        unit: 'days',
        truncated: true,
      });
    });

    it('is not truncated when the streak reaches the start date inside the window', () => {
      const habit = plan(EVERY_DAY, WINDOW);
      const checked = set(...range(WINDOW, TODAY));
      expect(currentStreak(habit, checked, TODAY, WINDOW)).toEqual({
        count: 400,
        unit: 'days',
        truncated: false,
      });
    });

    it('C6: success rate over the planned days, today left out while unchecked', () => {
      const habit = plan(EVERY_DAY, '2026-11-10');
      const checked = set(...range('2026-11-10', '2026-11-15'));
      const rate = successRate(habit, checked, TODAY);
      expect(rate).toEqual({ done: 6, expected: 7 });
      expect(ratePercent(rate)).toBe(86);
      checked.add(TODAY);
      const withToday = successRate(habit, checked, TODAY);
      expect(withToday).toEqual({ done: 7, expected: 8 });
      expect(ratePercent(withToday)).toBe(88);
    });

    it('rate window is 30 days', () => {
      const habit = plan(EVERY_DAY, '2025-01-01');
      expect(successRate(habit, set(), TODAY)).toEqual({ done: 0, expected: 29 });
      expect(successRate(habit, set(TODAY), TODAY)).toEqual({ done: 1, expected: 30 });
    });

    it('expected = 0 gives no percentage', () => {
      const habit = plan({ kind: 'days', days: ['MO'] }, TODAY);
      const rate = successRate(habit, set(), TODAY);
      expect(rate).toEqual({ done: 0, expected: 0 });
      expect(ratePercent(rate)).toBeNull();
    });

    it('has no week progress', () => {
      expect(weekProgress(plan(EVERY_DAY, TODAY), set(), TODAY)).toBeNull();
    });
  });

  describe('weekly', () => {
    const C4 = plan({ kind: 'weekly', target: 3 }, '2026-11-07');

    it('C4: first week requires min(N, days left); in-progress week does not break', () => {
      const checked = set(
        '2026-11-07',
        '2026-11-08',
        '2026-11-09',
        '2026-11-11',
        '2026-11-13',
        '2026-11-16',
      );
      expect(currentStreak(C4, checked, TODAY, WINDOW)).toEqual({
        count: 2,
        unit: 'weeks',
        truncated: false,
      });
      expect(weekProgress(C4, checked, TODAY)).toEqual({ done: 1, required: 3 });
      checked.add('2026-11-17');
      checked.add('2026-11-18');
      expect(currentStreak(C4, checked, TODAY, WINDOW).count).toBe(3);
      expect(weekProgress(C4, checked, TODAY)).toEqual({ done: 3, required: 3 });
    });

    it('a failed past week stops the streak', () => {
      const checked = set('2026-11-09', '2026-11-10', '2026-11-16', '2026-11-17', '2026-11-18');
      expect(currentStreak(C4, checked, TODAY, WINDOW).count).toBe(1);
    });

    it('C5: two checks across a year boundary count in the same ISO week', () => {
      const habit = plan({ kind: 'weekly', target: 2 }, '2026-12-01');
      const checked = set('2026-12-31', '2027-01-02');
      expect(currentStreak(habit, checked, '2027-01-03', WINDOW).count).toBe(1);
      expect(weekProgress(habit, checked, '2027-01-03')).toEqual({ done: 2, required: 2 });
    });

    it('C7: first day, nothing checked', () => {
      const habit = plan({ kind: 'weekly', target: 1 }, '2026-11-18');
      const today = '2026-11-18';
      expect(weekProgress(habit, set(), today)).toEqual({ done: 0, required: 1 });
      expect(currentStreak(habit, set(), today, WINDOW)).toEqual({
        count: 0,
        unit: 'weeks',
        truncated: false,
      });
      const rate = successRate(habit, set(), today);
      expect(rate).toEqual({ done: 0, expected: 0 });
      expect(ratePercent(rate)).toBeNull();
    });

    it('rate counts the last 4 weeks that touch the history', () => {
      const habit = plan({ kind: 'weekly', target: 1 }, '2026-11-02');
      const checked = set('2026-11-04');
      expect(successRate(habit, checked, TODAY)).toEqual({ done: 1, expected: 2 });
      checked.add('2026-11-16');
      expect(successRate(habit, checked, TODAY)).toEqual({ done: 2, expected: 3 });
    });

    it('rate window is 4 weeks', () => {
      const habit = plan({ kind: 'weekly', target: 1 }, '2025-01-01');
      expect(successRate(habit, set(), TODAY)).toEqual({ done: 0, expected: 3 });
    });

    it('is truncated when the window ends before the streak', () => {
      const habit = plan({ kind: 'weekly', target: 1 }, '2025-01-01');
      const checked = set(...range(WINDOW, TODAY));
      const streak = currentStreak(habit, checked, TODAY, WINDOW);
      expect(streak.truncated).toBe(true);
      expect(streak.unit).toBe('weeks');
      // Weeks starting on or after the window start (2025-10-14): 2025-10-20 ... 2026-11-16.
      expect(streak.count).toBe(57);
    });
  });

  describe('edges', () => {
    it('a weekly check before the start date, in the week of the start, does not count', () => {
      const habit = plan({ kind: 'weekly', target: 1 }, '2026-11-18');
      const checked = set('2026-11-16', '2026-11-17');
      expect(weekProgress(habit, checked, '2026-11-18')).toEqual({ done: 0, required: 1 });
      expect(currentStreak(habit, checked, '2026-11-18', WINDOW).count).toBe(0);
    });

    it('a start date inside the window is not truncated even if its week starts before it', () => {
      // Window start 2025-10-14 (Tuesday); start Thursday 2025-10-16, in the week of Monday 10-13.
      const habit = plan({ kind: 'weekly', target: 1 }, '2025-10-16');
      const checked = set(...range('2025-10-16', TODAY));
      expect(currentStreak(habit, checked, TODAY, WINDOW)).toEqual({
        count: 58,
        unit: 'weeks',
        truncated: false,
      });
    });

    it('a start date after today gives an empty streak and no rate', () => {
      const days = plan(EVERY_DAY, '2026-11-25');
      expect(currentStreak(days, set(), TODAY, WINDOW)).toEqual({
        count: 0,
        unit: 'days',
        truncated: false,
      });
      expect(successRate(days, set(), TODAY)).toEqual({ done: 0, expected: 0 });
      const weekly = plan({ kind: 'weekly', target: 2 }, '2026-11-25');
      expect(currentStreak(weekly, set(), TODAY, WINDOW).count).toBe(0);
      expect(successRate(weekly, set(), TODAY)).toEqual({ done: 0, expected: 0 });
    });
  });
});
