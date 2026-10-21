import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { CLOCK } from '../../data';
import type { InstantIso } from '../../data';
import { durationBetween } from '../time';
import { WidgetContext, assertWidgetPermission } from '../widgets';
import { WEATHER_API } from './weather-api';
import { WeatherError, toWeatherError } from './weather-error';
import { parseForecastPayload, parsePlacesPayload } from './weather.schemas';
import type {
  WeatherCoordinates,
  WeatherLanguage,
  WeatherPlace,
  WeatherSnapshot,
} from './weather.types';

export const WEATHER_MAX_AGE_MS = 30 * 60 * 1000;
export const WEATHER_MIN_RETRY_MS = 60 * 1000;
export const WEATHER_CACHE_MAX_ENTRIES = 20;
export const PLACE_QUERY_MIN_CHARS = 2;
export const PLACE_QUERY_MAX_CHARS = 100;

type WeatherContext = Pick<WidgetContext, 'type' | 'permissions'>;

export interface ForecastOptions {
  /** Ignores cache freshness AND the minimum retry delay (Retry / Refresh buttons). */
  readonly force?: boolean;
  /** Ignores only the minimum retry delay (component timer, `online` event, location change). */
  readonly ignoreRetryDelay?: boolean;
}

function cacheKey(at: WeatherCoordinates): string {
  return `${at.latitude.toFixed(4)},${at.longitude.toFixed(4)}`;
}

function invalidField(at: WeatherCoordinates): 'latitude' | 'longitude' | null {
  if (!Number.isFinite(at.latitude) || Math.abs(at.latitude) > 90) return 'latitude';
  if (!Number.isFinite(at.longitude) || Math.abs(at.longitude) > 180) return 'longitude';
  return null;
}

/** In-memory weather cache and the only gateway to the weather commands (permission `network`). */
@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly api = inject(WEATHER_API);
  private readonly clock = inject(CLOCK);
  private readonly transloco = inject(TranslocoService);

  private readonly snapshots = new Map<string, WeatherSnapshot>();
  private readonly inflight = new Map<string, Promise<WeatherSnapshot>>();
  /** Instant of the last failed attempt, per location. */
  private readonly failures = new Map<string, InstantIso>();

  /** Last snapshot for these coordinates, without network access. */
  cached(ctx: WeatherContext, at: WeatherCoordinates): WeatherSnapshot | null {
    assertWidgetPermission(ctx, 'network');
    if (invalidField(at) !== null) {
      return null;
    }
    return this.snapshots.get(cacheKey(at)) ?? null;
  }

  async forecast(
    ctx: WeatherContext,
    at: WeatherCoordinates,
    options: ForecastOptions = {},
  ): Promise<WeatherSnapshot> {
    assertWidgetPermission(ctx, 'network');
    const field = invalidField(at);
    if (field !== null) {
      throw new WeatherError('invalid_input', { field });
    }
    const key = cacheKey(at);
    const now = this.clock.nowIso();

    if (!options.force) {
      const snapshot = this.snapshots.get(key);
      if (snapshot && !this.failures.has(key)) {
        const age = durationBetween(snapshot.fetchedAt, now);
        if (age >= 0 && age < WEATHER_MAX_AGE_MS) {
          return snapshot;
        }
      }
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }

    if (!options.force && !options.ignoreRetryDelay) {
      const failedAt = this.failures.get(key);
      if (failedAt !== undefined) {
        const elapsed = durationBetween(failedAt, now);
        if (elapsed >= 0 && elapsed < WEATHER_MIN_RETRY_MS) {
          throw new WeatherError('throttled', { retryAfterMs: WEATHER_MIN_RETRY_MS - elapsed });
        }
      }
    }

    const request = this.fetchForecast(key, at).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  async searchPlaces(ctx: WeatherContext, query: string): Promise<readonly WeatherPlace[]> {
    assertWidgetPermission(ctx, 'network');
    const trimmed = query.trim();
    const length = [...trimmed].length;
    if (length < PLACE_QUERY_MIN_CHARS) {
      return [];
    }
    if (length > PLACE_QUERY_MAX_CHARS) {
      throw new WeatherError('invalid_input', { field: 'query' });
    }
    const active = this.transloco.getActiveLang();
    const language: WeatherLanguage = active === 'fr' || active === 'en' ? active : 'fr';
    let raw: unknown;
    try {
      raw = await this.api.geocode(trimmed, language);
    } catch (error) {
      throw toWeatherError(error);
    }
    return parsePlacesPayload(raw);
  }

  private async fetchForecast(key: string, at: WeatherCoordinates): Promise<WeatherSnapshot> {
    try {
      const raw = await this.api.forecast(at.latitude, at.longitude);
      const snapshot: WeatherSnapshot = {
        forecast: parseForecastPayload(raw),
        fetchedAt: this.clock.nowIso(),
      };
      this.snapshots.delete(key);
      this.snapshots.set(key, snapshot);
      while (this.snapshots.size > WEATHER_CACHE_MAX_ENTRIES) {
        const oldest = this.snapshots.keys().next();
        if (oldest.done) break;
        this.snapshots.delete(oldest.value);
      }
      this.failures.delete(key);
      return snapshot;
    } catch (error) {
      this.failures.delete(key);
      this.failures.set(key, this.clock.nowIso());
      while (this.failures.size > WEATHER_CACHE_MAX_ENTRIES) {
        const oldest = this.failures.keys().next();
        if (oldest.done) break;
        this.failures.delete(oldest.value);
      }
      throw toWeatherError(error);
    }
  }
}
