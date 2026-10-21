import type { InstantIso, LocalDateIso } from '../../data';

export interface WeatherCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface WeatherPlace extends WeatherCoordinates {
  readonly id: number;
  readonly name: string;
  readonly region: string | null;
  readonly country: string | null;
}

export interface WeatherCurrent {
  readonly temperatureC: number;
  readonly apparentTemperatureC: number | null;
  readonly relativeHumidityPct: number | null;
  readonly windSpeedKmh: number | null;
  readonly weatherCode: number;
  readonly isDay: boolean;
}

export interface WeatherDay {
  readonly date: LocalDateIso;
  readonly weatherCode: number | null;
  readonly temperatureMaxC: number | null;
  readonly temperatureMinC: number | null;
  readonly precipitationProbabilityPct: number | null;
}

export interface WeatherForecast {
  readonly timeZone: string;
  readonly current: WeatherCurrent;
  readonly daily: readonly WeatherDay[];
}

/** fetchedAt: instant of reception read from CLOCK (never the model's own time). */
export interface WeatherSnapshot {
  readonly forecast: WeatherForecast;
  readonly fetchedAt: InstantIso;
}

export type WeatherLanguage = 'fr' | 'en';
