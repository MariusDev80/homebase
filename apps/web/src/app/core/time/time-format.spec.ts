import { TimeError } from './time-error';
import {
  formatInstant,
  formatLocalDate,
  formatLocalDateTime,
  isValidInstant,
  isValidLocalDate,
  isValidLocalDateTime,
  normalizeInstant,
  parseInstant,
  parseLocalDate,
  parseLocalDateTime,
} from './time-format';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof TimeError) return e.code;
    throw e;
  }
  return 'no error';
}

describe('time-format', () => {
  it('C27: normalises a strict RFC 3339 offset instant to Z', () => {
    expect(normalizeInstant('2026-10-20T10:15:00+02:00')).toBe('2026-10-20T08:15:00.000Z');
    expect(normalizeInstant('2026-10-20T08:15:00Z')).toBe('2026-10-20T08:15:00.000Z');
    expect(normalizeInstant('2026-10-20T08:15:00.123456789Z')).toBe('2026-10-20T08:15:00.123Z');
  });

  it('C27: refuses non RFC 3339 instants', () => {
    for (const bad of [
      '2026-10-20 10:15:00Z',
      '2026-10-20T10:15Z',
      '2026-10-20t10:15:00z',
      '2026-10-20T10:15:00+0200',
      '2026-10-20T10:15:00Z[Europe/Paris]',
      '2026-10-20T10:15:00,5Z',
      '20261020T101500Z',
      '2026-10-25T24:00:00.000Z',
      '2026-12-31T23:59:60Z',
    ]) {
      expect(
        codeOf(() => normalizeInstant(bad)),
        bad,
      ).toBe('invalid_instant');
    }
  });

  it('parseInstant only accepts the stored form', () => {
    expect(formatInstant(parseInstant('2026-10-25T00:30:00.123Z'))).toBe(
      '2026-10-25T00:30:00.123Z',
    );
    expect(codeOf(() => parseInstant('2026-10-20T08:15:00Z'))).toBe('invalid_instant');
    expect(codeOf(() => parseInstant('2026-10-25T24:00:00.000Z'))).toBe('invalid_instant');
    expect(isValidInstant('2026-10-25T00:30:00.000Z')).toBe(true);
    expect(isValidInstant('x')).toBe(false);
  });

  it('C28: invalid dates and date-times', () => {
    for (const bad of ['2026-02-29', '2026-13-01', '2026-2-1']) {
      expect(
        codeOf(() => parseLocalDate(bad)),
        bad,
      ).toBe('invalid_local_date');
      expect(isValidLocalDate(bad)).toBe(false);
    }
    for (const bad of ['2026-10-25T24:00:00', '2026-12-31T23:59:60', '2026-02-30T10:00:00']) {
      expect(
        codeOf(() => parseLocalDateTime(bad)),
        bad,
      ).toBe('invalid_local_date_time');
      expect(isValidLocalDateTime(bad)).toBe(false);
    }
  });

  it('C29: out of range', () => {
    expect(codeOf(() => parseLocalDate('1899-12-31'))).toBe('out_of_range');
    expect(codeOf(() => parseLocalDate('2200-01-01'))).toBe('out_of_range');
    expect(codeOf(() => parseLocalDateTime('2200-01-01T00:00:00'))).toBe('out_of_range');
    expect(codeOf(() => parseInstant('2200-01-01T00:00:00.000Z'))).toBe('out_of_range');
    expect(codeOf(() => normalizeInstant('1899-12-31T23:59:59Z'))).toBe('out_of_range');
    expect(isValidLocalDate('1900-01-01')).toBe(true);
    expect(isValidLocalDate('2199-12-31')).toBe(true);
  });

  it('C36: formatInstant truncates', () => {
    expect(formatInstant(parseInstant('2026-10-20T08:15:30.999Z'))).toBe(
      '2026-10-20T08:15:30.999Z',
    );
    expect(normalizeInstant('2026-10-20T08:15:30.9999Z')).toBe('2026-10-20T08:15:30.999Z');
  });

  it('round trips format(parse(x)) === x', () => {
    expect(formatLocalDate(parseLocalDate('2028-02-29'))).toBe('2028-02-29');
    expect(formatLocalDateTime(parseLocalDateTime('2026-10-25T02:30:00'))).toBe(
      '2026-10-25T02:30:00',
    );
    expect(formatInstant(parseInstant('2026-10-25T00:30:00.000Z'))).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
});
