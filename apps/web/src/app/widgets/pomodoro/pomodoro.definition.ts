import { defineWidget } from '../../core/widgets';
import {
  POMODORO_CONFIG_VERSION,
  PomodoroConfig,
  pomodoroConfigSchema,
  pomodoroDefaults,
} from './pomodoro.config';

export const pomodoroWidget = defineWidget<PomodoroConfig>({
  type: 'pomodoro',
  titleKey: 'widgets.pomodoro.title',
  descriptionKey: 'widgets.pomodoro.description',
  icon: 'pi pi-clock',
  loadComponent: () => import('./pomodoro.component').then((m) => m.PomodoroComponent),
  size: { min: { w: 3, h: 3 }, default: { w: 3, h: 4 }, max: { w: 6, h: 6 } },
  config: {
    version: POMODORO_CONFIG_VERSION,
    schema: pomodoroConfigSchema,
    defaults: pomodoroDefaults,
    migrations: {},
  },
  // Documentation only: notifications come from the Rust scheduler (ADR-001 amendment).
  permissions: ['notifications'],
  // A single pomodoro runs at a time (M10): a second widget would only duplicate it.
  maxInstances: 1,
});
