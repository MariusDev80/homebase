import { WEEKDAYS } from '../../core/habits';
import type { Streak, WeekProgress } from '../../core/habits';
import { zoneCity } from '../../core/time';
import type { HabitReminder, HabitSchedule, LocalDateIso, TimeZoneId } from '../../data';

// Pure display labels of the habits widget (spec habits 4.7). Translation and date formatting come
// from the caller (Transloco, TimeDisplay): this file computes no date and holds no separator.

export interface HabitLabelFormat {
  t(key: string, params?: Record<string, unknown>): string;
  /** Long form with the weekday: "mardi 17 novembre 2026". */
  formatLongDate(date: LocalDateIso): string;
}

const P = 'widgets.habits.';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Two texts joined by the language's list separator (i18n key, never a literal). */
function join(fmt: HabitLabelFormat, a: string, b: string): string {
  return fmt.t(P + 'join', { a, b });
}

/** "Tous les jours", "Lun, mer, ven" or "3 fois par semaine". */
export function scheduleLabel(schedule: HabitSchedule, fmt: HabitLabelFormat): string {
  if (schedule.kind === 'weekly') return fmt.t(P + 'timesPerWeek', { count: schedule.target });
  const days = WEEKDAYS.filter((d) => schedule.days.includes(d));
  if (days.length === WEEKDAYS.length) return fmt.t(P + 'everyDay');
  const names = days.map((d) => fmt.t(`${P}weekdaysAbbr.${d}`));
  return capitalize(names.reduce((all, name) => join(fmt, all, name)));
}

/**
 * "Rappel à 07:30" (or "Rappel désactivé (07:30)"), with the city when the reminder zone is not
 * the user's. Only the time is shown, never the next occurrence (it can be stale, spec PV5).
 */
export function reminderLabel(
  reminder: Pick<HabitReminder, 'time' | 'timeZone' | 'enabled'>,
  userZone: TimeZoneId,
  fmt: HabitLabelFormat,
): string {
  const text = fmt.t(P + (reminder.enabled ? 'reminderAt' : 'reminderOff'), {
    time: reminder.time,
  });
  return reminder.timeZone === userZone
    ? text
    : fmt.t(P + 'reminderZone', { text, zone: zoneCity(reminder.timeZone) });
}

export interface CellFacts {
  readonly expected: boolean;
  readonly today: boolean;
  /** The day is before the start date: the cell is disabled. */
  readonly beforeStart: boolean;
}

/** Accessible name of a cell: "<title>, <long date>" + today / not planned / before start. */
export function cellLabel(
  title: string,
  day: LocalDateIso,
  facts: CellFacts,
  fmt: HabitLabelFormat,
): string {
  let label = join(fmt, title, fmt.formatLongDate(day));
  if (facts.today) label = join(fmt, label, fmt.t(P + 'todayFlag'));
  if (!facts.expected) label = join(fmt, label, fmt.t(P + 'notExpected'));
  if (facts.beforeStart) label = join(fmt, label, fmt.t(P + 'beforeStart'));
  return label;
}

/** Visible "Série : 12" ("12+" when truncated) and its screen-reader text. */
export function streakTexts(
  streak: Streak,
  fmt: HabitLabelFormat,
): { readonly text: string; readonly sr: string } {
  const count = `${streak.count}${streak.truncated ? '+' : ''}`;
  const srKey = streak.unit === 'days' ? 'streakDaysSr' : 'streakWeeksSr';
  return {
    text: fmt.t(P + 'streak', { count }),
    sr: fmt.t(P + srKey, { count }),
  };
}

/** "1/3 cette semaine". */
export function weekProgressLabel(progress: WeekProgress, fmt: HabitLabelFormat): string {
  return fmt.t(P + 'weekProgress', { done: progress.done, required: progress.required });
}
