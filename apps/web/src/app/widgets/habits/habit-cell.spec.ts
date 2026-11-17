import { tabStopDay } from './habit-cell';
import type { Cell } from './habit-cell';

function cell(day: string, beforeStart: boolean): Cell {
  return {
    day,
    weekday: 'MO',
    done: false,
    expected: true,
    beforeStart,
    today: false,
    label: day,
  };
}

describe('tabStopDay', () => {
  const cells = [cell('2026-11-15', true), cell('2026-11-16', false), cell('2026-11-17', false)];

  it('keeps the stored day while it is usable', () => {
    expect(tabStopDay(cells, '2026-11-16', '2026-11-17')).toBe('2026-11-16');
  });

  it('falls back to today when the stored day is unusable or absent', () => {
    expect(tabStopDay(cells, '2026-11-15', '2026-11-17')).toBe('2026-11-17');
    expect(tabStopDay(cells, undefined, '2026-11-17')).toBe('2026-11-17');
  });

  it('falls back to the last usable cell when today is not usable', () => {
    expect(tabStopDay(cells.slice(0, 2), undefined, '2026-11-17')).toBe('2026-11-16');
  });

  it('matches no cell when nothing is usable (nothing focusable)', () => {
    const none = [cell('2026-11-16', true), cell('2026-11-17', true)];
    expect(tabStopDay(none, undefined, '2026-11-17')).toBe('2026-11-17');
  });
});
