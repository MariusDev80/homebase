/**
 * PROVISIONAL: ADR-003 / ADR-004 freeze this contract before any use (phase 2).
 * No consumer in phase 0.
 */
export interface CalendarRange {
  /** ISO 8601 UTC, range is [start, end). */
  readonly startUtc: string;
  readonly endUtc: string;
}

export interface CalendarEvent {
  readonly id: string;
  readonly sourceType: string;
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string | null;
  readonly allDay: boolean;
  /** IANA time zone. */
  readonly timeZone: string;
}

export interface CalendarSource {
  listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]>;
}
