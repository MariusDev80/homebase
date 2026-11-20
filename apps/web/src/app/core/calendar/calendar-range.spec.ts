import { DataError } from '../../data';
import { addDays, startOfDay } from '../time';
import { MAX_CALENDAR_RANGE_DAYS, assertCalendarRange, rangeLocalDates } from './calendar-range';
import type { CalendarRange } from './calendar-source';

const PARIS = 'Europe/Paris';

function days(first: string, last: string, timeZone: string): CalendarRange {
  return {
    from: startOfDay(first, timeZone),
    to: startOfDay(addDays(last, 1), timeZone),
    timeZone,
  };
}

describe('rangeLocalDates', () => {
  it('gives the 42 days of the month grid of November 2026 in Paris', () => {
    const range = days('2026-10-26', '2026-12-06', PARIS);
    expect(range.from).toBe('2026-10-25T23:00:00.000Z');
    expect(range.to).toBe('2026-12-06T23:00:00.000Z');
    expect(rangeLocalDates(range)).toEqual({ firstOn: '2026-10-26', lastOn: '2026-12-06' });
  });

  it('starts at 01:00 local on the day of the non-existent midnight (L3, Santiago)', () => {
    const range = days('2026-09-06', '2026-09-08', 'America/Santiago');
    expect(range.from).toBe('2026-09-06T04:00:00.000Z');
    expect(rangeLocalDates(range)).toEqual({ firstOn: '2026-09-06', lastOn: '2026-09-08' });
  });

  it('covers every day that overlaps a range not aligned on midnight', () => {
    const range: CalendarRange = {
      from: '2026-11-18T22:30:00.000Z', // 23:30 on the 18th in Paris
      to: '2026-11-19T23:00:00.000Z', // exactly midnight of the 20th: excluded
      timeZone: PARIS,
    };
    expect(rangeLocalDates(range)).toEqual({ firstOn: '2026-11-18', lastOn: '2026-11-19' });
    expect(rangeLocalDates({ ...range, to: '2026-11-19T23:00:00.001Z' }).lastOn).toBe('2026-11-20');
  });

  it('reads the dates in the range zone, not in UTC', () => {
    const range: CalendarRange = {
      from: '2026-11-18T01:00:00.000Z',
      to: '2026-11-18T02:00:00.000Z',
      timeZone: 'America/Santiago', // UTC-3: the 17th
    };
    expect(rangeLocalDates(range)).toEqual({ firstOn: '2026-11-17', lastOn: '2026-11-17' });
  });

  it('ends on the previous day when `to` is the (shifted) start of a Santiago day', () => {
    const to = startOfDay('2026-09-06', 'America/Santiago');
    const range: CalendarRange = {
      from: startOfDay('2026-09-04', 'America/Santiago'),
      to,
      timeZone: 'America/Santiago',
    };
    expect(rangeLocalDates(range).lastOn).toBe('2026-09-05');
  });

  it('covers the 25-hour day of the end of summer time in Paris (2026-10-25)', () => {
    const range = days('2026-10-25', '2026-10-25', PARIS);
    expect(range).toMatchObject({
      from: '2026-10-24T22:00:00.000Z',
      to: '2026-10-25T23:00:00.000Z',
    });
    expect(rangeLocalDates(range)).toEqual({ firstOn: '2026-10-25', lastOn: '2026-10-25' });
  });
});

describe('assertCalendarRange', () => {
  function kindOf(range: CalendarRange): string {
    try {
      assertCalendarRange(range);
    } catch (e) {
      if (e instanceof DataError) return e.kind;
      throw e;
    }
    return 'no error';
  }

  it('accepts 62 days and refuses 63', () => {
    expect(MAX_CALENDAR_RANGE_DAYS).toBe(62);
    expect(kindOf(days('2026-11-01', '2027-01-01', PARIS))).toBe('no error');
    expect(kindOf(days('2026-11-01', '2027-01-02', PARIS))).toBe('invalid_input');
  });

  it('refuses 62 x 24 h not aligned on midnight, which covers 63 local days', () => {
    const range: CalendarRange = {
      from: '2026-11-01T09:00:00.000Z', // 10:00 in Paris
      to: '2027-01-02T09:00:00.000Z', // 62 x 24 h later
      timeZone: PARIS,
    };
    expect(rangeLocalDates(range)).toEqual({ firstOn: '2026-11-01', lastOn: '2027-01-02' });
    expect(kindOf(range)).toBe('invalid_input');
  });

  it('refuses from >= to', () => {
    const range = days('2026-11-01', '2026-11-02', PARIS);
    expect(kindOf({ ...range, to: range.from })).toBe('invalid_input');
    expect(kindOf({ ...range, from: range.to, to: range.from })).toBe('invalid_input');
  });

  it('refuses an unknown zone and invalid instants', () => {
    const range = days('2026-11-01', '2026-11-02', PARIS);
    expect(kindOf({ ...range, timeZone: 'Mars/Olympus' })).toBe('invalid_input');
    expect(kindOf({ ...range, from: 'yesterday' })).toBe('invalid_input');
    expect(kindOf({ ...range, to: '2026-11-03' })).toBe('invalid_input');
  });
});
