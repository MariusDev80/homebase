import { defineWidget } from '../../core/widgets';
import {
  HABITS_CONFIG_VERSION,
  HabitsConfig,
  habitsConfigSchema,
  habitsDefaults,
} from './habits.config';

export const habitsWidget = defineWidget<HabitsConfig>({
  type: 'habits',
  titleKey: 'widgets.habits.title',
  descriptionKey: 'widgets.habits.description',
  icon: 'pi pi-check-square',
  loadComponent: () => import('./habits.component').then((m) => m.HabitsComponent),
  loadCalendarSource: () => import('./habits.calendar-source').then((m) => m.HabitsCalendarSource),
  size: { min: { w: 3, h: 3 }, default: { w: 4, h: 4 }, max: { w: 8, h: 8 } },
  config: {
    version: HABITS_CONFIG_VERSION,
    schema: habitsConfigSchema,
    defaults: habitsDefaults,
    migrations: {},
  },
  // Documentation only: notifications come from the Rust scheduler (ADR-001 amendment).
  permissions: ['notifications'],
});
