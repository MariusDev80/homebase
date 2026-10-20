import type { GridRect } from '../../data';
import type { GridSize, WidgetSizeConstraints } from './widget-definition';

export const GRID_COLUMNS = 12;
export const GRID_MAX_ROWS = 24;

function toInt(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function bound(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Bounds w/h to [min, max], x to [0, GRID_COLUMNS - w], y >= 0; floors; NaN -> min (w/h) or 0 (x/y). */
export function clampGrid(grid: GridRect, constraints: WidgetSizeConstraints): GridRect {
  const w = bound(toInt(grid.w, constraints.min.w), constraints.min.w, constraints.max.w);
  const h = bound(toInt(grid.h, constraints.min.h), constraints.min.h, constraints.max.h);
  const x = bound(toInt(grid.x, 0), 0, Math.max(0, GRID_COLUMNS - w));
  const y = Math.max(0, toInt(grid.y, 0));
  return { x, y, w, h };
}

/** { x: 0, y: max(y + h) of existing (0 when empty), w, h }. */
export function nextFreePosition(existing: readonly GridRect[], size: GridSize): GridRect {
  const y = existing.reduce((bottom, rect) => Math.max(bottom, rect.y + rect.h), 0);
  return { x: 0, y, w: size.w, h: size.h };
}
