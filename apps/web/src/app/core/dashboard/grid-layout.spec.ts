import type { WidgetSizeConstraints } from '../widgets/widget-definition';
import { applyNudge, nudgeRect } from './grid-layout';
import type { LayoutEntry } from './grid-layout';

const constraints: WidgetSizeConstraints = {
  min: { w: 2, h: 2 },
  default: { w: 3, h: 2 },
  max: { w: 4, h: 3 },
};

const entry = (id: string, x: number, y: number, w = 3, h = 2): LayoutEntry => ({
  id,
  grid: { x, y, w, h },
  constraints,
});

describe('nudgeRect', () => {
  it('moves by one cell', () => {
    expect(nudgeRect({ x: 1, y: 1, w: 3, h: 2 }, { dx: 1, dy: 1 }, constraints)).toEqual({
      x: 2,
      y: 2,
      w: 3,
      h: 2,
    });
  });

  it('stays within the columns and above row 0', () => {
    expect(nudgeRect({ x: 9, y: 0, w: 3, h: 2 }, { dx: 1 }, constraints).x).toBe(9);
    expect(nudgeRect({ x: 0, y: 0, w: 3, h: 2 }, { dx: -1, dy: -1 }, constraints)).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  it('bounds a resize to the min and max of the definition', () => {
    expect(nudgeRect({ x: 0, y: 0, w: 4, h: 3 }, { dw: 1, dh: 1 }, constraints)).toMatchObject({
      w: 4,
      h: 3,
    });
    expect(nudgeRect({ x: 0, y: 0, w: 2, h: 2 }, { dw: -1, dh: -1 }, constraints)).toMatchObject({
      w: 2,
      h: 2,
    });
  });

  it('keeps the right edge inside the columns when widening', () => {
    expect(nudgeRect({ x: 10, y: 0, w: 2, h: 2 }, { dw: 1 }, constraints)).toMatchObject({
      x: 9,
      w: 3,
    });
  });
});

describe('applyNudge', () => {
  it('returns nothing when the move is blocked', () => {
    expect(applyNudge([entry('a', 0, 0)], 'a', { dx: -1 })).toEqual([]);
    expect(applyNudge([entry('a', 0, 0)], 'missing', { dx: 1 })).toEqual([]);
  });

  it('returns only the moved item when nothing is hit', () => {
    expect(applyNudge([entry('a', 0, 0), entry('b', 6, 0)], 'a', { dx: 1 })).toEqual([
      { id: 'a', grid: { x: 1, y: 0, w: 3, h: 2 } },
    ]);
  });

  it('pushes overlapped items down, chained', () => {
    const result = applyNudge(
      [entry('a', 0, 0), entry('b', 0, 2), entry('c', 0, 4), entry('d', 8, 0)],
      'a',
      { dy: 1 },
    );
    expect(result).toEqual([
      { id: 'a', grid: { x: 0, y: 1, w: 3, h: 2 } },
      { id: 'b', grid: { x: 0, y: 3, w: 3, h: 2 } },
      { id: 'c', grid: { x: 0, y: 5, w: 3, h: 2 } },
    ]);
  });
});
