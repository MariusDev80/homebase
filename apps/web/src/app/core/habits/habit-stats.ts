import type { HabitSchedule, LocalDateIso, WeekdayCode } from '../../data';
import {
  addDays,
  compareLocalDates,
  daysBetween,
  isoWeekday,
  startOfIsoWeek,
} from '../time/local-date';
import { Temporal } from '../time/temporal';
import { formatLocalDate, parseLocalDate } from '../time/time-format';

const compare = Temporal.PlainDate.compare;
const ONE_DAY = { days: 1 } as const;

/** Per ISO weekday (index 1 = Monday ... 7 = Sunday): is the day planned? */
function plannedWeekdays(schedule: HabitSchedule): readonly boolean[] {
  const planned = [false, false, false, false, false, false, false, false];
  for (let iso = 1; iso <= 7; iso++)
    planned[iso] = schedule.kind === 'weekly' || schedule.days.includes(WEEKDAYS[iso - 1]);
  return planned;
}

/**
 * Streaks and success rates of a habit (spec habits 4.6, decision H8). Pure: every date is a
 * wall date of the user's time zone and all the arithmetic goes through `core/time/local-date`.
 */

/** The parts of a habit the calculations need. */
export interface HabitPlan {
  readonly schedule: HabitSchedule;
  readonly startOn: LocalDateIso;
}

export interface Streak {
  readonly count: number;
  readonly unit: 'days' | 'weeks';
  /** The window ended before the streak did: display "57+". */
  readonly truncated: boolean;
}

export interface Rate {
  readonly done: number;
  readonly expected: number;
}

export interface WeekProgress {
  readonly done: number;
  readonly required: number;
}

/** Days counted by the success rate of a `days` habit. */
export const RATE_DAYS = 30;
/** Weeks counted by the success rate of a `weekly` habit. */
export const RATE_WEEKS = 4;

export const WEEKDAYS: readonly WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** The weekday code of a date. */
export function weekdayCode(day: LocalDateIso): WeekdayCode {
  return WEEKDAYS[isoWeekday(day) - 1];
}

/**
 * Whether the day's weekday is planned by the schedule. Only the weekday is looked at: `startOn`
 * is ignored (the caller treats `d < startOn` itself). A `weekly` habit has no fixed day, so it
 * answers `true` for every day for display purposes: do NOT use it to count the days of a weekly
 * habit (its weeks are counted against the target).
 */
export function isExpected(schedule: HabitSchedule, day: LocalDateIso): boolean {
  return schedule.kind === 'weekly' || schedule.days.includes(weekdayCode(day));
}

/** Checks of the week starting on `weekStart`, ignoring the days before the start date. */
function weekDone(
  weekStart: LocalDateIso,
  startOn: LocalDateIso,
  checked: ReadonlySet<LocalDateIso>,
): number {
  let done = 0;
  const start = parseLocalDate(startOn);
  let day = parseLocalDate(weekStart);
  for (let offset = 0; offset < 7; offset++, day = day.add(ONE_DAY)) {
    if (compare(day, start) >= 0 && checked.has(formatLocalDate(day))) done++;
  }
  return done;
}

/** Checks needed in the week: the target, less in the week of creation (min(N, days left)). */
function weekRequired(target: number, weekStart: LocalDateIso, startOn: LocalDateIso): number {
  if (startOfIsoWeek(startOn) !== weekStart) return target;
  return Math.min(target, daysBetween(startOn, addDays(weekStart, 6)) + 1);
}

/**
 * Current streak. Today unchecked does not break it (still pending). `windowStart` is the first
 * day of the loaded checks: a streak that reaches it without reaching the start date is truncated.
 */
export function currentStreak(
  habit: HabitPlan,
  checked: ReadonlySet<LocalDateIso>,
  today: LocalDateIso,
  windowStart: LocalDateIso,
): Streak {
  const { schedule, startOn } = habit;
  const windowCutsHistory = compareLocalDates(startOn, windowStart) < 0;
  if (schedule.kind === 'days') {
    const planned = plannedWeekdays(schedule);
    const first = parseLocalDate(startOn);
    const window = parseLocalDate(windowStart);
    const last = parseLocalDate(today);
    let count = 0;
    // Dates stay Temporal values; they are formatted only to look a day up in `checked`.
    for (let day = last; ; day = day.subtract(ONE_DAY)) {
      if (compare(day, first) < 0) return { count, unit: 'days', truncated: false };
      if (compare(day, window) < 0) return { count, unit: 'days', truncated: true };
      if (!planned[day.dayOfWeek]) continue;
      if (checked.has(formatLocalDate(day))) count++;
      else if (compare(day, last) !== 0) return { count, unit: 'days', truncated: false };
    }
  }
  const currentWeek = startOfIsoWeek(today);
  const firstWeek = startOfIsoWeek(startOn);
  let count = 0;
  for (let week = currentWeek; ; week = addDays(week, -7)) {
    if (compareLocalDates(week, windowStart) < 0 && windowCutsHistory) {
      return { count, unit: 'weeks', truncated: true };
    }
    const reached =
      weekDone(week, startOn, checked) >= weekRequired(schedule.target, week, startOn);
    if (reached) count++;
    else if (week !== currentWeek) return { count, unit: 'weeks', truncated: false };
    if (compareLocalDates(week, firstWeek) <= 0) return { count, unit: 'weeks', truncated: false };
  }
}

/**
 * Success over the last 30 days (`days`: planned days of [max(start, today - 29), today], today
 * left out while unchecked) or the last 4 weeks (`weekly`: weeks that touch [start, today], the
 * current one only once reached).
 */
export function successRate(
  habit: HabitPlan,
  checked: ReadonlySet<LocalDateIso>,
  today: LocalDateIso,
): Rate {
  const { schedule, startOn } = habit;
  let done = 0;
  let expected = 0;
  if (schedule.kind === 'days') {
    const earliest = addDays(today, -(RATE_DAYS - 1));
    const first = compareLocalDates(startOn, earliest) > 0 ? startOn : earliest;
    const planned = plannedWeekdays(schedule);
    const last = parseLocalDate(today);
    for (let day = parseLocalDate(first); compare(day, last) <= 0; day = day.add(ONE_DAY)) {
      if (!planned[day.dayOfWeek]) continue;
      const isChecked = checked.has(formatLocalDate(day));
      if (compare(day, last) === 0 && !isChecked) continue;
      expected++;
      if (isChecked) done++;
    }
    return { done, expected };
  }
  const currentWeek = startOfIsoWeek(today);
  for (let back = RATE_WEEKS - 1; back >= 0; back--) {
    const week = addDays(currentWeek, -7 * back);
    if (compareLocalDates(addDays(week, 6), startOn) < 0) continue;
    const reached =
      weekDone(week, startOn, checked) >= weekRequired(schedule.target, week, startOn);
    if (week === currentWeek && !reached) continue;
    expected++;
    if (reached) done++;
  }
  return { done, expected };
}

/** Rounded percentage, or null when nothing was expected ("—"). */
export function ratePercent(rate: Rate): number | null {
  return rate.expected === 0 ? null : Math.round((100 * rate.done) / rate.expected);
}

/** Progress of the current week of a `weekly` habit; null for other habits. */
export function weekProgress(
  habit: HabitPlan,
  checked: ReadonlySet<LocalDateIso>,
  today: LocalDateIso,
): WeekProgress | null {
  const { schedule, startOn } = habit;
  if (schedule.kind !== 'weekly') return null;
  const week = startOfIsoWeek(today);
  return {
    done: weekDone(week, startOn, checked),
    required: weekRequired(schedule.target, week, startOn),
  };
}
