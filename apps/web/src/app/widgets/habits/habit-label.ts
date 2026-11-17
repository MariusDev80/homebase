import { WEEKDAYS } from '../../core/habits';
import type { Rate, Streak, WeekProgress } from '../../core/habits';
import { zoneCity } from '../../core/time';
import type { HabitReminder, HabitSchedule, LocalDateIso, TimeZoneId } from '../../data';

// Pure display labels of the habits widget (spec habits 4.7). Translation and date formatting come
// from the caller (Transloco, TimeDisplay): this file computes no date and holds no separator.

export interface HabitLabelFormat {
  t(key: string, params?: Record<string, unknown>): string;
  /** Long form with the weekday: "mardi 17 novembre 2026". */
  formatLongDate(date: LocalDateIso): string;
  /** Active language, for plural rules (default: French). */
  readonly lang?: string;
}

const P = 'widgets.habits.';

/** Plural form of a count in the active language: 'one' (0 and 1 in French) or 'other'. */
function pluralForm(count: number, fmt: HabitLabelFormat): 'one' | 'other' {
  return new Intl.PluralRules(fmt.lang ?? 'fr').select(count) === 'one' ? 'one' : 'other';
}

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
  const srKey = `${streak.unit === 'days' ? 'streakDaysSr' : 'streakWeeksSr'}_${pluralForm(streak.count, fmt)}`;
  return {
    text: fmt.t(P + 'streak', { count }),
    sr: fmt.t(P + srKey, { count }),
  };
}

/** "Série actuelle : 12 jours prévus d'affilée" (French plural: 0 and 1 are singular). */
export function historyStreakText(streak: Streak, fmt: HabitLabelFormat): string {
  const count = `${streak.count}${streak.truncated ? '+' : ''}`;
  if (streak.count === 0 && !streak.truncated) return fmt.t(P + 'historyStreakNone');
  const form = pluralForm(streak.count, fmt);
  const unit = streak.unit === 'days' ? 'historyStreakDays' : 'historyStreakWeeks';
  return fmt.t(`${P}${unit}_${form}`, { count });
}

/** "Réussite sur 30 jours : 86 % (6/7)", "Sur 4 semaines : 2/2" or the no-data text. */
export function rateText(
  unit: Streak['unit'],
  rate: Rate,
  percent: number | null,
  fmt: HabitLabelFormat,
): string {
  if (percent === null) return fmt.t(P + 'noRate');
  const params = { rate: percent, done: rate.done, expected: rate.expected };
  return fmt.t(P + (unit === 'days' ? 'rate30' : 'rate4w'), params);
}

/** "1/3 cette semaine". */
export function weekProgressLabel(progress: WeekProgress, fmt: HabitLabelFormat): string {
  return fmt.t(P + 'weekProgress', { done: progress.done, required: progress.required });
}
