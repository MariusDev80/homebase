import type { InstantIso, LocalDateIso, TimeZoneId } from '../../data';

// Temporal part frozen by ADR-003 section 3.7; `tone` added by ADR-004 section 3.2.1 (no link and
// no editability field in v1).

/** Closed set of semantic tones; the view maps each to --hb-* tokens (a tinted card redefines
 *  them). Never a raw colour: no hex, no user-chosen colour in v1. */
export type CalendarTone = 'neutral' | 'accent' | 'success' | 'attention' | 'danger';

export const CALENDAR_TONES: readonly CalendarTone[] = [
  'neutral',
  'accent',
  'success',
  'attention',
  'danger',
];

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
  readonly tone: CalendarTone;
}

export interface CalendarSource {
  /** Rejects with DataError; only returns events that overlap the range. */
  listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]>;
}
