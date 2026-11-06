import type { GridsterConfig, GridsterItemConfig } from 'angular-gridster2';
import type { GridRect, LayoutItem } from '../../data';
import { GRID_COLUMNS, GRID_ROWS } from '../widgets/grid';
import type { WidgetSizeConstraints } from '../widgets/widget-definition';

/**
 * Only file (with the dashboard component) that knows angular-gridster2: everything else works
 * with GridRect / WidgetSizeConstraints (ADR-001 section 3.9).
 */

/** Gap between cells in px (1rem). Rows and columns share the grid area equally (gridType fit). */
export const GRID_GAP = 16;
export const DRAG_HANDLE_CLASS = 'widget-drag-handle';

/** Gridster item carrying the instance id (gridster mutates it in place on drag/resize). */
export type DashboardGridItem = GridsterItemConfig & { id: string };

/** Constraints of a type the registry does not know: only the grid bounds apply. */
export function fallbackConstraints(grid: GridRect): WidgetSizeConstraints {
  const size = {
    w: Math.min(GRID_COLUMNS, Math.max(1, grid.w || 1)),
    h: Math.min(GRID_ROWS, Math.max(1, grid.h || 1)),
  };
  return {
    min: { w: 1, h: 1 },
    default: size,
    max: { w: GRID_COLUMNS, h: GRID_ROWS },
  };
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
  /** Called by gridster, once per item whose x/y/cols/rows changed (dragged, resized or pushed). */
  readonly onItemChange: (item: DashboardGridItem) => void;
  /** Called by draggable.start and resizable.start (diagnostic: gridster must not move items alone). */
  readonly onInteractionStart: () => void;
}

export function buildGridOptions(params: GridOptionsParams): GridsterConfig {
  const { onItemChange, onInteractionStart } = params;
  return {
    gridType: 'fit',
    // No inline width/height written at each layout (the grid fills its area, see the CSS).
    setGridSize: false,
    minCols: GRID_COLUMNS,
    maxCols: GRID_COLUMNS,
    minRows: GRID_ROWS,
    maxRows: GRID_ROWS,
    // Global item bounds: the real limits are per item (minItem* / maxItem*).
    minItemCols: 1,
    minItemRows: 1,
    maxItemCols: GRID_COLUMNS,
    maxItemRows: GRID_ROWS,
    margin: GRID_GAP,
    outerMargin: false,
    // Read by enableBoundaryControl only: 0 = the exact edge of the grid.
    outerMarginTop: 0,
    outerMarginRight: 0,
    outerMarginBottom: 0,
    outerMarginLeft: 0,
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
    // A dragged or resized widget stays inside the grid.
    enableBoundaryControl: true,
    disableScrollVertical: true,
    disableScrollHorizontal: true,
    addEmptyRowsCount: 0,
    draggable: {
      enabled: true,
      ignoreContent: true,
      dragHandleClass: DRAG_HANDLE_CLASS,
      start: () => onInteractionStart(),
    },
    resizable: {
      enabled: true,
      handles: {
        s: false,
        e: false,
        n: false,
        w: false,
        se: true,
        ne: false,
        sw: false,
        nw: false,
      },
      start: () => onInteractionStart(),
    },
    itemChangeCallback: (item) => {
      if (isDashboardGridItem(item)) onItemChange(item);
    },
  };
}
