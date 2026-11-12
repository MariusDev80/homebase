import type { WeatherApi } from '../weather/weather-api';
import type { WeatherLanguage } from '../weather/weather.types';

type Outcome = { readonly value: unknown } | { readonly error: unknown };

interface Deferred {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/** A valid forecast payload (spec section 4.2), three days from 2026-10-21. */
export function fakeForecastPayload(): Record<string, unknown> {
  return {
    timeZone: 'Europe/Paris',
    current: {
      temperatureC: 12.8,
      apparentTemperatureC: 9.7,
      relativeHumidityPct: 74,
      windSpeedKmh: 18.1,
      weatherCode: 3,
      isDay: true,
    },
    daily: [
      {
        date: '2026-10-21',
        weatherCode: 80,
        temperatureMaxC: 14.9,
        temperatureMinC: 8.4,
        precipitationProbabilityPct: 35,
      },
      {
        date: '2026-10-22',
        weatherCode: 80,
        temperatureMaxC: 15.5,
        temperatureMinC: 9,
        precipitationProbabilityPct: 25,
      },
      {
        date: '2026-10-23',
        weatherCode: 61,
        temperatureMaxC: 13.7,
        temperatureMinC: 9.9,
        precipitationProbabilityPct: 91,
      },
    ],
  };
}

/**
 * Programmable WeatherApi. A call takes the next queued outcome; when none is queued it stays pending until
 * `resolveNext` / `rejectNext` settles the oldest pending call.
 */
export class FakeWeatherApi implements WeatherApi {
  readonly forecastCalls: { latitude: number; longitude: number }[] = [];
  readonly geocodeCalls: { query: string; language: WeatherLanguage }[] = [];

  private readonly forecastOutcomes: Outcome[] = [];
  private readonly geocodeOutcomes: Outcome[] = [];
  private readonly pending: Deferred[] = [];

  get callCount(): number {
    return this.forecastCalls.length + this.geocodeCalls.length;
  }

  respondForecast(value: unknown): void {
    this.forecastOutcomes.push({ value });
  }

  failForecast(error: unknown): void {
    this.forecastOutcomes.push({ error });
  }

  respondGeocode(value: unknown): void {
    this.geocodeOutcomes.push({ value });
  }

  failGeocode(error: unknown): void {
    this.geocodeOutcomes.push({ error });
  }

  resolveNext(value: unknown): void {
    this.pending.shift()?.resolve(value);
  }

  rejectNext(error: unknown): void {
    this.pending.shift()?.reject(error);
  }

  forecast(latitude: number, longitude: number): Promise<unknown> {
    this.forecastCalls.push({ latitude, longitude });
    return this.answer(this.forecastOutcomes);
  }

  geocode(query: string, language: WeatherLanguage): Promise<unknown> {
    this.geocodeCalls.push({ query, language });
    return this.answer(this.geocodeOutcomes);
  }

  private answer(queue: Outcome[]): Promise<unknown> {
    const outcome = queue.shift();
    if (outcome) {
      return 'error' in outcome ? Promise.reject(outcome.error) : Promise.resolve(outcome.value);
    }
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
  }
}
