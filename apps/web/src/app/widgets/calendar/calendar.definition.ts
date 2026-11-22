import { defineWidget } from '../../core/widgets';
import {
  CALENDAR_CONFIG_VERSION,
  CalendarConfig,
  calendarConfigSchema,
  calendarDefaults,
  calendarMigrations,
} from './calendar.config';

export const calendarWidget = defineWidget<CalendarConfig>({
  type: 'calendar',
  titleKey: 'widgets.calendar.title',
  descriptionKey: 'widgets.calendar.description',
  icon: 'pi pi-calendar',
  loadComponent: () => import('./calendar.component').then((m) => m.CalendarComponent),
  size: { min: { w: 3, h: 3 }, default: { w: 6, h: 5 }, max: { w: 12, h: 8 } },
  config: {
    version: CALENDAR_CONFIG_VERSION,
    schema: calendarConfigSchema,
    defaults: calendarDefaults,
    migrations: calendarMigrations,
  },
  permissions: [],
});
