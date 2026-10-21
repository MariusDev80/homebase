import type { InstantIso, LocalDateIso } from '../../data';
import { addDuration } from '../../core/time';
import type { WeatherDay, WeatherPlace } from '../../core/weather';
import {
  ageMessage,
  dayKind,
  locationLabel,
  placeLabels,
  roundValue,
  visibleDays,
} from './weather-format';

const T0 = '2026-10-21T10:00:00.000Z' as InstantIso;
const at = (ms: number) => addDuration(T0, ms);
const MIN = 60_000;

describe('ageMessage', () => {
  it.each([
    [0, { kind: 'just-now' }],
    [59_000, { kind: 'just-now' }],
    [60_000, { kind: 'minutes', minutes: 1 }],
    [60 * MIN - 1000, { kind: 'minutes', minutes: 59 }],
    [60 * MIN, { kind: 'hours', hours: 1 }],
    [24 * 60 * MIN - 60_000, { kind: 'hours', hours: 23 }],
    [24 * 60 * MIN, { kind: 'date' }],
    [-5 * MIN, { kind: 'just-now' }],
  ])('age %s ms', (ms, expected) => {
    expect(ageMessage(T0, at(ms))).toEqual(expected);
  });
});

describe('roundValue', () => {
  it('rounds and normalises -0', () => {
    expect(Object.is(roundValue(-0.4), 0)).toBe(true);
    expect(roundValue(12.5)).toBe(13);
    expect(roundValue(12.8)).toBe(13);
    expect(roundValue(-3.6)).toBe(-4);
  });
});

const place = (over: Partial<WeatherPlace>): WeatherPlace => ({
  id: 1,
  name: 'Amiens',
  region: 'Hauts-de-France',
  country: 'France',
  latitude: 49.9,
  longitude: 2.3,
  ...over,
});

describe('placeLabels', () => {
  it('omits absent parts', () => {
    expect(
      placeLabels([
        place({}),
        place({ id: 2, name: 'B', region: null }),
        place({ id: 3, name: 'C', country: null }),
        place({ id: 4, name: 'D', region: null, country: null }),
      ]),
    ).toEqual(['Amiens, Hauts-de-France (France)', 'B (France)', 'C, Hauts-de-France', 'D']);
  });

  it('suffixes identical labels with the coordinates', () => {
    const labels = placeLabels([
      place({ id: 1, name: 'Saint-Denis', latitude: 48.936, longitude: 2.357 }),
      place({ id: 2, name: 'Saint-Denis', latitude: -20.88, longitude: 55.45 }),
      place({ id: 3, name: 'Autre' }),
    ]);
    expect(labels).toEqual([
      'Saint-Denis, Hauts-de-France (France) · 48,94 ; 2,36',
      'Saint-Denis, Hauts-de-France (France) · -20,88 ; 55,45',
      'Autre, Hauts-de-France (France)',
    ]);
  });
});

describe('locationLabel', () => {
  it('formats a stored location', () => {
    expect(
      locationLabel({ name: 'Paris', region: null, country: 'France', latitude: 0, longitude: 0 }),
    ).toBe('Paris (France)');
  });
});

describe('visibleDays and dayKind', () => {
  const day = (date: string): WeatherDay => ({
    date: date as LocalDateIso,
    weatherCode: 0,
    temperatureMaxC: 1,
    temperatureMinC: 0,
    precipitationProbabilityPct: null,
  });
  const daily = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map(day);

  it('drops past days and caps the count', () => {
    const today = '2026-10-21' as LocalDateIso;
    expect(visibleDays(daily, today, 5).map((d) => d.date)).toEqual([
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
    expect(visibleDays(daily, today, 2)).toHaveLength(2);
    expect(visibleDays(daily, '2026-11-01' as LocalDateIso, 5)).toEqual([]);
  });

  it('classifies days', () => {
    const today = '2026-10-21' as LocalDateIso;
    expect(dayKind('2026-10-21' as LocalDateIso, today)).toBe('today');
    expect(dayKind('2026-10-22' as LocalDateIso, today)).toBe('tomorrow');
    expect(dayKind('2026-10-23' as LocalDateIso, today)).toBe('weekday');
  });
});
