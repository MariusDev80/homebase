import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideAppI18n } from '../i18n';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeWeatherApi, fakeForecastPayload } from '../testing/fake-weather-api';
import { SYSTEM_TIME_ZONE_READER } from '../time';
import { ManualClock } from '../time/testing/manual-clock';
import { WidgetPermissionError } from '../widgets';
import type { WidgetContext } from '../widgets';
import { CLOCK, SETTINGS_REPOSITORY } from '../../data';
import { WEATHER_API } from './weather-api';
import { WeatherError } from './weather-error';
import {
  WEATHER_CACHE_MAX_ENTRIES,
  WEATHER_MAX_AGE_MS,
  WEATHER_MIN_RETRY_MS,
  WeatherService,
} from './weather.service';

const START = '2026-10-21T10:00:00.000Z';
const MIN = 60_000;
const allowed: Pick<WidgetContext, 'type' | 'permissions'> = {
  type: 'weather',
  permissions: new Set(['network']),
};
const denied: Pick<WidgetContext, 'type' | 'permissions'> = {
  type: 'weather',
  permissions: new Set(),
};
const paris = { latitude: 49.9, longitude: 2.3 };

async function setup() {
  const api = new FakeWeatherApi();
  const clock = new ManualClock(START);
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WEATHER_API, useValue: api },
      { provide: CLOCK, useValue: clock },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  return { api, clock, service: TestBed.inject(WeatherService) };
}

async function kindOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof WeatherError ? error.kind : 'not-a-weather-error';
  }
  return undefined;
}

