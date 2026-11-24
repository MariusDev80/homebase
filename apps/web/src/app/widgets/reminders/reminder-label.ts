import {
  addDays,
  daysBetween,
  parseRecurrenceRule,
  toLocalDate,
  zoneCity,
  type RecurrenceRule,
  type Weekday,
} from '../../core/time';
import type {
  InstantIso,
  LocalDateIso,
  LocalDateTimeIso,
  ReminderDelivery,
  TimeZoneId,
} from '../../data';
import { nthWeekdayOf, weekdayOf } from './reminder-form';

// Pure display labels of the reminders widget (spec 4.8). Formatting of dates and translation
// come from the caller (TimeDisplay, Transloco): this file computes no date by hand.

export type LabelDateStyle = 'weekday-short' | 'day-month' | 'short' | 'weekday-day-month';

export interface LabelFormat {
  t(key: string, params?: Record<string, unknown>): string;
  /** `HH:MM` of an instant in a zone. */
  formatTime(instant: InstantIso, zone: TimeZoneId): string;
  /** "lun. 16", "16 nov.", "16 nov. 2026" or "lun. 16 nov.". */
  formatDate(date: LocalDateIso, style: LabelDateStyle): string;
}

export { zoneCity };

const P = 'widgets.reminders.';
/** Beyond this many days from today, an occurrence shows its month. */
const WEEKDAY_ONLY_DAYS = 6;

/** "(09:00 Paris)": the nominal time of a reminder whose zone differs from the user's. */
export function zoneSuffix(
  key: LocalDateTimeIso | null,
  reminderZone: TimeZoneId,
  userZone: TimeZoneId,
): string {
  if (key === null || reminderZone === userZone) return '';
  return `(${key.slice(11, 16)} ${zoneCity(reminderZone)})`;
}

/**
 * Label of the next occurrence in the user zone: "Aujourd'hui 09:00", "Demain 09:00", "lun. 16
 * 09:00" within a week, "16 nov. 09:00" beyond.
 */
export function upcomingLabel(
  nextFireAt: InstantIso,
  nextFireKey: LocalDateTimeIso | null,
  reminderZone: TimeZoneId,
  now: InstantIso,
  userZone: TimeZoneId,
  fmt: LabelFormat,
): string {
  const date = toLocalDate(nextFireAt, userZone);
  const today = toLocalDate(now, userZone);
  const time = fmt.formatTime(nextFireAt, userZone);
  let day: string;
  if (date === today) day = fmt.t('time.today');
  else if (date === addDays(today, 1)) day = fmt.t('time.tomorrow');
  else if (daysBetween(today, date) <= WEEKDAY_ONLY_DAYS)
    day = fmt.formatDate(date, 'weekday-short');
  else day = fmt.formatDate(date, 'day-month');
  const suffix = zoneSuffix(nextFireKey, reminderZone, userZone);
  return `${day} ${time}${suffix === '' ? '' : ` ${suffix}`}`;
}

/** Label of a delivery: "09:00" today, otherwise "lun. 16 nov., 09:00"; "manqué · …" when missed. */
export function deliveryLabel(
  delivery: ReminderDelivery,
  now: InstantIso,
  userZone: TimeZoneId,
  fmt: LabelFormat,
): string {
  const date = toLocalDate(delivery.dueAt, userZone);
  const time = fmt.formatTime(delivery.dueAt, userZone);
  const withDay = fmt.t(P + 'dayAtTime', {
    date: fmt.formatDate(date, 'weekday-day-month'),
    time,
  });
  const when =
    delivery.outcome === 'on_time' && date === toLocalDate(now, userZone) ? time : withDay;
  const suffix = zoneSuffix(delivery.occurrenceKey, delivery.timeZone, userZone);
  const text = suffix === '' ? when : `${when} ${suffix}`;
  return delivery.outcome === 'missed'
    ? fmt.t(P + 'missedAt', { missed: fmt.t(P + 'missed'), text })
    : text;
}

function weekdayName(day: Weekday, fmt: LabelFormat): string {
  return fmt.t(`${P}weekdays.${day}`);
}

