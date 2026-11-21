import { DataError, type LocalDateIso } from '../../data';
import {
  addDuration,
  daysBetween,
  durationBetween,
  isValidInstant,
  isValidTimeZone,
  toLocalDate,
} from '../time';
import type { CalendarRange } from './calendar-source';

export const MAX_CALENDAR_RANGE_DAYS = 62;

/**
 * Days whose [startOfDay(d), startOfDay(d + 1)) overlaps [from, to): the day that contains `from`
 * up to the day that contains the last instant before `to`. The range must be valid
 * (see assertCalendarRange), otherwise a TimeError is thrown.
 */
export function rangeLocalDates(range: CalendarRange): {
  readonly firstOn: LocalDateIso;
  readonly lastOn: LocalDateIso;
} {
  return {
    firstOn: toLocalDate(range.from, range.timeZone),
    lastOn: toLocalDate(addDuration(range.to, -1), range.timeZone),
  };
}

/** DataError('invalid_input') if from >= to, unknown zone, invalid instant, or more than 62 days. */
export function assertCalendarRange(range: CalendarRange): void {
  if (!isValidInstant(range.from) || !isValidInstant(range.to)) {
    throw new DataError('invalid_input', 'Calendar range bounds must be valid instants');
  }
  if (!isValidTimeZone(range.timeZone)) {
    throw new DataError('invalid_input', 'Calendar range has an unknown time zone');
  }
  if (durationBetween(range.from, range.to) <= 0) {
    throw new DataError('invalid_input', 'Calendar range must end after it starts');
  }
  const { firstOn, lastOn } = rangeLocalDates(range);
  if (daysBetween(firstOn, lastOn) + 1 > MAX_CALENDAR_RANGE_DAYS) {
    throw new DataError(
      'invalid_input',
      `Calendar range must not exceed ${MAX_CALENDAR_RANGE_DAYS} days`,
    );
  }
}
