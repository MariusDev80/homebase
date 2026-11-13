import { JsonObject, JsonValue } from './json';
import {
  Dashboard,
  DashboardPatch,
  LayoutItem,
  NewDashboard,
  NewNote,
  NewShortcut,
  NewTodo,
  NewTodoList,
  NewWidgetInstance,
  Note,
  NoteSearchHit,
  Shortcut,
  ShortcutFields,
  Todo,
  TodoChanges,
  TodoList,
  TodoSearchHit,
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
  /** sort_order = max + 1 (or 0), computed in the same INSERT … SELECT. Icon defaults to DEFAULT_DASHBOARD_ICON. Theme defaults to {} / DEFAULT_DASHBOARD_THEME_VERSION, validated like updateTheme. */
  create(input: NewDashboard): Promise<Dashboard>;
  /**
   * INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM dashboards); true when created. Same
   * defaults as create (icon DEFAULT_DASHBOARD_ICON; theme {} and DEFAULT_DASHBOARD_THEME_VERSION),
   * and the theme is validated like updateTheme even when nothing is inserted (invalid_input).
   */
  createIfNone(input: NewDashboard): Promise<boolean>;
  /**
   * Replaces name and icon in one statement. not_found when absent. Name trimmed, 1 to 100
   * characters; icon matching DASHBOARD_ICON_PATTERN (invalid_input otherwise).
   */
  update(id: string, patch: DashboardPatch): Promise<Dashboard>;
  /**
   * Replaces theme and theme_version in one statement; returns the updated dashboard. not_found
   * when absent. invalid_input when the serialized object exceeds MAX_DASHBOARD_THEME_CHARS code
   * points or when themeVersion is not a safe integer >= 1. The data layer never interprets it.
   */
  updateTheme(id: string, theme: JsonObject, themeVersion: number): Promise<Dashboard>;
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
  /**
   * Single UPDATE … FROM json_each($2) statement moving the listed instances to the target
   * dashboard with their new rectangles; returns the number of rows changed. Empty batch: 0
   * without a query. Duplicate ids or invalid values: invalid_input; missing dashboard: constraint.
   * maxInstances is not enforced here: the target is expected to be a freshly created, empty
   * dashboard.
   */
  moveToDashboard(targetDashboardId: string, items: readonly LayoutItem[]): Promise<number>;
  /**
   * First instance of the type, in dashboard order (sort_order, created_at, id) then
   * listByDashboard order; null when there is none.
   */
  findFirstOfType(widgetType: string): Promise<WidgetInstanceRecord | null>;
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
  /**
   * Notes whose title or body contains `query` (literal match, LIKE ... ESCAPE; ASCII
   * case-insensitive only). Title matches first, then most recently updated. `query` trimmed
   * 1 to 200 characters, `limit` an integer 1 to 20 (invalid_input otherwise).
   */
  search(query: string, limit: number): Promise<NoteSearchHit[]>;
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
  /**
   * Shortcuts whose label or url contains `query` (same matching and limits as
   * NoteRepository.search). Label matches first, then by sort_order.
   */
  search(query: string, limit: number): Promise<Shortcut[]>;
}

export interface TodoRepository {
  /** The list owned by this widget instance, or null. */
  getListForInstance(widgetInstanceId: string): Promise<TodoList | null>;
  /** Name trimmed, 1 to 80 characters (invalid_input otherwise). A missing instance is
   * DataError('constraint'); a second list for the same instance is DataError('conflict'). */
  createList(input: NewTodoList): Promise<TodoList>;
  /** Not completed first by sort_order, then completed by completed_at descending. */
  listTodos(listId: string): Promise<Todo[]>;
  /**
   * Title trimmed, 1 to 500 characters; dueOn a valid calendar date YYYY-MM-DD
   * (invalid_input on a bad shape, constraint on an impossible date). Appended at the end:
   * sort_order = max + 1 (or 0) within the list. A missing list is DataError('constraint').
   */
  create(input: NewTodo): Promise<Todo>;
  /**
   * Omitted fields are kept. Title trimmed, 1 to 500 characters; dueOn a YYYY-MM-DD shape or null;
   * description at most TODO_DESCRIPTION_MAX UTF-16 units (kept as typed, not trimmed); rrule null or
   * 10 to 256 characters starting with 'FREQ=' (invalid_input otherwise). rrule non-null together
   * with dueOn null: invalid_input before any query. dueOn null without rrule also clears the rule.
   * A rule written on a todo without due date (dueOn omitted): DataError('constraint').
   * not_found when absent. One statement.
   */
  update(id: string, changes: TodoChanges): Promise<Todo>;
  /**
   * Compare-and-set of the due date of a repeating, active todo: writes `toDueOn` only if the row
   * still has due_on = `fromDueOn`, a rule, and no completed_at (one statement). Otherwise conflict,
   * or not_found when absent. Both dates must have the YYYY-MM-DD shape (invalid_input); a well-formed but impossible date
   * (e.g. 2026-02-30) is DataError('constraint'). Used to
   * advance a repeating todo when it is checked, and to undo that. Keeps sort_order.
   */
  shiftRepeatDue(id: string, fromDueOn: string, toDueOn: string): Promise<Todo>;
  /** completed = true sets completed_at to the Clock's now (kept if already set); false sets NULL
   * and moves a previously completed todo to the end of the active ones (sort_order = max + 1).
   * not_found when absent. */
  setCompleted(id: string, completed: boolean): Promise<Todo>;
  /** false when already absent. */
  remove(id: string): Promise<boolean>;
  /**
   * Single UPDATE ... FROM json_each($1): the todo at index i of `ids` gets sort_order = i
   * (only todos of `listId`; unknown ids are ignored). More than 1000 ids or duplicates:
   * invalid_input before any query. Empty: no query. Only rows whose sort_order changes are written.
   */
  reorder(listId: string, ids: readonly string[]): Promise<void>;
  /** Deletes the completed todos of the list; returns how many. */
  clearCompleted(listId: string): Promise<number>;
  /**
   * Todos (active and completed) whose title or description contains `query` (same matching and
   * limits as NoteRepository.search), joined to their list for `widgetInstanceId`. Order: active
   * first, then title matches before description-only matches, then most recently updated.
   * `excerpt` is the description around the first match (`excerptAround`; empty when none).
   */
  search(query: string, limit: number): Promise<TodoSearchHit[]>;
}
