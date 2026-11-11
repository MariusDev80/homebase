import {
  DATE_RULE_INTERVAL_MAX,
  formatDateRule,
  isLastDayOfMonth,
  nextOccurrenceAfter,
  nextRepeatDue,
  parseDateRule,
  type DateRule,
} from './date-rule';
import { TimeError } from './time-error';

const daily: DateRule = { freq: 'DAILY', interval: 1, lastDayOfMonth: false };

describe('parseDateRule / formatDateRule', () => {
  it.each([
    ['FREQ=DAILY', { freq: 'DAILY', interval: 1, lastDayOfMonth: false }],
    ['FREQ=WEEKLY;INTERVAL=2', { freq: 'WEEKLY', interval: 2, lastDayOfMonth: false }],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', { freq: 'MONTHLY', interval: 1, lastDayOfMonth: true }],
    [
      'FREQ=MONTHLY;INTERVAL=11;BYMONTHDAY=-1',
      { freq: 'MONTHLY', interval: 11, lastDayOfMonth: true },
    ],
    ['FREQ=YEARLY;INTERVAL=10', { freq: 'YEARLY', interval: 10, lastDayOfMonth: false }],
    ['FREQ=DAILY;INTERVAL=366', { freq: 'DAILY', interval: 366, lastDayOfMonth: false }],
  ])('round-trips %s', (text, rule) => {
    expect(parseDateRule(text)).toEqual(rule);
    expect(formatDateRule(rule as DateRule)).toBe(text);
  });

  it.each([
    '',
    'FREQ=HOURLY',
    'freq=daily',
    'FREQ=DAILY;INTERVAL=1',
    'FREQ=DAILY;INTERVAL=0',
    'FREQ=DAILY;INTERVAL=367',
    'FREQ=WEEKLY;INTERVAL=53',
    'FREQ=MONTHLY;INTERVAL=12',
    'FREQ=YEARLY;INTERVAL=11',
    'FREQ=DAILY;INTERVAL=02',
    'FREQ=DAILY;BYMONTHDAY=-1',
    'FREQ=MONTHLY;BYMONTHDAY=15',
    'FREQ=MONTHLY;BYMONTHDAY=-1;INTERVAL=2',
    'FREQ=WEEKLY;BYDAY=MO',
    'FREQ=DAILY;COUNT=3',
    'FREQ=DAILY;',
    ' FREQ=DAILY',
  ])('refuses %j', (text) => {
    expect(parseDateRule(text)).toBeNull();
  });

  it('refuses a rule outside the subset when formatting', () => {
    const bad: DateRule[] = [
      { freq: 'DAILY', interval: 0, lastDayOfMonth: false },
      { freq: 'DAILY', interval: 1.5, lastDayOfMonth: false },
      { freq: 'YEARLY', interval: DATE_RULE_INTERVAL_MAX.YEARLY + 1, lastDayOfMonth: false },
      { freq: 'WEEKLY', interval: 1, lastDayOfMonth: true },
    ];
    for (const rule of bad) {
      expect(() => formatDateRule(rule)).toThrowError(TimeError);
      try {
        formatDateRule(rule);
      } catch (e) {
        expect((e as TimeError).code).toBe('invalid_rule');
      }
    }
  });
});

describe('nextOccurrenceAfter', () => {
  it('never returns the anchor when after is the anchor', () => {
    expect(nextOccurrenceAfter('2026-11-10', daily, '2026-11-10')).toBe('2026-11-11');
  });

  it('returns the anchor when after precedes it', () => {
    expect(nextOccurrenceAfter('2026-11-16', daily, '2026-11-01')).toBe('2026-11-16');
  });

  it('returns null at the upper bound without throwing', () => {
    expect(nextOccurrenceAfter('2199-12-31', daily, '2199-12-31')).toBeNull();
    expect(
      nextOccurrenceAfter(
        '2199-12-30',
        { freq: 'MONTHLY', interval: 1, lastDayOfMonth: true },
        '2199-12-31',
      ),
    ).toBeNull();
    expect(
      nextOccurrenceAfter(
        '2199-03-01',
        { freq: 'YEARLY', interval: 1, lastDayOfMonth: false },
        '2199-12-31',
      ),
    ).toBeNull();
  });

  it('returns the last representable date when it is an occurrence', () => {
    expect(nextOccurrenceAfter('2199-12-30', daily, '2199-12-30')).toBe('2199-12-31');
  });

  it('throws TimeError on an invalid anchor or after', () => {
    expect(() => nextOccurrenceAfter('2026-02-30', daily, '2026-11-10')).toThrowError(TimeError);
    expect(() => nextOccurrenceAfter('2026-11-10', daily, '2026-13-01')).toThrowError(TimeError);
  });
});

describe('nextRepeatDue', () => {
  it('uses max(due, today) as the reference', () => {
    expect(nextRepeatDue('2026-11-05', daily, '2026-11-10')).toBe('2026-11-11');
    expect(nextRepeatDue('2026-11-16', daily, '2026-11-10')).toBe('2026-11-17');
  });
});

describe('isLastDayOfMonth', () => {
  it.each([
    ['2026-01-31', true],
    ['2026-02-28', true],
    ['2028-02-28', false],
    ['2028-02-29', true],
    ['2026-04-30', true],
    ['2026-04-29', false],
  ])('%s -> %s', (date, expected) => {
    expect(isLastDayOfMonth(date)).toBe(expected);
  });
});
