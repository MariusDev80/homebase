import { DataError } from '../data-error';
import { parseJsonObject, parseJsonValue, type JsonValue } from '../json';
import type {
  Dashboard,
  GridRect,
  Note,
  Shortcut,
  Todo,
  TodoList,
  WidgetInstanceRecord,
} from '../models';

export interface NoteWire {
  readonly id: string;
  readonly widgetInstanceId: string | null;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NoteHitWire {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly widgetInstanceId: string | null;
}

export interface ShortcutWire {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TodoListWire {
  readonly id: string;
  readonly widgetInstanceId: string | null;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TodoWire {
  readonly id: string;
  readonly listId: string;
  readonly title: string;
  readonly description: string;
  readonly dueOn: string | null;
  readonly rrule: string | null;
  readonly important: boolean;
  readonly completedAt: string | null;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TodoHitWire {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly listId: string;
  readonly widgetInstanceId: string | null;
  readonly completedAt: string | null;
}

export function toNote(wire: NoteWire): Note {
  return {
    id: wire.id,
    widgetInstanceId: wire.widgetInstanceId,
    title: wire.title,
    body: wire.body,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

export function toShortcut(wire: ShortcutWire): Shortcut {
  return {
    id: wire.id,
    label: wire.label,
    url: wire.url,
    sortOrder: wire.sortOrder,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

export function toTodoList(wire: TodoListWire): TodoList {
  return {
    id: wire.id,
    widgetInstanceId: wire.widgetInstanceId,
    name: wire.name,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

export function toTodo(wire: TodoWire): Todo {
  return {
    id: wire.id,
    listId: wire.listId,
    title: wire.title,
    description: wire.description,
    dueOn: wire.dueOn,
    rrule: wire.rrule,
    important: wire.important,
    completedAt: wire.completedAt,
    sortOrder: wire.sortOrder,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

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
