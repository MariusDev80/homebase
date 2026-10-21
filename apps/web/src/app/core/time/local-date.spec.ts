import { TimeError } from './time-error';
import { addDays, compareLocalDates, daysBetween } from './local-date';

describe('local-date', () => {
  it('daysBetween', () => {
    expect(daysBetween('2026-10-20', '2026-10-19')).toBe(-1);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2026-10-20', '2026-10-20')).toBe(0);
  });

  it('addDays at month end and leap years', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('addDays rejects non-integers and out-of-range results', () => {
    expect(() => addDays('2026-01-01', 1.5)).toThrow(TimeError);
    expect(() => addDays('2026-01-01', Number.NaN)).toThrow(TimeError);
    expect(() => addDays('2199-12-31', 1)).toThrow(TimeError);
  });

  it('compareLocalDates', () => {
    expect(compareLocalDates('2026-10-19', '2026-10-20')).toBe(-1);
    expect(compareLocalDates('2026-10-20', '2026-10-20')).toBe(0);
    expect(compareLocalDates('2026-10-21', '2026-10-20')).toBe(1);
  });
});
