import type { LocalDateIso } from '../../data';
import { TimeError } from './time-error';
import { formatLocalDate, parseLocalDate } from './time-format';

// Kept apart from local-date.ts on purpose: only the lazy calendar code uses these, so the bundler
// does not pull them into the initial chunk with addDays.
/** The first day of the month that contains `date`. */
export function startOfMonth(date: LocalDateIso): LocalDateIso {
  return formatLocalDate(parseLocalDate(date).with({ day: 1 }));
}

/** `date` + `months` calendar months; the day is clamped to the end of a shorter month. */
export function addMonths(date: LocalDateIso, months: number): LocalDateIso {
  if (!Number.isSafeInteger(months)) {
    throw new TimeError('out_of_range', 'Month count must be an integer', {
      value: String(months),
    });
  }
  const result = formatLocalDate(parseLocalDate(date).add({ months }, { overflow: 'constrain' }));
  // Validates the range: parseLocalDate throws if the result is outside the supported dates.
  parseLocalDate(result);
  return result;
}
