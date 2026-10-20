export { GRID_COLUMNS, GRID_MAX_ROWS, clampGrid, nextFreePosition } from './grid';
export { MAX_CONFIG_CHARS, resolveConfig, serializeConfig, validateSync } from './widget-config';
export type {
  ConfigErrorReason,
  ResolvedConfig,
  SerializedConfig,
  ValidationResult,
} from './widget-config';
export {
  WIDGET_CONTEXT,
  WidgetConfigError,
  WidgetInstanceNotFoundError,
  injectWidgetContext,
} from './widget-context';
export type { WidgetContext } from './widget-context';
export {
  WIDGET_ICON_PATTERN,
  WIDGET_PERMISSION_KINDS,
  WIDGET_TYPE_ID_PATTERN,
  defineWidget,
} from './widget-definition';
export type {
  ConfigMigration,
  GridSize,
  WidgetConfigSpec,
  WidgetDefinition,
  WidgetPermissionKind,
  WidgetSizeConstraints,
  WidgetTypeId,
} from './widget-definition';
export {
  WidgetPermissionError,
  assertWidgetPermission,
  hasWidgetPermission,
} from './widget-permissions';
export {
  WIDGET_DEFINITIONS,
  WidgetRegistry,
  WidgetRegistryError,
  provideWidget,
  validateDefinition,
} from './widget-registry';
