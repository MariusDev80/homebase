import type { WidgetSizeConstraints } from '../widgets/widget-definition';
import {
  boundGrid,
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

  it('bounds the displayed rect to the constraints and the columns', () => {
    expect(boundGrid({ x: 11, y: 0, w: 9, h: 9 }, constraints)).toEqual({ x: 6, y: 0, w: 6, h: 5 });
    expect(boundGrid({ x: 0, y: 0, w: 1, h: 1 }, constraints)).toEqual({ x: 0, y: 0, w: 2, h: 1 });
  });

  it('only bounds an unknown type to the grid', () => {
    const grid = { x: 10, y: 1, w: 30, h: 99 };
    expect(boundGrid(grid, undefined)).toEqual({ x: 0, y: 1, w: 12, h: 24 });
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

    it('enables drag and resize only while editing', () => {
      const off = buildGridOptions({ editing: false, onItemChange });
      const on = buildGridOptions({ editing: true, onItemChange });
      expect([off.draggable?.enabled, off.resizable?.enabled]).toEqual([false, false]);
      expect([on.draggable?.enabled, on.resizable?.enabled]).toEqual([true, true]);
    });

    it('keeps 12 columns and starts drags from the handle only', () => {
      const options = buildGridOptions({ editing: true, onItemChange });
      expect([options.minCols, options.maxCols]).toEqual([12, 12]);
      expect(options.draggable?.ignoreContent).toBe(true);
      expect(options.draggable?.dragHandleClass).toBe('widget-drag-handle');
    });

    it('forwards only items carrying an instance id', () => {
      const options = buildGridOptions({ editing: true, onItemChange });
      const item = toGridsterItem('a', { x: 0, y: 0, w: 2, h: 2 }, constraints);
      options.itemChangeCallback?.(item, undefined as never);
      options.itemChangeCallback?.({ x: 0, y: 0, cols: 1, rows: 1 }, undefined as never);
      expect(onItemChange).toHaveBeenCalledTimes(1);
      expect(onItemChange).toHaveBeenCalledWith(item);
    });
  });
});
