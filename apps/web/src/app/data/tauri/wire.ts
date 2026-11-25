import { DataError } from '../data-error';
import { parseJsonObject, parseJsonValue, type JsonValue } from '../json';
import type { Dashboard, GridRect, WidgetInstanceRecord } from '../models';

/** Wire shapes of the Rust DTOs (camelCase; JSON objects travel as text). */
export interface DashboardWire {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly icon: string;
  readonly themeJson: string;
  readonly themeVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WidgetWire {
  readonly id: string;
  readonly dashboardId: string;
  readonly widgetType: string;
  readonly grid: GridRect;
  readonly configJson: string;
  readonly configVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SettingWire {
  readonly key: string;
  readonly valueJson: string;
}

export interface DashboardWithWidgetsWire {
  readonly dashboard: DashboardWire;
  readonly moved: number;
}

export function toDashboard(wire: DashboardWire): Dashboard {
  return {
    id: wire.id,
    name: wire.name,
    sortOrder: wire.sortOrder,
    icon: wire.icon,
    theme: parseJsonObject(wire.themeJson),
    themeVersion: wire.themeVersion,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

export function toWidgetInstance(wire: WidgetWire): WidgetInstanceRecord {
  return {
    id: wire.id,
    dashboardId: wire.dashboardId,
    widgetType: wire.widgetType,
    grid: { x: wire.grid.x, y: wire.grid.y, w: wire.grid.w, h: wire.grid.h },
    config: parseJsonObject(wire.configJson),
    configVersion: wire.configVersion,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

export function toSettingValue(valueJson: string): JsonValue {
  return parseJsonValue(valueJson);
}

/** JSON.stringify that refuses what has no JSON form (undefined, function, symbol, BigInt, cycle). */
export function stringifyJson(value: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value) as string | undefined;
  } catch {
    throw new DataError('invalid_input', 'Value is not serializable to JSON');
  }
  if (json === undefined) {
    throw new DataError('invalid_input', 'Value is not serializable to JSON');
  }
  return json;
}

/** Exact wire shape of GridDto (deny_unknown_fields on the Rust side). */
export function wireGrid(grid: GridRect): GridRect {
  return { x: grid.x, y: grid.y, w: grid.w, h: grid.h };
}
