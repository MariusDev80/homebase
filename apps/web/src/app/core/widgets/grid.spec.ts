import { GRID_ROWS, clampGrid, nextFreePosition, rectsOverlap } from './grid';
import type { WidgetSizeConstraints } from './widget-definition';

const constraints: WidgetSizeConstraints = {
  min: { w: 2, h: 1 },
  default: { w: 3, h: 2 },
  max: { w: 6, h: 4 },
};

describe('clampGrid', () => {
  it('keeps a valid rect untouched', () => {
    expect(clampGrid({ x: 1, y: 2, w: 3, h: 2 }, constraints)).toEqual({ x: 1, y: 2, w: 3, h: 2 });
  });

  it('moves x back so the widget fits in the columns', () => {
    expect(clampGrid({ x: 11, y: 0, w: 3, h: 2 }, constraints).x).toBe(9);
  });

  it('raises w and h to the minimum', () => {
    expect(clampGrid({ x: 0, y: 0, w: 1, h: 0 }, constraints)).toMatchObject({ w: 2, h: 1 });
  });

  it('lowers w and h to the maximum', () => {
    expect(clampGrid({ x: 0, y: 0, w: 9, h: 9 }, constraints)).toMatchObject({ w: 6, h: 4 });
  });

  it('bounds negative values', () => {
    expect(clampGrid({ x: -3, y: -1, w: -2, h: -2 }, constraints)).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 1,
    });
  });

  it('floors non-integers', () => {
    expect(clampGrid({ x: 1.9, y: 2.7, w: 3.9, h: 2.1 }, constraints)).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 2,
    });
  });

  it('maps NaN to min (w/h) and 0 (x/y)', () => {
    expect(clampGrid({ x: NaN, y: NaN, w: NaN, h: NaN }, constraints)).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 1,
    });
  });
});

describe('clampGrid rows', () => {
  it('bounds y so the widget stays within GRID_ROWS', () => {
    expect(clampGrid({ x: 0, y: 20, w: 3, h: 2 }, constraints).y).toBe(GRID_ROWS - 2);
  });

  it('never lets h exceed GRID_ROWS, even when the definition allows more', () => {
    const tall = { ...constraints, max: { w: 6, h: 12 } };
    expect(clampGrid({ x: 0, y: 0, w: 3, h: 12 }, tall)).toMatchObject({ y: 0, h: 8 });
  });
});

describe('rectsOverlap', () => {
  it('detects overlap and treats shared edges as free', () => {
    const a = { x: 0, y: 0, w: 2, h: 2 };
    expect(rectsOverlap(a, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(rectsOverlap(a, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 2, w: 2, h: 2 })).toBe(false);
  });
});

describe('nextFreePosition', () => {
  it('starts at 0,0 when empty', () => {
    expect(nextFreePosition([], { w: 3, h: 2 })).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it('scans rows then columns', () => {
    const existing = [{ x: 0, y: 0, w: 2, h: 2 }];
    expect(nextFreePosition(existing, { w: 2, h: 2 })).toEqual({ x: 2, y: 0, w: 2, h: 2 });
  });

  it('reuses a hole', () => {
    const existing = [
      { x: 0, y: 0, w: 12, h: 2 },
      { x: 0, y: 2, w: 4, h: 2 },
      { x: 8, y: 2, w: 4, h: 2 },
    ];
    expect(nextFreePosition(existing, { w: 4, h: 2 })).toEqual({ x: 4, y: 2, w: 4, h: 2 });
  });

  it('shrinks w then h down to the minimum when the preferred size does not fit', () => {
    const existing = [{ x: 0, y: 0, w: 10, h: 8 }];
    expect(nextFreePosition(existing, { w: 6, h: 4 }, { w: 2, h: 2 })).toEqual({
      x: 10,
      y: 0,
      w: 2,
      h: 4,
    });
  });

  it('returns null when nothing fits', () => {
    const existing = [{ x: 0, y: 0, w: 12, h: 8 }];
    expect(nextFreePosition(existing, { w: 2, h: 2 })).toBeNull();
    expect(nextFreePosition([{ x: 0, y: 0, w: 11, h: 8 }], { w: 2, h: 2 })).toBeNull();
  });
});
