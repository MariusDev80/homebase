import * as v from 'valibot';
import { WIDGET_TYPE_ID_PATTERN } from '../../core/widgets';

export const CALENDAR_AGENDA_DAYS = [7, 14, 31] as const;
export type CalendarAgendaDays = (typeof CALENDAR_AGENDA_DAYS)[number];
export type CalendarViewKind = 'agenda' | 'month';
export const CALENDAR_MAX_HIDDEN_SOURCES = 16;

/**
 * The navigation anchor is not stored: the widget always reopens on today.
 * `hiddenSources` (v2, O13) lists the widget types whose events are not shown; empty = all shown.
 */
export const calendarConfigSchema = v.object({
  view: v.picklist(['agenda', 'month']),
  agendaDays: v.picklist(CALENDAR_AGENDA_DAYS),
  hiddenSources: v.pipe(
    v.array(v.pipe(v.string(), v.regex(WIDGET_TYPE_ID_PATTERN))),
    v.maxLength(CALENDAR_MAX_HIDDEN_SOURCES),
  ),
});
export type CalendarConfig = v.InferOutput<typeof calendarConfigSchema>;
export const CALENDAR_CONFIG_VERSION = 2;
export const calendarDefaults = (): CalendarConfig => ({
  view: 'agenda',
  agendaDays: 14,
  hiddenSources: [],
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** v1 -> v2: nothing is hidden. Anything but a plain object is left as is: the schema refuses it. */
export const calendarMigrations = {
  1: (previous: unknown): unknown =>
    isPlainObject(previous) ? { ...previous, hiddenSources: [] } : previous,
} as const;