function joinList(items: readonly string[], fmt: LabelFormat): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${fmt.t(P + 'and')} ${items[items.length - 1]}`;
}

function endSuffix(rule: RecurrenceRule, timeZone: TimeZoneId, fmt: LabelFormat): string {
  if (rule.end.kind === 'count') return fmt.t(P + 'label.count', { count: rule.end.count });
  if (rule.end.kind !== 'until-instant') return '';
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(rule.end.until);
  if (m === null) return '';
  // UNTIL is the last second of a local day: read that day in the reminder zone.
  const date = toLocalDate(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`, timeZone);
  return fmt.t(P + 'label.until', { date: fmt.formatDate(date, 'short') });
}

function monthlyLabel(
  rule: RecurrenceRule,
  date: LocalDateIso,
  time: string,
  fmt: LabelFormat,
): string {
  const n = rule.interval;
  const every = n === 1 ? '' : 'Every';
  if (rule.byMonthDay === -1) return fmt.t(`${P}label.monthlyLast${every}`, { n, time });
  if (rule.byNthWeekday !== null) {
    const nth = rule.byNthWeekday;
    return fmt.t(`${P}label.monthlyNth${every}`, {
      nth: fmt.t(`${P}nth.${nth.n === -1 ? 'last' : nth.n}`),
      weekday: weekdayName(nth.weekday, fmt),
      n,
      time,
    });
  }
  const day = rule.byMonthDay ?? Number(date.slice(8, 10));
  return fmt.t(`${P}label.monthlyDay${every}`, {
    day: day === 1 ? fmt.t(`${P}nth.1`) : day,
    n,
    time,
  });
}

/**
 * Readable summary of a recurrence in French: "Tous les jours à 09:00", "Chaque lundi et mercredi
 * à 09:00", "Le dernier vendredi du mois à 09:00". A rule outside the supported subset gives the
 * "Règle personnalisée" label.
 */
export function recurrenceLabel(
  rrule: string | null,
  startLocal: LocalDateTimeIso,
  timeZone: TimeZoneId,
  fmt: LabelFormat,
): string {
  const time = startLocal.slice(11, 16);
  const date = startLocal.slice(0, 10);
  if (rrule === null) return fmt.t(P + 'label.once', { time });
  const parsed = parseRecurrenceRule(rrule, 'date-time');
  if (!parsed.ok) return fmt.t(P + 'label.custom');
  const { rule } = parsed;
  const n = rule.interval;
  let main: string;
  switch (rule.freq) {
    case 'DAILY':
      main =
        n === 1 ? fmt.t(P + 'label.daily', { time }) : fmt.t(P + 'label.dailyEvery', { n, time });
      break;
    case 'WEEKLY': {
      const days = rule.byDay.length > 0 ? rule.byDay : [weekdayOf(date)];
      const list = joinList(
        days.map((d) => weekdayName(d, fmt)),
        fmt,
      );
      main =
        n === 1
          ? fmt.t(P + 'label.weekly', { days: list, time })
          : fmt.t(P + 'label.weeklyEvery', { n, days: list, time });
      break;
    }
    case 'MONTHLY':
      main = monthlyLabel(rule, date, time, fmt);
      break;
    case 'YEARLY': {
      const day = fmt.formatDate(date, 'day-month');
      main =
        n === 1
          ? fmt.t(P + 'label.yearly', { date: day, time })
          : fmt.t(P + 'label.yearlyEvery', { n, date: day, time });
      break;
    }
  }
  const end = endSuffix(rule, timeZone, fmt);
  return end === '' ? main : `${main}${end}`;
}

/** Which "n-th weekday" a date is (used by the form labels). */
export function nthLabel(date: LocalDateIso, fmt: LabelFormat): { nth: string; weekday: string } {
  const { n, weekday } = nthWeekdayOf(date);
  return { nth: fmt.t(`${P}nth.${n === -1 ? 'last' : n}`), weekday: weekdayName(weekday, fmt) };
}
