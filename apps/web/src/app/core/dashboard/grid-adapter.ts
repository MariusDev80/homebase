import type { GridsterConfig, GridsterItemConfig } from 'angular-gridster2';
import type { GridRect, LayoutItem } from '../../data';
import { GRID_COLUMNS, GRID_MAX_ROWS, clampGrid } from '../widgets/grid';
import type { WidgetSizeConstraints } from '../widgets/widget-definition';
import { GRID_MAX_TOTAL_ROWS } from './grid-layout';

/**
 * Only file (with the dashboard component) that knows angular-gridster2: everything else works
 * with GridRect / WidgetSizeConstraints (ADR-001 section 3.9).
 */

/** Row height in px (6rem) and gap in px (1rem), as the former CSS Grid layout. */
export const GRID_ROW_HEIGHT = 96;
export const GRID_GAP = 16;
export const DRAG_HANDLE_CLASS = 'widget-drag-handle';

/** Gridster item carrying the instance id (gridster mutates it in place on drag/resize). */
export type DashboardGridItem = GridsterItemConfig & { id: string };

/** Constraints of a type the registry does not know: only the grid bounds apply. */
export function fallbackConstraints(grid: GridRect): WidgetSizeConstraints {
  const size = { w: Math.max(1, grid.w || 1), h: Math.max(1, grid.h || 1) };
  return {
    min: { w: 1, h: 1 },
    default: size,
    max: { w: GRID_COLUMNS, h: GRID_MAX_ROWS },
  };
}

/** Rect shown on the grid: clamped to the constraints (never written back by itself). */
export function boundGrid(
  grid: GridRect,
  constraints: WidgetSizeConstraints | undefined,
): GridRect {
  return clampGrid(grid, constraints ?? fallbackConstraints(grid));
}

export function toGridsterItem(
  id: string,
  grid: GridRect,
  constraints: WidgetSizeConstraints,
): DashboardGridItem {
  return {
    id,
    x: grid.x,
    y: grid.y,
    cols: grid.w,
    rows: grid.h,
    minItemCols: constraints.min.w,
    maxItemCols: constraints.max.w,
    minItemRows: constraints.min.h,
    maxItemRows: constraints.max.h,
  };
}

export function isDashboardGridItem(item: GridsterItemConfig): item is DashboardGridItem {
  return typeof item['id'] === 'string';
}

export function fromGridsterItem(item: DashboardGridItem): LayoutItem {
  return { id: item.id, grid: { x: item.x, y: item.y, w: item.cols, h: item.rows } };
}

export function sameGridsterItem(a: GridsterItemConfig, b: GridsterItemConfig): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.minItemCols === b.minItemCols &&
    a.maxItemCols === b.maxItemCols &&
    a.minItemRows === b.minItemRows &&
    a.maxItemRows === b.maxItemRows
  );
}

export interface GridOptionsParams {
  /** Drag and resize are enabled only while editing. */
  readonly editing: boolean;
  /** Called by gridster, once per item whose x/y/cols/rows changed (dragged, resized or pushed). */
  readonly onItemChange: (item: DashboardGridItem) => void;
}

export function buildGridOptions(params: GridOptionsParams): GridsterConfig {
  const { editing, onItemChange } = params;
  return {
    gridType: 'verticalFixed',
    fixedRowHeight: GRID_ROW_HEIGHT,
    // For the height only: the items are absolute, so the grid would collapse without it. The width
    // gridster sets with it grows at each layout and is overridden in dashboard.component.css.
    setGridSize: true,
    minCols: GRID_COLUMNS,
    maxCols: GRID_COLUMNS,
    minRows: 1,
    maxRows: GRID_MAX_TOTAL_ROWS,
    // Global item bounds: the real limits are per item (minItem* / maxItem*).
    minItemCols: 1,
    minItemRows: 1,
    maxItemCols: GRID_COLUMNS,
    maxItemRows: GRID_MAX_ROWS,
    margin: GRID_GAP,
    outerMargin: false,
    // Keep the 12-column layout at any window width (no stacked "mobile" mode).
    mobileBreakpoint: 0,
    compactType: 'none',
    displayGrid: 'none',
    pushItems: true,
    disablePushOnDrag: false,
    disablePushOnResize: false,
    pushResizeItems: false,
    swap: false,
    scrollToNewItems: false,
    // A dragged or resized widget stays inside the grid (no horizontal overflow of the page).
    enableBoundaryControl: true,
    addEmptyRowsCount: editing ? 2 : 0,
    draggable: {
      enabled: editing,
      ignoreContent: true,
      dragHandleClass: DRAG_HANDLE_CLASS,
    },
    resizable: { enabled: editing },
    itemChangeCallback: (item) => {
      if (isDashboardGridItem(item)) onItemChange(item);
    },
  };
}
