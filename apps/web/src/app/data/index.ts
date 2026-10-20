export type {
  Dashboard,
  GridRect,
  LayoutItem,
  NewDashboard,
  NewWidgetInstance,
  WidgetInstanceRecord,
} from './models';
export type { JsonObject, JsonPrimitive, JsonValue } from './json';
export { parseJsonObject, parseJsonValue } from './json';
export { DataError } from './data-error';
export type { DataErrorKind } from './data-error';
export { randomUuid, systemClock } from './clock';
export type { Clock, IdGenerator } from './clock';
export type {
  DashboardRepository,
  SettingsRepository,
  WidgetInstanceRepository,
} from './repositories';
export {
  DASHBOARD_REPOSITORY,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
  provideDataLayer,
} from './data.providers';
