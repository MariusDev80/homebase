import { TimeError } from './time-error';
import {
  addDuration,
  classifyLocal,
  durationBetween,
  isValidTimeZone,
  normalizeTimeZone,
  resolveLocal,
  startOfDay,
  toLocalDate,
  toLocalDateTime,
  todayIn,
  untilEndOfLocalDay,
} from './zoned';
import { ManualClock } from './testing/manual-clock';

const PARIS = 'Europe/Paris';

describe('zoned', () => {
  it('section 3.3 table: resolveLocal', () => {
    const rows: [string, string][] = [
      ['2026-10-25T02:30:00', '2026-10-25T00:30:00.000Z'],
      ['2026-10-25T02:00:00', '2026-10-25T00:00:00.000Z'],
      ['2026-10-25T01:59:59', '2026-10-24T23:59:59.000Z'],
      ['2026-10-25T03:00:00', '2026-10-25T02:00:00.000Z'],
      ['2027-03-28T02:30:00', '2027-03-28T01:30:00.000Z'],
      ['2027-03-28T02:00:00', '2027-03-28T01:00:00.000Z'],
      ['2027-03-28T03:00:00', '2027-03-28T01:00:00.000Z'],
    ];
    for (const [local, instant] of rows) {
      expect(resolveLocal(local, PARIS), local).toBe(instant);
    }
  });

  it('toLocalDateTime and toLocalDate', () => {
    expect(toLocalDateTime('2026-10-25T01:30:00.000Z', PARIS)).toBe('2026-10-25T02:30:00');
    expect(toLocalDateTime('2026-10-20T08:15:30.999Z', 'UTC')).toBe('2026-10-20T08:15:30');
    expect(toLocalDate('2026-12-31T23:30:00.000Z', PARIS)).toBe('2027-01-01');
  });

  it('classifyLocal', () => {
    expect(classifyLocal('2026-10-25T02:30:00', PARIS)).toBe('fold');
    expect(classifyLocal('2027-03-28T02:30:00', PARIS)).toBe('gap');
    expect(classifyLocal('2026-10-25T09:00:00', PARIS)).toBe('unique');
  });

  it('C22 and C23: startOfDay on 25h/23h days and a missing midnight', () => {
    expect(startOfDay('2026-10-25', PARIS)).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfDay('2026-10-26', PARIS)).toBe('2026-10-25T23:00:00.000Z');
    expect(startOfDay('2027-03-28', PARIS)).toBe('2027-03-27T23:00:00.000Z');
    expect(startOfDay('2026-09-06', 'America/Santiago')).toBe('2026-09-06T04:00:00.000Z');
  });

  it('untilEndOfLocalDay', () => {
    expect(untilEndOfLocalDay('2026-12-31', PARIS)).toBe('20261231T225959Z');
  });

  it('C25: durations across the fold', () => {
    const end = addDuration('2026-10-25T00:50:00.000Z', 25 * 60_000);
    expect(end).toBe('2026-10-25T01:15:00.000Z');
    expect(toLocalDateTime(end, PARIS)).toBe('2026-10-25T02:15:00');
    expect(durationBetween('2026-10-25T00:50:00.000Z', end)).toBe(25 * 60_000);
    expect(durationBetween(end, '2026-10-25T00:50:00.000Z')).toBe(-25 * 60_000);
  });

  it('todayIn reads the injected clock', () => {
    const clock = new ManualClock('2026-12-31T23:30:00.000Z');
    expect(todayIn(clock, PARIS)).toBe('2027-01-01');
    expect(todayIn(clock, 'America/New_York')).toBe('2026-12-31');
  });

  it('C38 and invalid zones: normalizeTimeZone', () => {
    expect(normalizeTimeZone('europe/paris')).toBe('Europe/Paris');
    expect(normalizeTimeZone('Asia/Calcutta')).toBe('Asia/Calcutta');
    expect(normalizeTimeZone('UTC')).toBe('UTC');
    for (const bad of ['Mars/Base', '+02', '+02:00', 'Etc/Unknown', '']) {
      expect(normalizeTimeZone(bad), bad).toBeNull();
      expect(isValidTimeZone(bad)).toBe(false);
    }
  });

  it('rejects an unknown zone with TimeError', () => {
    expect(() => resolveLocal('2026-10-25T02:30:00', 'Mars/Base')).toThrow(TimeError);
  });
});
