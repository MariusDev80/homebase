import { JsonObject } from './json';

export interface Dashboard {
  id: string;
  name: string;
  sortOrder: number;
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
