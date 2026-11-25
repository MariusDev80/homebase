import { JsonObject, JsonValue } from './json';
import type { InstantIso, LocalDateIso, LocalDateTimeIso } from './time-formats';
import {
  Dashboard,
  Habit,
  HabitCheck,
  HabitInput,
  DashboardPatch,
  LayoutItem,
  NewDashboard,
  NewNote,
  NewShortcut,
  NewTodo,
  NewTodoList,
  NewWidgetInstance,
  Note,
  Reminder,
  ReminderDelivery,
  ReminderInput,
  TimeSession,
  TimeSessionKind,
  NoteSearchHit,
  Shortcut,
  ShortcutFields,
  Todo,
  TodoChanges,
  TodoList,
  TodoSearchHit,
  WidgetInstanceRecord,
} from './models';

/**
 * Settings, dashboards, widget instances, notes, shortcuts and todos. Implemented by Rust commands
 * (data/tauri), never by SQL in the front (spec typed-data-commands). Errors are DataError (see
 * data/tauri/invoke-command.ts). Every write rejects with `unavailable` while a restoration is armed
 * (T7), and every call outside Tauri rejects with `unavailable`, except where the adapter checks
 * first (a JSON value that cannot be serialized, an invalid theme: `invalid_input`). Stored
 * timestamps (created_at, updated_at, completed_at) come from the Rust clock, not from CLOCK
 * (spec 4.9-2). Text is trimmed like Rust `hb_trim` (also U+0085).
 */
export interface SettingsRepository {
  get(key: string): Promise<JsonValue | undefined>;
  getAll(): Promise<ReadonlyMap<string, JsonValue>>;
  /**
   * Creates or replaces the value. Check order: 1) "secret-like" key (case-insensitive
   * /(secret|token|passw(or)?d|api[-_.]?key|credential)/i): forbidden; 2) key format
   * (/^[a-z][a-z0-9._-]{0,127}$/): invalid_input. forbidden also when a new key would exceed the
   * 200 settings (T6).
   */
  set(key: string, value: JsonValue): Promise<void>;
  remove(key: string): Promise<boolean>;
}

export interface DashboardRepository {
  /** Ordered by sort_order, created_at, id. */
  list(): Promise<Dashboard[]>;
  get(id: string): Promise<Dashboard | null>;
  /**
   * Appended after the others (sort_order = max + 1, or 0). Icon defaults to DEFAULT_DASHBOARD_ICON.
   * Theme defaults to {} / DEFAULT_DASHBOARD_THEME_VERSION, validated like updateTheme. invalid_input
   * when a given id is not a lowercase UUID, or on an invalid name, icon or theme; conflict when
   * the id exists; forbidden beyond 100 dashboards (T6).
   */
  create(input: NewDashboard): Promise<Dashboard>;
  /**
   * Creates the dashboard only when none exists; true when created. Same defaults and validation
   * as create (invalid_input even when nothing is created).
   */
  createIfNone(input: NewDashboard): Promise<boolean>;
  /**
   * Replaces name and icon. not_found when absent. Name trimmed, 1 to 100 characters; icon matching
   * DASHBOARD_ICON_PATTERN (invalid_input otherwise).
   */
  update(id: string, patch: DashboardPatch): Promise<Dashboard>;
  /**
   * Replaces theme and theme_version; returns the updated dashboard. not_found when absent.
   * invalid_input when the serialized object exceeds MAX_DASHBOARD_THEME_CHARS code points or when
   * themeVersion is not an integer in 1..=10 000. The data layer never interprets the theme.
   */
  updateTheme(id: string, theme: JsonObject, themeVersion: number): Promise<Dashboard>;
  /**
   * Atomic: creates the dashboard (same defaults and validation as create) and moves the listed
   * instances of `sourceDashboardId` to it with their new rectangles. Ids that are not instances of
   * the source are ignored. invalid_input when `items` is empty, has duplicate ids or a rectangle
   * outside the grid bounds (x, y in 0..=10 000; w, h in 1..=10 000), or when the new id or `sourceDashboardId` is malformed;
   * conflict when no instance could be moved (nothing is created); forbidden when the dashboard
   * limit (100) is reached. Returns the created dashboard and the number of instances moved.
   */
  createWithWidgets(
    input: NewDashboard,
    sourceDashboardId: string,
    items: readonly LayoutItem[],
  ): Promise<{ readonly dashboard: Dashboard; readonly moved: number }>;
}

