import { addMonths, startOfMonth } from './month';
import { TimeError } from './time-error';

describe('month', () => {
  it('startOfMonth', () => {
    expect(startOfMonth('2026-11-18')).toBe('2026-11-01');
    expect(startOfMonth('2026-11-01')).toBe('2026-11-01');
    expect(startOfMonth('2028-02-29')).toBe('2028-02-01');
  });

  it('addMonths clamps to the end of a shorter month and crosses years', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-01', 1)).toBe('2026-12-01');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-11-18', 0)).toBe('2026-11-18');
  });

  it('addMonths rejects non-integers and out-of-range results', () => {
    expect(() => addMonths('2026-01-01', 0.5)).toThrow(TimeError);
    expect(() => addMonths('2199-12-01', 1)).toThrow(TimeError);
  });
});
