import { JsonObject, JsonValue } from './json';
import {
  Dashboard,
  LayoutItem,
  NewDashboard,
  NewWidgetInstance,
  WidgetInstanceRecord,
} from './models';

export interface SettingsRepository {
  get(key: string): Promise<JsonValue | undefined>;
  getAll(): Promise<ReadonlyMap<string, JsonValue>>;
  /**
   * Upsert in one statement. Check order: 1) "secret-like" key (case-insensitive
   * /(secret|token|passw(or)?d|api[-_.]?key|credential)/i): forbidden;
   * 2) key format (/^[a-z][a-z0-9._-]{0,127}$/): invalid_input.
   */
  set(key: string, value: JsonValue): Promise<void>;
  remove(key: string): Promise<boolean>;
}

export interface DashboardRepository {
  /** ORDER BY sort_order, created_at, id */
  list(): Promise<Dashboard[]>;
  get(id: string): Promise<Dashboard | null>;
  /** sort_order = max + 1 (or 0), computed in the same INSERT … SELECT. */
  create(input: NewDashboard): Promise<Dashboard>;
  /** INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM dashboards); true when created. */
  createIfNone(input: NewDashboard): Promise<boolean>;
  /** not_found when absent. Name trimmed, 1 to 100 characters (invalid_input otherwise). */
  rename(id: string, name: string): Promise<Dashboard>;
  /** Cascades to widget_instances. false when already absent. */
  remove(id: string): Promise<boolean>;
}

export interface WidgetInstanceRepository {
  /** ORDER BY grid_y, grid_x, created_at, id */
  listByDashboard(dashboardId: string): Promise<WidgetInstanceRecord[]>;
  get(id: string): Promise<WidgetInstanceRecord | null>;
  /** Missing dashboard (FK): DataError('constraint'). */
  create(input: NewWidgetInstance): Promise<WidgetInstanceRecord>;
  /** not_found when absent. */
  updateConfig(
    id: string,
    config: JsonObject,
    configVersion: number,
  ): Promise<WidgetInstanceRecord>;
  /**
   * Single UPDATE … FROM json_each($2) statement; returns the number of rows changed.
   * Empty batch: 0 without a query. Duplicate ids or non-integer/negative values:
   * invalid_input before any query.
   */
  updateLayout(dashboardId: string, items: readonly LayoutItem[]): Promise<number>;
  remove(id: string): Promise<boolean>;
}