export interface WidgetInstanceRepository {
  /** Ordered by grid_y, grid_x, created_at, id. */
  listByDashboard(dashboardId: string): Promise<WidgetInstanceRecord[]>;
  get(id: string): Promise<WidgetInstanceRecord | null>;
  /**
   * invalid_input on a malformed id, a widgetType outside 1 to 64 characters, a grid outside the
   * bounds (x, y in 0..=10 000; w, h in 1..=10 000) or a configVersion outside 1..=10 000;
   * conflict when the id exists; missing dashboard: DataError('constraint'); forbidden beyond
   * 200 instances in the dashboard or 1 000 in total (T6).
   */
  create(input: NewWidgetInstance): Promise<WidgetInstanceRecord>;
  /** not_found when absent; invalid_input when configVersion is outside 1..=10 000. */
  updateConfig(
    id: string,
    config: JsonObject,
    configVersion: number,
  ): Promise<WidgetInstanceRecord>;
  /**
   * Returns the number of instances of `dashboardId` updated; unknown ids and
   * instances of another dashboard are ignored. Empty batch: 0. invalid_input on duplicate ids, more
   * than 1 000 items or a rectangle outside the grid bounds (x, y in 0..=10 000; w, h in 1..=10 000).
   */
  updateLayout(dashboardId: string, items: readonly LayoutItem[]): Promise<number>;
  /**
   * First instance of the type, in dashboard order (sort_order, created_at, id) then
   * listByDashboard order; null when there is none.
   */
  findFirstOfType(widgetType: string): Promise<WidgetInstanceRecord | null>;
  remove(id: string): Promise<boolean>;
}

/**
 * Implemented by Rust commands (note_*). Errors: `unavailable` on any write while a restoration is
 * armed and on any call outside Tauri; `invalid_input` on a malformed id at creation (a lowercase
 * UUID is required), on a title or body over the limits, and on a bad search query or limit.
 */
