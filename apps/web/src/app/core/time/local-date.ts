import type { LocalDateIso } from '../../data';
import { Temporal } from './temporal';
import { TimeError } from './time-error';
import { formatLocalDate, parseLocalDate } from './time-format';

export function compareLocalDates(a: LocalDateIso, b: LocalDateIso): -1 | 0 | 1 {
  return Temporal.PlainDate.compare(parseLocalDate(a), parseLocalDate(b)) as -1 | 0 | 1;
}

/** The result is re-validated: it must stay within 1900-01-01..2199-12-31. */
export function addDays(date: LocalDateIso, days: number): LocalDateIso {
  if (!Number.isSafeInteger(days)) {
    throw new TimeError('out_of_range', 'Day count must be an integer', { value: String(days) });
  }
  const result = formatLocalDate(parseLocalDate(date).add({ days }));
  parseLocalDate(result);
  return result;
}

/** `to - from`, in calendar days (negative when `to` is earlier). */
export function daysBetween(from: LocalDateIso, to: LocalDateIso): number {
  return parseLocalDate(from).until(parseLocalDate(to), { largestUnit: 'days' }).days;
}

/** ISO weekday of a date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: LocalDateIso): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return parseLocalDate(date).dayOfWeek as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** The Monday of the ISO week that contains `date`. */
export function startOfIsoWeek(date: LocalDateIso): LocalDateIso {
  return addDays(date, 1 - isoWeekday(date));
}
