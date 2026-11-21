import type { CalendarEvent } from '../../core/calendar';
import type { InstantIso } from '../../data';

export interface CalendarLabelFormat {
  /** HH:MM of an instant in the display zone. */
  readonly time: (instant: InstantIso) => string;
  readonly allDay: () => string;
}

/** The hour column: "09:00" for a timed event, "Journée" for an all-day one. */
export function timeLabel(event: CalendarEvent, format: CalendarLabelFormat): string {
  return event.time.kind === 'timed' ? format.time(event.time.start) : format.allDay();
}
