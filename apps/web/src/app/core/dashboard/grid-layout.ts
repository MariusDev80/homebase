import type { GridRect, LayoutItem } from '../../data';
import { clampGrid } from '../widgets/grid';
import type { WidgetSizeConstraints } from '../widgets/widget-definition';

/** Vertical room the grid may grow to (rows), well above GRID_MAX_ROWS (a widget's own height). */
export const GRID_MAX_TOTAL_ROWS = 200;

export interface LayoutDelta {
  readonly dx?: number;
  readonly dy?: number;
  readonly dw?: number;
  readonly dh?: number;
}

export interface LayoutEntry {
  readonly id: string;
  readonly grid: GridRect;
  readonly constraints: WidgetSizeConstraints;
}

export function sameRect(a: GridRect, b: GridRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function overlaps(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Applies the delta then bounds the result to the constraints, the columns and the rows. */
export function nudgeRect(
  grid: GridRect,
  delta: LayoutDelta,
  constraints: WidgetSizeConstraints,
): GridRect {
  const next = clampGrid(
    {
      x: grid.x + (delta.dx ?? 0),
      y: grid.y + (delta.dy ?? 0),
      w: grid.w + (delta.dw ?? 0),
      h: grid.h + (delta.dh ?? 0),
    },
    constraints,
  );
  return { ...next, y: Math.min(next.y, GRID_MAX_TOTAL_ROWS - next.h) };
}

/**
 * Moves/resizes one entry, then pushes the overlapped entries down (the moved one stays put) until
 * nothing overlaps. Returns only the entries whose rect changed (the moved one included).
 */
export function applyNudge(
  entries: readonly LayoutEntry[],
  id: string,
  delta: LayoutDelta,
): LayoutItem[] {
  const target = entries.find((e) => e.id === id);
  if (!target) return [];
  const moved = nudgeRect(target.grid, delta, target.constraints);
  if (sameRect(moved, target.grid)) return [];

  const rects = new Map<string, GridRect>(entries.map((e) => [e.id, e.grid]));
  rects.set(id, moved);

  // Placed = rects that are final; others are placed top to bottom, pushed below what they hit.
  const placed: GridRect[] = [moved];
  const others = entries
    .filter((e) => e.id !== id)
    .map((e) => ({ id: e.id, rect: e.grid }))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  for (const other of others) {
    let rect = other.rect;
    for (
      let hit = placed.find((p) => overlaps(p, rect));
      hit;
      hit = placed.find((p) => overlaps(p, rect))
    ) {
      rect = { ...rect, y: hit.y + hit.h };
    }
    placed.push(rect);
    rects.set(other.id, rect);
  }

  return entries
    .filter((e) => !sameRect(rects.get(e.id) as GridRect, e.grid))
    .map((e) => ({ id: e.id, grid: rects.get(e.id) as GridRect }));
}
