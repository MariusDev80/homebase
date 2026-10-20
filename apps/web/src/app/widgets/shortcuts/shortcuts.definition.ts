import { defineWidget } from '../../core/widgets';
import {
  SHORTCUTS_CONFIG_VERSION,
  ShortcutsConfig,
  shortcutsConfigSchema,
  shortcutsDefaults,
} from './shortcuts.config';

export const shortcutsWidget = defineWidget<ShortcutsConfig>({
  type: 'shortcuts',
  titleKey: 'widgets.shortcuts.title',
  descriptionKey: 'widgets.shortcuts.description',
  icon: 'pi pi-link',
  loadComponent: () => import('./shortcuts.component').then((m) => m.ShortcutsComponent),
  size: { min: { w: 2, h: 2 }, default: { w: 3, h: 3 }, max: { w: 6, h: 8 } },
  config: {
    version: SHORTCUTS_CONFIG_VERSION,
    schema: shortcutsConfigSchema,
    defaults: shortcutsDefaults,
    migrations: {},
  },
  permissions: ['open-url'],
});
