import { JsonObject } from './json';
import type { InstantIso, LocalDateIso } from './time-formats';

export const DEFAULT_DASHBOARD_ICON = 'th-large';
/** Same shape as the CHECK of V4. The closed list lives in core/dashboard/dashboard-icons.ts. */
export const DASHBOARD_ICON_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Same bound as the CHECK of V5, in code points of the serialized object. */
export const MAX_DASHBOARD_THEME_CHARS = 4096;
/** Same as the DEFAULT of V5. */
export const DEFAULT_DASHBOARD_THEME_VERSION = 1;

export interface Dashboard {
  id: string;
  name: string;
  sortOrder: number;
  icon: string;
  /** Opaque versioned object (V5); interpreted by core/dashboard/dashboard-theme.ts. */
  theme: JsonObject;
  themeVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetInstanceRecord {
  id: string;
  dashboardId: string;
  widgetType: string;
  grid: GridRect;
  config: JsonObject;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewDashboard {
  id?: string;
  name: string;
  icon?: string;
  /** Copied as is (e.g. the overflow dashboard inherits it); default {} and version 1. */
  theme?: JsonObject;
  themeVersion?: number;
}

export interface DashboardPatch {
  name: string;
  icon: string;
}

export interface NewWidgetInstance {
  id?: string;
  dashboardId: string;
  widgetType: string;
  grid: GridRect;
  config: JsonObject;
  configVersion: number;
}

export interface LayoutItem {
  id: string;
  grid: GridRect;
}

export interface Note {
  id: string;
  /** Owning widget instance (the note is deleted with it); null = standalone. */
  widgetInstanceId: string | null;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewNote {
  id?: string;
  widgetInstanceId?: string | null;
  title?: string;
  body?: string;
}

export interface Shortcut {
  id: string;
  label: string;
  url: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewShortcut {
  id?: string;
  label: string;
  url: string;
}

export interface ShortcutFields {
  label: string;
  url: string;
}

export interface TodoList {
  id: string;
  /** Owning widget instance (the list is deleted with it); null = standalone. */
  widgetInstanceId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewTodoList {
  id?: string;
  widgetInstanceId?: string | null;
  name: string;
}

/** Same bound as the CHECK of V6 (the repository counts UTF-16 units, which is stricter). */
export const TODO_DESCRIPTION_MAX = 10_000;
/** Title length bounds, after trim (CHECK of V3). */
export const TODO_TITLE_MAX = 500;
/** Repetition rule length bounds (CHECK of V6). */
export const TODO_RRULE_MIN = 10;
export const TODO_RRULE_MAX = 256;

export interface Todo {
  id: string;
  listId: string;
  title: string;
  /** Plain text, '' when none (V6). Rendered by interpolation only. */
  description: string;
  /** Wall-clock due date `YYYY-MM-DD` (ADR-003), or null. */
  dueOn: LocalDateIso | null;
  /** Repetition rule (canonical subset of core/time/date-rule.ts, no DTSTART), anchored on dueOn;
   *  null = no repetition. Never set without dueOn (CHECK of V6). Not interpreted here. */
  rrule: string | null;
  /** Flag shown on the row (V6, stored 0/1). */
  important: boolean;
  /** Instant `YYYY-MM-DDTHH:MM:SS.sssZ` of completion, or null when not completed. */
  completedAt: InstantIso | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewTodo {
  id?: string;
  listId: string;
  title: string;
  dueOn?: string | null;
}

/** Search hit on a note; `excerpt` is a short plain-text extract (may be empty). */
export interface NoteSearchHit {
  id: string;
  title: string;
  widgetInstanceId: string | null;
  excerpt: string;
}

/** Search hit on a todo; `widgetInstanceId` is the one of its list. */
export interface TodoSearchHit {
  id: string;
  title: string;
  listId: string;
  widgetInstanceId: string | null;
  completedAt: InstantIso | null;
  /** Short plain-text extract of the description (may be empty). */
  excerpt: string;
}

export interface TodoChanges {
  title?: string;
  /** undefined keeps the current value; null clears it, and the rule with it (same statement). */
  dueOn?: string | null;
  /** undefined keeps the current value; '' clears it. */
  description?: string;
  /** undefined keeps the current value; null removes the repetition. A rule needs a due date. */
  rrule?: string | null;
  /** undefined keeps the current value. Bound as 1/0, never as a JS boolean (ADR-002 F13). */
  important?: boolean;
}
