import type { Type } from '@angular/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { JsonObject } from '../../data';
import type { CalendarSource } from '../calendar/calendar-source';

export type WidgetTypeId = string;
export const WIDGET_TYPE_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
export const WIDGET_ICON_PATTERN = /^pi pi-[a-z0-9-]+$/;

export interface GridSize {
  readonly w: number;
  readonly h: number;
}

export interface WidgetSizeConstraints {
  readonly min: GridSize;
  readonly default: GridSize;
  readonly max: GridSize;
}

export type WidgetPermissionKind = 'network' | 'notifications' | 'launch-apps' | 'open-url';
export const WIDGET_PERMISSION_KINDS: readonly WidgetPermissionKind[] = [
  'network',
  'notifications',
  'launch-apps',
  'open-url',
];

/** Transforms a config of version n into version n+1. Pure, synchronous, no I/O or clock. */
export type ConfigMigration = (previous: unknown) => unknown;

export interface WidgetConfigSpec<TConfig extends JsonObject> {
  readonly version: number;
  readonly schema: StandardSchemaV1<unknown, TConfig>;
  readonly defaults: () => TConfig;
  readonly migrations: Readonly<Record<number, ConfigMigration>>;
}

export interface WidgetDefinition<TConfig extends JsonObject = JsonObject> {
  readonly type: WidgetTypeId;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly icon: string;
  readonly loadComponent: () => Promise<Type<unknown>>;
  readonly size: WidgetSizeConstraints;
  readonly config: WidgetConfigSpec<TConfig>;
  readonly permissions: readonly WidgetPermissionKind[];
  /** Per dashboard. */
  readonly maxInstances?: number;
  readonly loadCalendarSource?: () => Promise<Type<CalendarSource>>;
}

/** Typed identity: drives the inference of TConfig. */
export function defineWidget<TConfig extends JsonObject>(
  definition: WidgetDefinition<TConfig>,
): WidgetDefinition<TConfig> {
  return definition;
}
