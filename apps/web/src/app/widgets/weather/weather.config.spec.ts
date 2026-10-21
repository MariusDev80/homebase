import * as v from 'valibot';
import { toWeatherLocation, weatherConfigSchema, weatherDefaults } from './weather.config';

const location = {
  name: 'Amiens',
  region: 'Hauts-de-France',
  country: 'France',
  latitude: 49.9,
  longitude: 2.3,
};

describe('weatherConfigSchema', () => {
  it('accepts the defaults and a configured location', () => {
    expect(v.safeParse(weatherConfigSchema, weatherDefaults()).success).toBe(true);
    expect(weatherDefaults()).toEqual({ location: null, days: 5 });
    expect(v.safeParse(weatherConfigSchema, { location, days: 7 }).success).toBe(true);
  });

  it.each([0, 8, 2.5])('refuses days = %s', (days) => {
    expect(v.safeParse(weatherConfigSchema, { location: null, days }).success).toBe(false);
  });

  it.each([
    ['latitude 91', { ...location, latitude: 91 }],
    ['longitude -181', { ...location, longitude: -181 }],
    ['empty name', { ...location, name: '  ' }],
    ['201-character name', { ...location, name: 'a'.repeat(201) }],
  ])('refuses %s', (_label, bad) => {
    expect(v.safeParse(weatherConfigSchema, { location: bad, days: 5 }).success).toBe(false);
  });

  it('drops unknown keys', () => {
    const parsed = v.parse(weatherConfigSchema, { location: null, days: 5, extra: 1 });
    expect(parsed).toEqual({ location: null, days: 5 });
  });
});

describe('toWeatherLocation', () => {
  it('keeps the display fields and coordinates, without the id', () => {
    const result = toWeatherLocation({ id: 3037854, ...location });
    expect(result).toEqual(location);
    expect('id' in result).toBe(false);
  });
});
