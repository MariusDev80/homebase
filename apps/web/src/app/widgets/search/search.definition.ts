import { defineWidget } from '../../core/widgets';
import {
  SEARCH_CONFIG_VERSION,
  SearchConfig,
  searchConfigSchema,
  searchDefaults,
} from './search.config';

export const searchWidget = defineWidget<SearchConfig>({
  type: 'search',
  titleKey: 'widgets.search.title',
  descriptionKey: 'widgets.search.description',
  icon: 'pi pi-search',
  loadComponent: () => import('./search.component').then((m) => m.SearchComponent),
  size: { min: { w: 3, h: 1 }, default: { w: 6, h: 1 }, max: { w: 12, h: 6 } },
  config: {
    version: SEARCH_CONFIG_VERSION,
    schema: searchConfigSchema,
    defaults: searchDefaults,
    migrations: {},
  },
  permissions: ['open-url'],
  maxInstances: 1,
});
