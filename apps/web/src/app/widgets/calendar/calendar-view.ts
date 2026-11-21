import type { CalendarRange } from '../../core/calendar';
import type { LocalDateIso, TimeZoneId } from '../../data';
import {
  addDays,
  addMonths,
  startOfDay,
  startOfIsoWeek,
  startOfMonth,
  type DateStyle,
} from '../../core/time';
import type { CalendarViewKind } from './calendar.config';

/** A month is shown as 6 full ISO weeks. */
const MONTH_GRID_DAYS = 42;

export interface DayRange {
  readonly firstOn: LocalDateIso;
  readonly lastOn: LocalDateIso;
}

/** Month: the 6 weeks around the month of `anchor`. Agenda: `anchor` and the next days. */
export function visibleDays(
  view: CalendarViewKind,
  anchor: LocalDateIso,
  agendaDays: number,
): DayRange {
  if (view === 'month') {
    const firstOn = startOfIsoWeek(startOfMonth(anchor));
    return { firstOn, lastOn: addDays(firstOn, MONTH_GRID_DAYS - 1) };
  }
  return { firstOn: anchor, lastOn: addDays(anchor, agendaDays - 1) };
}

/** [start of the first day, start of the day after the last day) in the display zone. */
export function visibleRange(days: DayRange, timeZone: TimeZoneId): CalendarRange {
  return {
    from: startOfDay(days.firstOn, timeZone),
    to: startOfDay(addDays(days.lastOn, 1), timeZone),
    timeZone,
  };
}

/** Previous (-1) or next (1) month, or block of `agendaDays` days. */
export function navigate(
  view: CalendarViewKind,
  anchor: LocalDateIso,
  agendaDays: number,
  direction: -1 | 1,
): LocalDateIso {
  return view === 'month'
    ? addMonths(startOfMonth(anchor), direction)
    : addDays(anchor, direction * agendaDays);
}

/** "novembre 2026" for the month, "18 nov. - 1 déc." for the Agenda. */
export function viewTitle(
  view: CalendarViewKind,
  anchor: LocalDateIso,
  agendaDays: number,
  format: (date: LocalDateIso, style: DateStyle) => string,
): string {
  if (view === 'month') return format(startOfMonth(anchor), 'month-year');
  const { firstOn, lastOn } = visibleDays(view, anchor, agendaDays);
  return `${format(firstOn, 'day-month')} \u2013 ${format(lastOn, 'day-month')}`;
}
