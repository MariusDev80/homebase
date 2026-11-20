import { durationParts, formatClock } from './duration-format';

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [5000, '0:05'],
    [272000, '4:32'],
    [3599000, '59:59'],
    [3600000, '1:00:00'],
    [3723000, '1:02:03'],
    [-5000, '0:00'],
    [Number.NaN, '0:00'],
  ])('floor: %i ms reads %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });

  it('rounds the seconds up for a countdown', () => {
    expect(formatClock(4001, 'ceil')).toBe('0:05');
    expect(formatClock(4001, 'floor')).toBe('0:04');
    expect(formatClock(5000, 'ceil')).toBe('0:05');
    expect(formatClock(1, 'ceil')).toBe('0:01');
    expect(formatClock(-1, 'ceil')).toBe('0:00');
  });
});

describe('durationParts', () => {
  it('splits a duration', () => {
    expect(durationParts(((1 * 24 + 2) * 60 + 3) * 60 * 1000 + 4500)).toEqual({
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
    });
  });

  it('gives zeros for a negative or null duration', () => {
    expect(durationParts(-1)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(durationParts(0)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});
