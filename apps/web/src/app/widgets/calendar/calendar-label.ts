import type { CalendarEvent } from '../../core/calendar';
import { toLocalDate } from '../../core/time';
import type { DateStyle, InstantStyle } from '../../core/time';
import type { InstantIso, LocalDateIso, TimeZoneId } from '../../data';

export interface CalendarLabelFormat {
  /** HH:MM of an instant in the display zone. */
  readonly time: (instant: InstantIso) => string;
  readonly allDay: () => string;
}

/** The hour column: "09:00" for a timed event, "Journée" for an all-day one. */
export function timeLabel(event: CalendarEvent, format: CalendarLabelFormat): string {
  return event.time.kind === 'timed' ? format.time(event.time.start) : format.allDay();
}

/** What the accessible name needs from `TimeDisplay`. */
export interface CalendarLabelDisplay {
  formatLocalDate(date: LocalDateIso, style: DateStyle): string;
  formatInstant(instant: InstantIso, style: InstantStyle, timeZone?: TimeZoneId): string;
}

export type CalendarTranslate = (key: string, params?: Record<string, unknown>) => string;

const KNOWN_SOURCES: readonly string[] = ['reminders', 'todo'];

/** Translated name of the source of an event (known types), else the title of its widget. */
export function sourceLabel(
  event: CalendarEvent,
  t: CalendarTranslate,
  widgetTitleKey: string | undefined,
): string {
  if (KNOWN_SOURCES.includes(event.sourceType)) {
    return t(`widgets.calendar.source.${event.sourceType}`);
  }
  return widgetTitleKey === undefined ? event.sourceType : t(widgetTitleKey);
}

/** "mercredi 18 novembre 2026", or "Du ... au ..." for an all-day event over several days. */
export function eventDateText(
  event: CalendarEvent,
  display: CalendarLabelDisplay,
  displayZone: TimeZoneId,
  t: CalendarTranslate,
  inline = false,
): string {
  const time = event.time;
  if (time.kind === 'timed') {
    return display.formatLocalDate(toLocalDate(time.start, displayZone), 'weekday-long');
  }
  if (time.startOn === time.lastOn) return display.formatLocalDate(time.startOn, 'weekday-long');
  return t(inline ? 'widgets.calendar.rangeInline' : 'widgets.calendar.range', {
    from: display.formatLocalDate(time.startOn, 'long'),
    to: display.formatLocalDate(time.lastOn, 'long'),
  });
}

/**
 * Accessible name of an event: "Rappel : Payer le loyer, mercredi 18 novembre 2026, 09:00"; all-day
 * events end with "toute la journée", overdue tasks with "en retard" (spec calendar 4.8).
 */
export function eventName(
  event: CalendarEvent,
  display: CalendarLabelDisplay,
  displayZone: TimeZoneId,
  t: CalendarTranslate,
  widgetTitleKey?: string,
): string {
  const time =
    event.time.kind === 'timed'
      ? display.formatInstant(event.time.start, 'time')
      : t('widgets.calendar.allDayLong');
  const name = t('widgets.calendar.eventName', {
    source: sourceLabel(event, t, widgetTitleKey),
    title: event.title,
    date: eventDateText(event, display, displayZone, t, true),
    time,
  });
  return event.tone === 'danger' ? t('widgets.calendar.eventNameOverdue', { name }) : name;
}
