import { defineWidget } from '../../core/widgets';
import {
  HELLO_CONFIG_VERSION,
  HelloConfig,
  helloConfigSchema,
  helloDefaults,
} from './hello.config';

export const helloWidget = defineWidget<HelloConfig>({
  type: 'hello',
  titleKey: 'widgets.hello.title',
  descriptionKey: 'widgets.hello.description',
  icon: 'pi pi-star',
  loadComponent: () => import('./hello.component').then((m) => m.HelloComponent),
  size: { min: { w: 2, h: 1 }, default: { w: 3, h: 2 }, max: { w: 6, h: 4 } },
  config: {
    version: HELLO_CONFIG_VERSION,
    schema: helloConfigSchema,
    defaults: helloDefaults,
    migrations: {},
  },
  permissions: [],
});
