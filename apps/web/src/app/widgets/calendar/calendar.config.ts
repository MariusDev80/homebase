import * as v from 'valibot';

export const CALENDAR_AGENDA_DAYS = [7, 14, 31] as const;
export type CalendarAgendaDays = (typeof CALENDAR_AGENDA_DAYS)[number];
export type CalendarViewKind = 'agenda' | 'month';

/** The navigation anchor is not stored: the widget always reopens on today. */
export const calendarConfigSchema = v.object({
  view: v.picklist(['agenda', 'month']),
  agendaDays: v.picklist(CALENDAR_AGENDA_DAYS),
});
export type CalendarConfig = v.InferOutput<typeof calendarConfigSchema>;
export const CALENDAR_CONFIG_VERSION = 1;
export const calendarDefaults = (): CalendarConfig => ({ view: 'agenda', agendaDays: 14 });
