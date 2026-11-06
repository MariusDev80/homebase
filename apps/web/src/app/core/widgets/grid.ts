import type { GridRect } from '../../data';
import type { GridSize, WidgetSizeConstraints } from './widget-definition';

export const GRID_COLUMNS = 12;
/** Total rows of a dashboard, and the tallest a widget can be. */
export const GRID_ROWS = 8;

function toInt(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function bound(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Bounds w/h to [min, min(max, GRID_ROWS)], x to [0, GRID_COLUMNS - w], y to [0, GRID_ROWS - h]; floors; NaN -> min (w/h) or 0 (x/y). */
export function clampGrid(grid: GridRect, constraints: WidgetSizeConstraints): GridRect {
  const w = bound(toInt(grid.w, constraints.min.w), constraints.min.w, constraints.max.w);
  const maxH = Math.max(constraints.min.h, Math.min(constraints.max.h, GRID_ROWS));
  const h = bound(toInt(grid.h, constraints.min.h), constraints.min.h, maxH);
  const x = bound(toInt(grid.x, 0), 0, Math.max(0, GRID_COLUMNS - w));
  const y = bound(toInt(grid.y, 0), 0, Math.max(0, GRID_ROWS - h));
  return { x, y, w, h };
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * First free rect, scanning rows then columns. Tries `preferred`, then shrinks: h from preferred.h
 * down to min.h, and for each h, w from preferred.w down to min.w. null when nothing fits.
 */
export function nextFreePosition(
  existing: readonly GridRect[],
  preferred: GridSize,
  min: GridSize = preferred,
): GridRect | null {
  const maxH = Math.min(preferred.h, GRID_ROWS);
  const maxW = Math.min(preferred.w, GRID_COLUMNS);
  for (let h = maxH; h >= min.h; h--) {
    for (let w = maxW; w >= min.w; w--) {
      for (let y = 0; y + h <= GRID_ROWS; y++) {
        for (let x = 0; x + w <= GRID_COLUMNS; x++) {
          const rect = { x, y, w, h };
          if (!existing.some((other) => rectsOverlap(rect, other))) return rect;
        }
      }
    }
  }
  return null;
}