describe('WeatherService', () => {
  describe('permission', () => {
    it('refuses every method without network, even with a filled cache, and never calls the api', async () => {
      const { api, service } = await setup();
      api.respondForecast(fakeForecastPayload());
      await service.forecast(allowed, paris);
      const calls = api.callCount;

      await expect(service.forecast(denied, paris)).rejects.toBeInstanceOf(WidgetPermissionError);
      expect(() => service.cached(denied, paris)).toThrow(WidgetPermissionError);
      await expect(service.searchPlaces(denied, 'Amiens')).rejects.toBeInstanceOf(
        WidgetPermissionError,
      );
      expect(api.callCount).toBe(calls);
    });
  });

  describe('forecast', () => {
    it('rejects invalid coordinates without a call', async () => {
      const { api, service } = await setup();
      for (const bad of [
        { latitude: 91, longitude: 0 },
        { latitude: 0, longitude: 181 },
        { latitude: Number.NaN, longitude: 0 },
      ]) {
        expect(await kindOf(service.forecast(allowed, bad))).toBe('invalid_input');
      }
      expect(api.callCount).toBe(0);
    });

    it('stamps fetchedAt from the clock and caches for 30 minutes', async () => {
      const { api, clock, service } = await setup();
      api.respondForecast(fakeForecastPayload());
      const snapshot = await service.forecast(allowed, paris);
      expect(snapshot.fetchedAt).toBe(START);
      expect(snapshot.forecast.timeZone).toBe('Europe/Paris');
      expect(service.cached(allowed, paris)).toBe(snapshot);

      clock.advance(29 * MIN);
      expect(await service.forecast(allowed, paris)).toBe(snapshot);
      expect(api.forecastCalls).toHaveLength(1);

      api.respondForecast(fakeForecastPayload());
      clock.advance(MIN);
      const fresh = await service.forecast(allowed, paris);
      expect(api.forecastCalls).toHaveLength(2);
      expect(fresh.fetchedAt).toBe('2026-10-21T10:30:00.000Z');
      expect(WEATHER_MAX_AGE_MS).toBe(30 * MIN);
    });

    it('treats a clock set back as stale', async () => {
      const { api, clock, service } = await setup();
      api.respondForecast(fakeForecastPayload());
      await service.forecast(allowed, paris);
      clock.advance(-60 * MIN);
      api.respondForecast(fakeForecastPayload());
      await service.forecast(allowed, paris);
      expect(api.forecastCalls).toHaveLength(2);
    });

    it('force bypasses a fresh cache', async () => {
      const { api, service } = await setup();
      api.respondForecast(fakeForecastPayload());
      await service.forecast(allowed, paris);
      api.respondForecast(fakeForecastPayload());
      await service.forecast(allowed, paris, { force: true });
      expect(api.forecastCalls).toHaveLength(2);
    });

    it('coalesces simultaneous requests, force included', async () => {
      const { api, service } = await setup();
      const first = service.forecast(allowed, paris);
      const second = service.forecast(allowed, paris, { force: true });
      api.resolveNext(fakeForecastPayload());
      const [a, b] = await Promise.all([first, second]);
      expect(a).toBe(b);
      expect(api.forecastCalls).toHaveLength(1);
    });

    it('throttles a plain retry after a failure without calling or changing state', async () => {
      const { api, clock, service } = await setup();
      api.failForecast({ kind: 'network' });
      expect(await kindOf(service.forecast(allowed, paris))).toBe('network');

      clock.advance(30_000);
      let thrown: unknown;
      try {
        await service.forecast(allowed, paris);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(WeatherError);
      expect((thrown as WeatherError).kind).toBe('throttled');
      expect((thrown as WeatherError).retryAfterMs).toBe(30_000);
      expect(api.forecastCalls).toHaveLength(1);

      // The refusal did not restart the delay: 31 s later the original delay is over.
      clock.advance(31_000);
      api.respondForecast(fakeForecastPayload());
      await service.forecast(allowed, paris);
      expect(api.forecastCalls).toHaveLength(2);
      expect(WEATHER_MIN_RETRY_MS).toBe(MIN);
    });

    it('lets ignoreRetryDelay and force through after a failure', async () => {
      const { api, clock, service } = await setup();
      api.failForecast({ kind: 'timeout' });
      await kindOf(service.forecast(allowed, paris));
      clock.advance(30_000);

      api.failForecast({ kind: 'timeout' });
      expect(await kindOf(service.forecast(allowed, paris, { ignoreRetryDelay: true }))).toBe(
        'timeout',
      );
      expect(api.forecastCalls).toHaveLength(2);

      api.respondForecast(fakeForecastPayload());
      await service.forecast(allowed, paris, { force: true });
      expect(api.forecastCalls).toHaveLength(3);
    });

    it('calls again once the minimum delay has elapsed', async () => {
      const { api, clock, service } = await setup();
      api.failForecast({ kind: 'network' });
      await kindOf(service.forecast(allowed, paris));
      clock.advance(61_000);
      api.respondForecast(fakeForecastPayload());
      await service.forecast(allowed, paris);
      expect(api.forecastCalls).toHaveLength(2);
    });

    it('keeps the cached snapshot after a failure', async () => {
      const { api, clock, service } = await setup();
      api.respondForecast(fakeForecastPayload());
      const snapshot = await service.forecast(allowed, paris);
      clock.advance(31 * MIN);
      api.failForecast({ kind: 'upstream_status', status: 503 });
      const error = await service.forecast(allowed, paris).catch((e: unknown) => e);
      expect((error as WeatherError).kind).toBe('upstream_status');
      expect((error as WeatherError).status).toBe(503);
      expect(service.cached(allowed, paris)).toBe(snapshot);
    });

    it('rejects an invalid payload with invalid_response and does not cache it', async () => {
      const { api, service } = await setup();
      api.respondForecast({ nope: true });
      expect(await kindOf(service.forecast(allowed, paris))).toBe('invalid_response');
      expect(service.cached(allowed, paris)).toBeNull();
    });

    it('maps a non-conforming rejection to unknown', async () => {
      const { api, service } = await setup();
      api.failForecast('invalid args');
      expect(await kindOf(service.forecast(allowed, paris))).toBe('unknown');
    });

    it('evicts the oldest entry beyond the cache size', async () => {
      const { api, service } = await setup();
      for (let i = 0; i <= WEATHER_CACHE_MAX_ENTRIES; i++) {
        api.respondForecast(fakeForecastPayload());
        await service.forecast(allowed, { latitude: i, longitude: 0 });
      }
      expect(service.cached(allowed, { latitude: 0, longitude: 0 })).toBeNull();
      expect(service.cached(allowed, { latitude: 1, longitude: 0 })).not.toBeNull();
      expect(service.cached(allowed, { latitude: 20, longitude: 0 })).not.toBeNull();
    });
  });

  describe('searchPlaces', () => {
    it('returns [] below 2 characters without a call', async () => {
      const { api, service } = await setup();
      expect(await service.searchPlaces(allowed, '  A ')).toEqual([]);
      expect(api.geocodeCalls).toHaveLength(0);
    });

    it('trims the query and uses the active language', async () => {
      const { api, service } = await setup();
      api.respondGeocode([]);
      await service.searchPlaces(allowed, ' Amiens ');
      expect(api.geocodeCalls).toEqual([{ query: 'Amiens', language: 'fr' }]);
    });

    it('falls back to fr for an unsupported language', async () => {
      const { api, service } = await setup();
      vi.spyOn(TestBed.inject(TranslocoService), 'getActiveLang').mockReturnValue('de');
      api.respondGeocode([]);
      await service.searchPlaces(allowed, 'Amiens');
      expect(api.geocodeCalls[0].language).toBe('fr');
    });

    it('rejects over 100 characters with invalid_input and no call', async () => {
      const { api, service } = await setup();
      expect(await kindOf(service.searchPlaces(allowed, 'a'.repeat(101)))).toBe('invalid_input');
      expect(api.geocodeCalls).toHaveLength(0);
    });

    it('validates the payload and maps failures', async () => {
      const { api, service } = await setup();
      api.respondGeocode([
        { id: 1, name: 'Amiens', region: null, country: 'France', latitude: 49.9, longitude: 2.3 },
      ]);
      expect((await service.searchPlaces(allowed, 'Amiens'))[0].name).toBe('Amiens');
      api.respondGeocode([{ name: 'x' }]);
      expect(await kindOf(service.searchPlaces(allowed, 'Amiens'))).toBe('invalid_response');
      api.failGeocode({ kind: 'network' });
      expect(await kindOf(service.searchPlaces(allowed, 'Amiens'))).toBe('network');
    });
  });
});
