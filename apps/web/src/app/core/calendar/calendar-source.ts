import type { InstantIso, LocalDateIso, TimeZoneId } from '../../data';

// Temporal part frozen by ADR-003 section 3.7. The other fields of CalendarEvent (colour, link,
// editability) belong to ADR-004 and will be added without changing these.

/** Range [from, to); to - from <= 400 days. timeZone = display (user) zone, used to place
 *  all-day events. */
export interface CalendarRange {
  readonly from: InstantIso;
  readonly to: InstantIso;
  readonly timeZone: TimeZoneId;
}

export type CalendarEventTime =
  | {
      readonly kind: 'timed';
      readonly start: InstantIso;
      readonly end: InstantIso | null;
      readonly timeZone: TimeZoneId;
    }
  /** lastOn is inclusive (>= startOn); the calendar library adapter converts to an exclusive end. */
  | { readonly kind: 'all-day'; readonly startOn: LocalDateIso; readonly lastOn: LocalDateIso };

export interface CalendarEvent {
  /** `${sourceType}:${sourceId}:${occurrenceKey ?? ''}`: stable between two calls. */
  readonly id: string;
  readonly sourceType: string;
  readonly sourceId: string;
  /** Occurrence key (ADR-003 3.5.4) or null for a non-recurring item. */
  readonly occurrenceKey: string | null;
  /** User data: rendered by interpolation, never innerHTML. */
  readonly title: string;
  readonly time: CalendarEventTime;
}

export interface CalendarSource {
  /** Rejects with DataError; only returns events that overlap the range. */
  listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]>;
}
