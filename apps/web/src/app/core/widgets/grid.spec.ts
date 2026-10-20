import { clampGrid, nextFreePosition } from './grid';
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

describe('nextFreePosition', () => {
  it('starts at 0,0 when empty', () => {
    expect(nextFreePosition([], { w: 3, h: 2 })).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it('goes below the lowest existing rect', () => {
    const existing = [
      { x: 0, y: 0, w: 3, h: 2 },
      { x: 4, y: 1, w: 3, h: 4 },
    ];
    expect(nextFreePosition(existing, { w: 3, h: 2 })).toEqual({ x: 0, y: 5, w: 3, h: 2 });
  });
});
