import { defineWidget } from '../../core/widgets';
import {
  TIMERS_CONFIG_VERSION,
  TimersConfig,
  timersConfigSchema,
  timersDefaults,
} from './timers.config';

export const timersWidget = defineWidget<TimersConfig>({
  type: 'timers',
  titleKey: 'widgets.timers.title',
  descriptionKey: 'widgets.timers.description',
  icon: 'pi pi-stopwatch',
  loadComponent: () => import('./timers.component').then((m) => m.TimersComponent),
  size: { min: { w: 3, h: 3 }, default: { w: 4, h: 4 }, max: { w: 6, h: 8 } },
  config: {
    version: TIMERS_CONFIG_VERSION,
    schema: timersConfigSchema,
    defaults: timersDefaults,
    migrations: {},
  },
  // Documentation only: notifications come from the Rust scheduler (ADR-001 amendment).
  permissions: ['notifications'],
});
