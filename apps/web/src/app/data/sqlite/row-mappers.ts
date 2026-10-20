import { DataError } from '../data-error';
import { parseJsonObject } from '../json';
import { Dashboard, WidgetInstanceRecord } from '../models';

// Type aliases (not interfaces) so that they stay assignable to SqlRow (index signature).
/* eslint-disable @typescript-eslint/consistent-type-definitions */
export type DashboardRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type WidgetInstanceRow = {
  id: string;
  dashboard_id: string;
  widget_type: string;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  config: string;
  config_version: number;
  created_at: string;
  updated_at: string;
};

/* eslint-enable @typescript-eslint/consistent-type-definitions */

export const DASHBOARD_COLUMNS = 'id, name, sort_order, created_at, updated_at';
export const WIDGET_INSTANCE_COLUMNS =
  'id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version, created_at, updated_at';

function str(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new DataError('corrupt_data', `Column ${column} is not a string`);
  }
  return value;
}

function int(value: unknown, column: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DataError('corrupt_data', `Column ${column} is not an integer`);
  }
  return value;
}

export function toDashboard(row: DashboardRow): Dashboard {
  return {
    id: str(row.id, 'id'),
    name: str(row.name, 'name'),
    sortOrder: int(row.sort_order, 'sort_order'),
    createdAt: str(row.created_at, 'created_at'),
    updatedAt: str(row.updated_at, 'updated_at'),
  };
}

export function toWidgetInstance(row: WidgetInstanceRow): WidgetInstanceRecord {
  return {
    id: str(row.id, 'id'),
    dashboardId: str(row.dashboard_id, 'dashboard_id'),
    widgetType: str(row.widget_type, 'widget_type'),
    grid: {
      x: int(row.grid_x, 'grid_x'),
      y: int(row.grid_y, 'grid_y'),
      w: int(row.grid_w, 'grid_w'),
      h: int(row.grid_h, 'grid_h'),
    },
    config: parseJsonObject(str(row.config, 'config')),
    configVersion: int(row.config_version, 'config_version'),
    createdAt: str(row.created_at, 'created_at'),
    updatedAt: str(row.updated_at, 'updated_at'),
  };
}
