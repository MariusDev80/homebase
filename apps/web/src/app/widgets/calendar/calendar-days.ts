import type { CalendarEvent } from '../../core/calendar';
import type { LocalDateIso, TimeZoneId } from '../../data';
import { addDays, compareLocalDates, daysBetween, toLocalDate } from '../../core/time';

export interface DayGroup {
  readonly day: LocalDateIso;
  readonly events: readonly CalendarEvent[];
}

/**
 * One group per day (ascending) that has at least one event within [firstOn, lastOn]. A `timed`
 * event belongs to the day of its start in `timeZone`; an `all-day` event to each of its days.
 * The order of `events` (the aggregator's) is kept inside a day.
 */
export function groupByDay(
  events: readonly CalendarEvent[],
  firstOn: LocalDateIso,
  lastOn: LocalDateIso,
  timeZone: TimeZoneId,
): DayGroup[] {
  const byDay = new Map<LocalDateIso, CalendarEvent[]>();
  const add = (day: LocalDateIso, event: CalendarEvent): void => {
    const list = byDay.get(day);
    if (list) list.push(event);
    else byDay.set(day, [event]);
  };
  for (const event of events) {
    const time = event.time;
    if (time.kind === 'timed') {
      const day = toLocalDate(time.start, timeZone);
      if (compareLocalDates(day, firstOn) >= 0 && compareLocalDates(day, lastOn) <= 0) {
        add(day, event);
      }
      continue;
    }
    const start = compareLocalDates(time.startOn, firstOn) < 0 ? firstOn : time.startOn;
    const end = compareLocalDates(time.lastOn, lastOn) > 0 ? lastOn : time.lastOn;
    const count = daysBetween(start, end) + 1;
    for (let index = 0; index < count; index++) add(addDays(start, index), event);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => compareLocalDates(a, b))
    .map(([day, list]) => ({ day, events: list }));
}

/** Adds an empty group for `today` when the range contains it and it has no event (L14). */
export function withToday(
  groups: readonly DayGroup[],
  today: LocalDateIso,
  firstOn: LocalDateIso,
  lastOn: LocalDateIso,
): DayGroup[] {
  const inRange = compareLocalDates(today, firstOn) >= 0 && compareLocalDates(today, lastOn) <= 0;
  if (!inRange || groups.some((group) => group.day === today)) return [...groups];
  const next = [...groups, { day: today, events: [] }];
  return next.sort((a, b) => compareLocalDates(a.day, b.day));
}
