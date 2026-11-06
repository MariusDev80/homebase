import type { GridRect } from '../../data';
import { rectsOverlap } from '../widgets/grid';
import type { WidgetSizeConstraints } from '../widgets/widget-definition';
import { applyNudge, fitLayout, nudgeRect } from './grid-layout';
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

  it('refuses a resize that would move the origin', () => {
    const origin = { x: 10, y: 0, w: 2, h: 2 };
    expect(nudgeRect(origin, { dw: 1 }, constraints)).toEqual(origin);
    const bottom = { x: 0, y: 6, w: 3, h: 2 };
    expect(nudgeRect(bottom, { dh: 1 }, constraints)).toEqual(bottom);
  });

  it('stays above the last row when moving', () => {
    expect(nudgeRect({ x: 0, y: 6, w: 3, h: 2 }, { dy: 1 }, constraints).y).toBe(6);
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

  it('refuses the whole move when a pushed item would leave the 8 rows', () => {
    const result = applyNudge(
      [entry('a', 0, 0), entry('b', 0, 2), entry('c', 0, 4), entry('d', 0, 6)],
      'a',
      { dy: 1 },
    );
    expect(result).toEqual([]);
  });
});

describe('fitLayout', () => {
  const min22: WidgetSizeConstraints = {
    min: { w: 2, h: 2 },
    default: { w: 4, h: 3 },
    max: { w: 12, h: 8 },
  };
  const e = (id: string, x: number, y: number, w: number, h: number): LayoutEntry => ({
    id,
    grid: { x, y, w, h },
    constraints: min22,
  });
  const run = (entries: LayoutEntry[]) => {
    const result = fitLayout(entries);
    return { placed: Object.fromEntries(result.placed), unplaced: result.unplaced };
  };
  const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

  it('handles an empty input', () => {
    expect(run([])).toEqual({ placed: {}, unplaced: [] });
  });

  it('keeps a valid layout', () => {
    expect(run([e('a', 0, 0, 4, 3), e('b', 4, 0, 4, 3)])).toEqual({
      placed: { a: r(0, 0, 4, 3), b: r(4, 0, 4, 3) },
      unplaced: [],
    });
  });

  it('moves widgets below row 8 into the free space (example of D3)', () => {
    const entries = [
      e('a', 0, 0, 4, 3),
      e('b', 0, 3, 4, 3),
      e('c', 0, 6, 4, 3),
      e('d', 0, 9, 4, 3),
    ];
    expect(run(entries)).toEqual({
      placed: { a: r(0, 0, 4, 3), b: r(0, 3, 4, 3), c: r(4, 0, 4, 3), d: r(8, 0, 4, 3) },
      unplaced: [],
    });
    // B removed: the stored layout of the displayed one keeps C and D where they were shown.
    expect(run([e('a', 0, 0, 4, 3), e('c', 4, 0, 4, 3), e('d', 8, 0, 4, 3)]).placed).toEqual({
      a: r(0, 0, 4, 3),
      c: r(4, 0, 4, 3),
      d: r(8, 0, 4, 3),
    });
  });

  it('bounds a too tall widget', () => {
    expect(run([e('a', 0, 6, 4, 12)]).placed).toEqual({ a: r(0, 0, 4, 8) });
  });

  it('brings a widget back inside the columns', () => {
    expect(run([e('a', 11, 0, 4, 3)]).placed).toEqual({ a: r(8, 0, 4, 3) });
  });

  it('raises the height to the minimum and moves the neighbour', () => {
    expect(run([e('a', 0, 0, 2, 1), e('b', 0, 1, 2, 2)]).placed).toEqual({
      a: r(0, 0, 2, 2),
      b: r(2, 0, 2, 2),
    });
  });

  it('leaves a widget without room unplaced', () => {
    expect(run([e('a', 0, 0, 12, 8), e('b', 0, 8, 2, 2)])).toEqual({
      placed: { a: r(0, 0, 12, 8) },
      unplaced: ['b'],
    });
  });

  it('places 24 of 25 widgets of 2x2 stacked at 0,0', () => {
    const entries = Array.from({ length: 25 }, (_, i) => e('w' + i, 0, 0, 2, 2));
    const result = fitLayout(entries);
    expect(result.placed.size).toBe(24);
    expect(result.unplaced).toEqual(['w24']);
  });

  it('shrinks a widget to its place', () => {
    expect(run([e('a', 0, 0, 6, 8), e('b', 0, 0, 6, 8)]).placed).toEqual({
      a: r(0, 0, 6, 8),
      b: r(6, 0, 6, 8),
    });
    expect(run([e('a', 0, 0, 8, 8), e('b', 0, 0, 8, 8)]).placed).toEqual({
      a: r(0, 0, 8, 8),
      b: r(8, 0, 4, 8),
    });
  });

  it('is deterministic, idempotent and never overlaps (1000 random layouts)', () => {
    let seed = 12345;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 1000; round++) {
      const entries = Array.from({ length: 1 + random(10) }, (_, i) =>
        e('w' + i, random(14), random(20), 2 + random(6), 1 + random(10)),
      );
      const first = fitLayout(entries);
      const again = fitLayout(entries);
      expect([...again.placed]).toEqual([...first.placed]);
      expect(again.unplaced).toEqual(first.unplaced);

      const rects = [...first.placed.values()];
      rects.forEach((a, i) =>
        rects.slice(i + 1).forEach((b) => expect(rectsOverlap(a, b)).toBe(false)),
      );
      expect(first.placed.size + first.unplaced.length).toBe(entries.length);

      const own = fitLayout(
        entries
          .filter((x) => first.placed.has(x.id))
          .map((x) => ({ ...x, grid: first.placed.get(x.id) as GridRect })),
      );
      expect(Object.fromEntries(own.placed)).toEqual(Object.fromEntries(first.placed));
    }
  });
});