export interface NoteRepository {
  /** null when absent, including for a malformed id. */
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

/**
 * Implemented by Rust commands (shortcut_*). Errors: `unavailable` on any write while a restoration
 * is armed and on any call outside Tauri (`reorder([])` included: it now makes a call);
 * `invalid_input` as described per method.
 */
export interface ShortcutRepository {
  /** ORDER BY sort_order, created_at, id */
  list(): Promise<Shortcut[]>;
  /**
   * Label trimmed, 1 to 80 characters; url at most 2048 characters and starting with
   * http:// or https:// (invalid_input otherwise, as for a malformed id). sort_order = max + 1 (or 0).
   */
  create(input: NewShortcut): Promise<Shortcut>;
  /** Same validation as create. not_found when absent. Keeps sort_order. */
  update(id: string, fields: ShortcutFields): Promise<Shortcut>;
  /** false when already absent. */
  remove(id: string): Promise<boolean>;
  /**
   * The shortcut at index i of `ids` gets sort_order = i. Unknown ids are ignored; shortcuts absent
   * from `ids` keep their sort_order. More than 1000 ids, duplicates or an id over 64 bytes:
   * invalid_input before the disk. Empty: succeeds without touching the disk (after the
   * unavailable checks). Only rows whose sort_order actually changes are written.
   */
  reorder(ids: readonly string[]): Promise<void>;
  /**
   * Shortcuts whose label or url contains `query` (same matching and limits as
   * NoteRepository.search). Label matches first, then by sort_order.
   */
  search(query: string, limit: number): Promise<Shortcut[]>;
}

/**
 * Implemented by Rust commands (todo_*). Errors: `unavailable` on any write while a restoration is
 * armed and on any call outside Tauri (`reorder(listId, [])` included: it now makes a call);
 * `invalid_input` on a malformed id at creation, on a date out of 1900-01-01..=2199-12-31 or
 * malformed, and as described per method. The order of checks changed outside Tauri: for example
 * `search('', 5)` is `unavailable`, not `invalid_input`.
 */
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
   * (invalid_input on a bad shape or a date outside 1900-01-01..=2199-12-31, constraint on an
   * impossible date such as 2026-02-30). Appended at the end:
   * sort_order = max + 1 (or 0) within the list. A missing list is DataError('constraint').
   */
  create(input: NewTodo): Promise<Todo>;
  /**
   * Omitted fields are kept. An explicit null for title, description or important is invalid_input
   * (null only clears dueOn and rrule). Title trimmed, 1 to 500 characters; dueOn a YYYY-MM-DD shape or null;
   * description at most TODO_DESCRIPTION_MAX UTF-16 units (kept as typed, not trimmed); rrule null or
   * 10 to 256 characters starting with 'FREQ=' (invalid_input otherwise). rrule non-null together
   * with dueOn null: invalid_input before any query. dueOn null without rrule also clears the rule.
   * A rule written on a todo without due date (dueOn omitted): DataError('constraint').
   * not_found when absent.
   */
  update(id: string, changes: TodoChanges): Promise<Todo>;
  /**
   * Compare-and-set of the due date of a repeating, active todo: writes `toDueOn` only if the row
   * still has due_on = `fromDueOn`, a rule, and no completed_at (atomic). Otherwise conflict,
   * or not_found when absent. Both dates must have the YYYY-MM-DD shape within 1900-01-01..=2199-12-31 (invalid_input); a well-formed but impossible date
   * (e.g. 2026-02-30) is DataError('constraint'). Used to
   * advance a repeating todo when it is checked, and to undo that. Keeps sort_order.
   */
  shiftRepeatDue(id: string, fromDueOn: string, toDueOn: string): Promise<Todo>;
  /** completed = true sets completed_at to the Rust clock's now (kept if already set); false sets NULL
   * and moves a previously completed todo to the end of the active ones (sort_order = max + 1).
   * not_found when absent. */
  setCompleted(id: string, completed: boolean): Promise<Todo>;
  /** false when already absent. */
  remove(id: string): Promise<boolean>;
  /**
   * Active todos (completed_at IS NULL) whose due_on is within [fromOn, toOn] (inclusive), across
   * all lists, ordered by due_on, sort_order, id. Both dates YYYY-MM-DD and fromOn <= toOn, limit an
   * integer 1..1000: invalid_input before any query.
   */
  listDue(
    range: { readonly fromOn: LocalDateIso; readonly toOn: LocalDateIso },
    limit: number,
  ): Promise<Todo[]>;
  /**
   * Active todos (completed_at IS NULL) whose due_on is strictly before `beforeOn` (the overdue
   * ones), across all lists, ordered by due_on, sort_order, id. beforeOn YYYY-MM-DD, limit an
   * integer 1..1000: invalid_input before any query.
   */
  listOverdueBefore(beforeOn: LocalDateIso, limit: number): Promise<Todo[]>;
  /**
   * Active repeating todos (completed_at IS NULL AND rrule IS NOT NULL) whose due_on <= toOn, across
   * all lists, ordered by due_on, sort_order, id. toOn YYYY-MM-DD, limit an integer 1..1000:
   * invalid_input before any query.
   */
  listRepeatingDueBy(toOn: LocalDateIso, limit: number): Promise<Todo[]>;
  /**
   * The todo at index i of `ids` gets sort_order = i (only todos of `listId`; unknown ids are
   * ignored). More than 1000 ids, duplicates or an id over 64 bytes: invalid_input before the disk.
   * Empty: succeeds without touching the disk (after the unavailable checks). Only rows whose
   * sort_order changes are written.
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

export type MarkSeenTarget =
  | { readonly kind: 'all' }
  | { readonly kind: 'one'; readonly reminderId: string; readonly occurrenceKey: LocalDateTimeIso };

/**
 * Reminders and their deliveries. Implemented by Rust commands (data/tauri), never by SQL in the
 * front (spec timers-reminders D2). Errors are DataError (see data/tauri/invoke-command.ts).
 */
export interface ReminderRepository {
  list(): Promise<Reminder[]>;
  /** The id is generated by the IdGenerator when absent. */
  create(input: ReminderInput & { readonly id?: string }): Promise<Reminder>;
  update(id: string, input: ReminderInput): Promise<Reminder>;
  /** false when already absent. */
  remove(id: string): Promise<boolean>;
  unseenDeliveries(limit: number): Promise<ReminderDelivery[]>;
  /** Returns how many deliveries were marked. */
  markSeen(target: MarkSeenTarget): Promise<number>;
}

/** Timers, stopwatches and pomodoro phases (same implementation rule as ReminderRepository). */
export interface TimeSessionRepository {
  listRunning(): Promise<TimeSession[]>;
  history(page: {
    readonly before?: { readonly startedAt: InstantIso; readonly id: string };
    readonly limit: number;
  }): Promise<TimeSession[]>;
  start(input: {
    readonly id?: string;
    readonly kind: TimeSessionKind;
    readonly label: string;
    readonly durationMs: number | null;
  }): Promise<TimeSession>;
  stop(id: string): Promise<TimeSession>;
  rename(id: string, label: string): Promise<TimeSession>;
  /** false when already absent. */
  remove(id: string): Promise<boolean>;
}

/**
 * Habits and their daily checks. Implemented by Rust commands (data/tauri), never by SQL in the
 * front (spec habits D1). Errors are DataError (see data/tauri/invoke-command.ts).
 */
export interface HabitRepository {
  list(): Promise<Habit[]>;
  /** The id is generated by the IdGenerator when absent. */
  create(input: HabitInput & { readonly id?: string }): Promise<Habit>;
  update(id: string, input: HabitInput): Promise<Habit>;
  setArchived(id: string, archived: boolean): Promise<Habit>;
  /** false when already absent. */
  remove(id: string): Promise<boolean>;
  checks(range: { readonly from: LocalDateIso; readonly to: LocalDateIso }): Promise<HabitCheck[]>;
  /** true when a line changed (false: already in that state). */
  setCheck(habitId: string, dayOn: LocalDateIso, done: boolean): Promise<boolean>;
}
