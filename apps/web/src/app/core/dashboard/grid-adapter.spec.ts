import type { WidgetSizeConstraints } from '../widgets/widget-definition';
import {
  buildGridOptions,
  fallbackConstraints,
  fromGridsterItem,
  sameGridsterItem,
  toGridsterItem,
} from './grid-adapter';

const constraints: WidgetSizeConstraints = {
  min: { w: 2, h: 1 },
  default: { w: 4, h: 2 },
  max: { w: 6, h: 5 },
};

describe('grid adapter', () => {
  it('converts a GridRect and constraints to a gridster item', () => {
    expect(toGridsterItem('a', { x: 1, y: 2, w: 3, h: 4 }, constraints)).toEqual({
      id: 'a',
      x: 1,
      y: 2,
      cols: 3,
      rows: 4,
      minItemCols: 2,
      maxItemCols: 6,
      minItemRows: 1,
      maxItemRows: 5,
    });
  });

  it('converts a gridster item back to a LayoutItem', () => {
    const item = toGridsterItem('a', { x: 1, y: 2, w: 3, h: 4 }, constraints);
    item.x = 5;
    item.rows = 2;
    expect(fromGridsterItem(item)).toEqual({ id: 'a', grid: { x: 5, y: 2, w: 3, h: 2 } });
  });

  it('round-trips a rect', () => {
    const grid = { x: 0, y: 7, w: 6, h: 5 };
    expect(fromGridsterItem(toGridsterItem('a', grid, constraints)).grid).toEqual(grid);
  });

  it('bounds an unknown type to the grid (12 x 8 at most)', () => {
    const grid = { x: 10, y: 1, w: 30, h: 99 };
    expect(fallbackConstraints(grid).max).toEqual({ w: 12, h: 8 });
    expect(fallbackConstraints(grid).default).toEqual({ w: 12, h: 8 });
    expect(fallbackConstraints(grid).min).toEqual({ w: 1, h: 1 });
  });

  it('detects equal and different items', () => {
    const a = toGridsterItem('a', { x: 0, y: 0, w: 2, h: 2 }, constraints);
    expect(sameGridsterItem(a, { ...a })).toBe(true);
    expect(sameGridsterItem(a, { ...a, maxItemCols: 3 })).toBe(false);
    expect(sameGridsterItem(a, { ...a, y: 1 })).toBe(false);
  });

  describe('grid options', () => {
    const onItemChange = vi.fn();
    const onInteractionStart = vi.fn();

    it('always enables drag and resize', () => {
      const on = buildGridOptions({ onItemChange, onInteractionStart });
      expect([on.draggable?.enabled, on.resizable?.enabled]).toEqual([true, true]);
    });

    it('keeps 12 columns and starts drags from the handle only', () => {
      const options = buildGridOptions({ onItemChange, onInteractionStart });
      expect([options.minCols, options.maxCols]).toEqual([12, 12]);
      expect(options.draggable?.ignoreContent).toBe(true);
      expect(options.draggable?.dragHandleClass).toBe('widget-drag-handle');
    });

    it('fits 12 x 8 cells in the area without writing a size or scrolling', () => {
      const options = buildGridOptions({ onItemChange, onInteractionStart });
      expect(options.gridType).toBe('fit');
      expect([options.minRows, options.maxRows]).toEqual([8, 8]);
      expect(options.setGridSize).toBe(false);
      expect(options.addEmptyRowsCount).toBe(0);
      expect([options.disableScrollVertical, options.disableScrollHorizontal]).toEqual([
        true,
        true,
      ]);
      expect(options.outerMargin).toBe(false);
      expect([
        options.outerMarginTop,
        options.outerMarginRight,
        options.outerMarginBottom,
        options.outerMarginLeft,
      ]).toEqual([0, 0, 0, 0]);
    });

    it('keeps only the south-east resize handle', () => {
      const options = buildGridOptions({ onItemChange, onInteractionStart });
      expect(options.resizable?.handles).toEqual({
        s: false,
        e: false,
        n: false,
        w: false,
        se: true,
        ne: false,
        sw: false,
        nw: false,
      });
    });

    it('reports the start of a drag or a resize', () => {
      const options = buildGridOptions({ onItemChange, onInteractionStart });
      options.draggable?.start?.({} as never, {} as never, {} as never);
      options.resizable?.start?.({} as never, {} as never, {} as never);
      expect(onInteractionStart).toHaveBeenCalledTimes(2);
    });

    it('keeps dragged and resized widgets inside the grid', () => {
      const options = buildGridOptions({ onItemChange, onInteractionStart });
      expect(options.enableBoundaryControl).toBe(true);
    });

    it('forwards only items carrying an instance id', () => {
      const options = buildGridOptions({ onItemChange, onInteractionStart });
      const item = toGridsterItem('a', { x: 0, y: 0, w: 2, h: 2 }, constraints);
      options.itemChangeCallback?.(item, undefined as never);
      options.itemChangeCallback?.({ x: 0, y: 0, cols: 1, rows: 1 }, undefined as never);
      expect(onItemChange).toHaveBeenCalledTimes(1);
      expect(onItemChange).toHaveBeenCalledWith(item);
    });
  });
});
