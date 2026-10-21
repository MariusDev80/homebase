import { defineWidget } from '../../core/widgets';
import {
  WEATHER_CONFIG_VERSION,
  WeatherConfig,
  weatherConfigSchema,
  weatherDefaults,
} from './weather.config';

export const weatherWidget = defineWidget<WeatherConfig>({
  type: 'weather',
  titleKey: 'widgets.weather.title',
  descriptionKey: 'widgets.weather.description',
  icon: 'pi pi-sun',
  loadComponent: () => import('./weather.component').then((m) => m.WeatherComponent),
  size: { min: { w: 2, h: 2 }, default: { w: 3, h: 4 }, max: { w: 6, h: 8 } },
  config: {
    version: WEATHER_CONFIG_VERSION,
    schema: weatherConfigSchema,
    defaults: weatherDefaults,
    migrations: {},
  },
  permissions: ['network', 'open-url'],
});
