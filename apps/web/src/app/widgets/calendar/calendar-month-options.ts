import type { CalendarOptions, EventClickInfo, EventInput, MoreLinkHandler } from 'fullcalendar';
import type { CalendarEvent, CalendarTone } from '../../core/calendar';
import type { InstantIso, LocalDateIso, TimeZoneId } from '../../data';
import { addDays } from '../../core/time';

/**
 * Month event colours: the classes validated with the spike (token classes only). Kept apart from
 * TONE_CLASS (text colour of the Agenda icon): here the event gets a tinted background.
 */
export const MONTH_TONE_CLASS: Readonly<Record<CalendarTone, string>> = {
  neutral: 'bg-canvas-subtle text-fg border-default',
  accent: 'bg-accent-subtle text-fg border-accent',
  success: 'bg-success-subtle text-fg border-success',
  attention: 'bg-attention-subtle text-fg border-attention',
  danger: 'bg-danger-subtle text-fg border-danger',
};

/** Our own class on the "+N" link, used to catch it before the library (spec T2). */
export const MORE_LINK_CLASS = 'hb-fc-more';

/** Pure conversion. Never `url`, never HTML: the library renders `title` as text. */
export function toEventInputs(events: readonly CalendarEvent[]): EventInput[] {
  return events.map((event, index): EventInput => {
    const base = {
      id: event.id,
      title: event.title,
      className:
        event.status === 'projected'
          ? `${MONTH_TONE_CLASS[event.tone]} border-dashed`
          : MONTH_TONE_CLASS[event.tone],
      // Position in the aggregator order, applied by eventOrder: 'rank' (spec O8).
      rank: index,
    };
    if (event.time.kind === 'timed') {
      // No `end`: with defaultTimedEventDuration 0 a 23:30 event does not spill over (L22).
      return { ...base, start: event.time.start, allDay: false };
    }
    return {
      ...base,
      start: event.time.startOn,
      end: addDays(event.time.lastOn, 1),
      allDay: true,
    };
  });
}

/** The argument of moreLinkClick (the exported MoreLinkInfo is the render-hook one). */
export type MoreLinkClickInfo = Parameters<MoreLinkHandler>[0];

export interface MonthOptionsParams {
  /** First day of the displayed month (YYYY-MM-01). */
  readonly monthStart: LocalDateIso;
  readonly timeZone: TimeZoneId;
  readonly nowIso: InstantIso;
  readonly maxEventsPerDay: number | true;
  readonly events: readonly CalendarEvent[];
  readonly moreHint: (count: number) => string;
  /** The "+N" link: the host opens its Day panel (no library popover). */
  readonly onMoreLink: (info: MoreLinkClickInfo) => void;
  readonly onEventClick: (info: EventClickInfo) => void;
  /** Accessible name of an event (spec calendar 4.8); null when the event is unknown. */
  readonly eventName: (eventId: string) => string | null;
}

/** Month options (spec calendar T3), without the plugins and the locale (set by the adapter). */
export function buildMonthOptions(params: MonthOptionsParams): CalendarOptions {
  return {
    initialView: 'dayGridMonth',
    initialDate: params.monthStart,
    timeZone: params.timeZone,
    firstDay: 1,
    fixedWeekCount: true,
    headerToolbar: false,
    height: '100%',
    navLinks: false,
    dayMaxEvents: params.maxEventsPerDay,
    moreLinkClick: (info) => {
      params.onMoreLink(info);
    },
    moreLinkHint: (count) => params.moreHint(count),
    // Test sentinel only: no element with this class may ever exist (the popover never opens).
    popoverClass: 'hb-fc-popover',
    eventInteractive: true,
    eventClick: (info) => {
      info.jsEvent.preventDefault();
      params.onEventClick(info);
    },
    eventDidMount: ({ event, el }) => {
      // Lets the host find the element again after a reload remounted it (focus return).
      el.dataset['eventId'] = event.id;
      const name = params.eventName(event.id);
      if (name !== null) el.setAttribute('aria-label', name);
    },
    eventOrder: 'rank',
    eventOrderStrict: true,
    defaultTimedEventDuration: { minutes: 0 },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false },
    now: params.nowIso,
    events: toEventInputs(params.events),
    eventClass: 'border-s-4',
    dayHeaderClass: 'text-fg-muted text-xs border-b border-muted py-1',
    dayCellClass: (info) =>
      `border-b border-e border-muted ${info.isToday ? 'bg-accent-subtle' : ''} ${info.isOther ? 'text-fg-muted' : ''}`,
    moreLinkClass: `${MORE_LINK_CLASS} text-accent text-xs`,
  };
}
