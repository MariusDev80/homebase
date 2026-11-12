import {
  hasInstantShape,
  hasLocalDateShape,
  hasLocalDateTimeShape,
  hasTimeZoneIdShape,
} from './time-formats';

describe('time formats', () => {
  it('accepts and refuses instants by shape and bounds', () => {
    expect(hasInstantShape('2026-10-25T00:30:00.000Z')).toBe(true);
    expect(hasInstantShape('1900-01-01T00:00:00.000Z')).toBe(true);
    expect(hasInstantShape('2199-12-31T23:59:59.999Z')).toBe(true);
    for (const bad of [
      '2026-10-25T00:30:00Z',
      '2026-10-25T00:30:00.000+02:00',
      '2026-10-25 00:30:00.000Z',
      '1899-12-31T23:59:59.999Z',
      '2200-01-01T00:00:00.000Z',
      'x',
    ]) {
      expect(hasInstantShape(bad), bad).toBe(false);
    }
  });

  it('accepts and refuses local dates by shape and bounds', () => {
    expect(hasLocalDateShape('2026-11-03')).toBe(true);
    expect(hasLocalDateShape('1900-01-01')).toBe(true);
    expect(hasLocalDateShape('2199-12-31')).toBe(true);
    for (const bad of ['2026-2-1', '1899-12-31', '2200-01-01', '2026-11-03T00:00:00', 'x']) {
      expect(hasLocalDateShape(bad), bad).toBe(false);
    }
  });

  it('accepts and refuses local date-times by shape and bounds', () => {
    expect(hasLocalDateTimeShape('2026-10-25T02:30:00')).toBe(true);
    for (const bad of [
      '2026-10-25 02:30:00',
      '2026-10-25T02:30',
      '2026-10-25T02:30:00+02:00',
      '2026-10-25T02:30:00Z',
      '1899-12-31T23:59:59',
      '2200-01-01T00:00:00',
      'x',
    ]) {
      expect(hasLocalDateTimeShape(bad), bad).toBe(false);
    }
  });

  it('checks the time zone identifier shape', () => {
    for (const ok of ['Europe/Paris', 'Etc/GMT+5', 'UTC', 'EST5EDT']) {
      expect(hasTimeZoneIdShape(ok), ok).toBe(true);
    }
    for (const bad of [
      '+02',
      '+02:00',
      '-03',
      'Etc/Unknown',
      'etc/unknown',
      '../etc',
      'Europe/ Paris',
      '',
      `A${'a'.repeat(64)}`,
    ]) {
      expect(hasTimeZoneIdShape(bad), bad).toBe(false);
    }
  });
});
