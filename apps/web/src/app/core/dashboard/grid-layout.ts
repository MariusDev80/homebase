import type { GridRect, LayoutItem } from '../../data';
import { GRID_ROWS, clampGrid, nextFreePosition, rectsOverlap } from '../widgets/grid';
import type { WidgetSizeConstraints } from '../widgets/widget-definition';

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

/**
 * Applies the delta then bounds the result to the constraints, the columns and the rows. A resize
 * never moves the origin: if bounding would change x or y, the original rect is returned (refused).
 */
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
  const resizing = delta.dw !== undefined || delta.dh !== undefined;
  if (resizing && (next.x !== grid.x + (delta.dx ?? 0) || next.y !== grid.y + (delta.dy ?? 0))) {
    return grid;
  }
  return next;
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
      let hit = placed.find((p) => rectsOverlap(p, rect));
      hit;
      hit = placed.find((p) => rectsOverlap(p, rect))
    ) {
      rect = { ...rect, y: hit.y + hit.h };
    }
    // A pushed element would leave the grid: the whole move is refused.
    if (rect.y + rect.h > GRID_ROWS) return [];
    placed.push(rect);
    rects.set(other.id, rect);
  }

  return entries
    .filter((e) => !sameRect(rects.get(e.id) as GridRect, e.grid))
    .map((e) => ({ id: e.id, grid: rects.get(e.id) as GridRect }));
}

export interface FittedLayout {
  /** Displayed rect by instance id. */
  readonly placed: ReadonlyMap<string, GridRect>;
  /** Ids without room, in input order. */
  readonly unplaced: readonly string[];
}

/**
 * Rects to display, computed from the stored ones (pure, deterministic, idempotent). Entries are
 * expected in the order of WidgetInstanceRepository.listByDashboard.
 * Pass 1: a widget whose bounded rect keeps its x/y and hits nothing placed stays as is.
 * Pass 2, in order: the others take their bounded rect if free, else the first free spot (shrinking
 * down to the minimum size); without room they are unplaced and occupy nothing.
 */
export function fitLayout(entries: readonly LayoutEntry[]): FittedLayout {
  const placed = new Map<string, GridRect>();
  const taken: GridRect[] = [];
  const aside: { entry: LayoutEntry; bounded: GridRect }[] = [];

  for (const entry of entries) {
    const bounded = clampGrid(entry.grid, entry.constraints);
    if (
      bounded.x === entry.grid.x &&
      bounded.y === entry.grid.y &&
      !taken.some((rect) => rectsOverlap(rect, bounded))
    ) {
      placed.set(entry.id, bounded);
      taken.push(bounded);
    } else {
      aside.push({ entry, bounded });
    }
  }

  const unplacedIds = new Set<string>();
  for (const { entry, bounded } of aside) {
    const rect = taken.some((other) => rectsOverlap(other, bounded))
      ? nextFreePosition(taken, { w: bounded.w, h: bounded.h }, entry.constraints.min)
      : bounded;
    if (rect) {
      placed.set(entry.id, rect);
      taken.push(rect);
    } else {
      unplacedIds.add(entry.id);
    }
  }

  return { placed, unplaced: entries.filter((e) => unplacedIds.has(e.id)).map((e) => e.id) };
}
