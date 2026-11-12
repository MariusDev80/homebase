import { fakeForecastPayload } from '../testing/fake-weather-api';
import { WeatherError, toWeatherError } from './weather-error';
import { parseForecastPayload, parsePlacesPayload } from './weather.schemas';

const place = (overrides: Record<string, unknown> = {}) => ({
  id: 3037854,
  name: 'Amiens',
  region: 'Hauts-de-France',
  country: 'France',
  latitude: 49.9,
  longitude: 2.3,
  ...overrides,
});

interface MutableDay {
  date: string;
  weatherCode: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  precipitationProbabilityPct: number | null;
}

interface Payload {
  timeZone: string;
  extra?: number;
  current: {
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    weatherCode: number;
    extra?: number;
  };
  daily: MutableDay[];
}

function forecastWith(mutate: (payload: Payload) => void): unknown {
  const payload = fakeForecastPayload() as unknown as Payload;
  mutate(payload);
  return payload;
}

function kindOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof WeatherError ? error.kind : 'not-a-weather-error';
  }
  return undefined;
}

describe('parseForecastPayload', () => {
  it('accepts a valid payload', () => {
    const forecast = parseForecastPayload(fakeForecastPayload());
    expect(forecast.timeZone).toBe('Europe/Paris');
    expect(forecast.current.temperatureC).toBe(12.8);
    expect(forecast.daily).toHaveLength(3);
  });

  it('accepts null optional values', () => {
    const payload = forecastWith((p) => {
      p.current.apparentTemperatureC = null;
      p.daily[0].weatherCode = null;
      p.daily[0].temperatureMaxC = null;
    });
    expect(parseForecastPayload(payload).daily[0].weatherCode).toBeNull();
  });

  it('strips unknown keys', () => {
    const payload = forecastWith((p) => {
      p.extra = 1;
      p.current.extra = 2;
    });
    const forecast = parseForecastPayload(payload);
    expect(forecast).not.toHaveProperty('extra');
    expect(forecast.current).not.toHaveProperty('extra');
  });

  it.each([
    ['current weatherCode 3.5', (p: Payload) => (p.current.weatherCode = 3.5)],
    ['current weatherCode 100', (p: Payload) => (p.current.weatherCode = 100)],
    ['daily weatherCode 100', (p: Payload) => (p.daily[0].weatherCode = 100)],
    ['impossible date', (p: Payload) => (p.daily[0].date = '2026-02-30')],
    ['empty daily', (p: Payload) => (p.daily = [])],
    [
      '17 days',
      (p: Payload) => {
        p.daily = Array.from({ length: 17 }, (_, i) => ({
          date: `2026-11-${String(i + 1).padStart(2, '0')}`,
          weatherCode: 1,
          temperatureMaxC: 1,
          temperatureMinC: 0,
          precipitationProbabilityPct: 0,
        }));
      },
    ],
    ['null temperature', (p: Payload) => (p.current.temperatureC = null)],
    ['temperature out of bounds', (p: Payload) => (p.current.temperatureC = 101)],
    ['non increasing dates', (p: Payload) => (p.daily[1].date = '2026-10-21')],
    ['empty time zone', (p: Payload) => (p.timeZone = '')],
  ])('rejects %s with invalid_response', (_label, mutate) => {
    expect(kindOf(() => parseForecastPayload(forecastWith(mutate)))).toBe('invalid_response');
  });

  it('rejects non-objects', () => {
    expect(kindOf(() => parseForecastPayload(null))).toBe('invalid_response');
    expect(kindOf(() => parseForecastPayload('x'))).toBe('invalid_response');
  });
});

describe('parsePlacesPayload', () => {
  it('accepts valid places and nullable region/country', () => {
    const places = parsePlacesPayload([place(), place({ id: 2, region: null, country: null })]);
    expect(places).toHaveLength(2);
    expect(places[1].region).toBeNull();
  });

  it('accepts an empty list', () => {
    expect(parsePlacesPayload([])).toEqual([]);
  });

  it('strips unknown keys', () => {
    expect(parsePlacesPayload([place({ extra: 1 })])[0]).not.toHaveProperty('extra');
  });

  it('rejects more than 10 places', () => {
    const many = Array.from({ length: 11 }, (_, i) => place({ id: i }));
    expect(kindOf(() => parsePlacesPayload(many))).toBe('invalid_response');
  });

  it.each([
    ['empty name', place({ name: '' })],
    ['name over 200 characters', place({ name: 'a'.repeat(201) })],
    ['latitude out of bounds', place({ latitude: 91 })],
    ['negative id', place({ id: -1 })],
  ])('rejects %s', (_label, entry) => {
    expect(kindOf(() => parsePlacesPayload([entry]))).toBe('invalid_response');
  });

  it('rejects duplicate ids', () => {
    expect(kindOf(() => parsePlacesPayload([place(), place()]))).toBe('invalid_response');
  });
});

describe('toWeatherError', () => {
  it('keeps a WeatherError as is', () => {
    const error = new WeatherError('throttled', { retryAfterMs: 5 });
    expect(toWeatherError(error)).toBe(error);
  });

  it('maps upstream_status with its status', () => {
    const error = toWeatherError({ kind: 'upstream_status', status: 429 });
    expect(error.kind).toBe('upstream_status');
    expect(error.status).toBe(429);
  });

  it('maps invalid_input with its field', () => {
    const error = toWeatherError({ kind: 'invalid_input', field: 'query' });
    expect(error.kind).toBe('invalid_input');
    expect(error.field).toBe('query');
  });

  it.each([
    'client_unavailable',
    'forbidden',
    'network',
    'timeout',
    'too_large',
    'invalid_response',
  ])('maps %s', (kind) => {
    expect(toWeatherError({ kind }).kind).toBe(kind);
  });

  it.each([
    ['front-only kind', { kind: 'throttled' }],
    ['unknown kind', { kind: 'nope' }],
    ['missing field', { kind: 'invalid_input' }],
    ['string', 'invalid args'],
    ['Error', new Error('boom')],
    ['null', null],
  ])('maps %s to unknown', (_label, input) => {
    expect(toWeatherError(input).kind).toBe('unknown');
  });
});
