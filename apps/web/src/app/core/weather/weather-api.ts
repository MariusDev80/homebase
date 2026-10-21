import { InjectionToken } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../../tauri-runtime';
import { WeatherError } from './weather-error';
import type { WeatherLanguage } from './weather.types';

/** Raw access to the Rust commands; payloads are unvalidated (see weather.schemas.ts). */
export interface WeatherApi {
  forecast(latitude: number, longitude: number): Promise<unknown>;
  geocode(query: string, language: WeatherLanguage): Promise<unknown>;
}

/** The only place that invokes `weather_forecast` / `weather_geocode`. */
export const WEATHER_API = new InjectionToken<WeatherApi>('WEATHER_API', {
  providedIn: 'root',
  factory: (): WeatherApi => ({
    forecast: (latitude, longitude) => {
      if (!isTauriRuntime()) {
        return Promise.reject(new WeatherError('unavailable'));
      }
      return invoke('weather_forecast', { latitude, longitude });
    },
    geocode: (query, language) => {
      if (!isTauriRuntime()) {
        return Promise.reject(new WeatherError('unavailable'));
      }
      return invoke('weather_geocode', { query, language });
    },
  }),
});
