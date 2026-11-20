import { defineWidget } from '../../core/widgets';
import {
  REMINDERS_CONFIG_VERSION,
  RemindersConfig,
  remindersConfigSchema,
  remindersDefaults,
} from './reminders.config';

export const remindersWidget = defineWidget<RemindersConfig>({
  type: 'reminders',
  titleKey: 'widgets.reminders.title',
  descriptionKey: 'widgets.reminders.description',
  icon: 'pi pi-bell',
  loadComponent: () => import('./reminders.component').then((m) => m.RemindersComponent),
  size: { min: { w: 3, h: 3 }, default: { w: 4, h: 5 }, max: { w: 8, h: 8 } },
  config: {
    version: REMINDERS_CONFIG_VERSION,
    schema: remindersConfigSchema,
    defaults: remindersDefaults,
    migrations: {},
  },
  // Documentation only: notifications come from the Rust scheduler (ADR-001 amendment).
  permissions: ['notifications'],
  loadCalendarSource: () =>
    import('./reminders.calendar-source').then((m) => m.RemindersCalendarSource),
});
