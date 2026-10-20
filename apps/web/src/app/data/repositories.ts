import { JsonObject, JsonValue } from './json';
import {
  Dashboard,
  LayoutItem,
  NewDashboard,
  NewNote,
  NewShortcut,
  NewWidgetInstance,
  Note,
  Shortcut,
  ShortcutFields,
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

export interface NoteRepository {
  get(id: string): Promise<Note | null>;
  /** title <= 200 and body <= 100000 characters (invalid_input otherwise); both default to ''.
   * widgetInstanceId: the owning widget instance (cascade delete); a missing instance
   * is DataError('constraint'). */
  create(input?: NewNote): Promise<Note>;
  /** Replaces title and body (same limits as create). not_found when absent. */
  update(id: string, title: string, body: string): Promise<Note>;
  /** false when already absent. */
  remove(id: string): Promise<boolean>;
}

export interface ShortcutRepository {
  /** ORDER BY sort_order, created_at, id */
  list(): Promise<Shortcut[]>;
  /**
   * Label trimmed, 1 to 80 characters; url at most 2048 characters and starting with
   * http:// or https:// (invalid_input otherwise). sort_order = max + 1 (or 0), computed
   * in the same INSERT ... SELECT.
   */
  create(input: NewShortcut): Promise<Shortcut>;
  /** Same validation as create. not_found when absent. Keeps sort_order. */
  update(id: string, fields: ShortcutFields): Promise<Shortcut>;
  /** false when already absent. */
  remove(id: string): Promise<boolean>;
  /**
   * Single UPDATE ... FROM json_each($1): the shortcut at index i of `ids` gets
   * sort_order = i. Unknown ids are ignored; shortcuts absent from `ids` keep their
   * sort_order. More than 1000 ids or duplicates: invalid_input before any query. Empty: no query.
   * Only rows whose sort_order actually changes are written.
   */
  reorder(ids: readonly string[]): Promise<void>;
}
