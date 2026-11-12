import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { UrlOpener } from '../../core/system';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { FakeWeatherApi, fakeForecastPayload } from '../../core/testing/fake-weather-api';
import { SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { WEATHER_API, WeatherError } from '../../core/weather';
import { WIDGET_CONTEXT } from '../../core/widgets';
import type { GridSize, WidgetContext } from '../../core/widgets';
import { CLOCK, SETTINGS_REPOSITORY } from '../../data';
import { toWeatherLocation } from './weather.config';
import type { WeatherConfig } from './weather.config';
import { WeatherComponent } from './weather.component';
import { PLACE_SEARCH_DEBOUNCE_MS } from './weather-location-picker.component';

// 12:00 on 2026-10-21 in Paris (CEST).
const NOON = '2026-10-21T10:00:00.000Z';
const MIN = 60_000;
const PARIS = {
  name: 'Amiens',
  region: 'Hauts-de-France',
  country: 'France',
  latitude: 49.9,
  longitude: 2.3,
};
const AMIENS = { id: 3037854, ...PARIS };
const NETWORK = { kind: 'network' };

interface Options {
  config?: WeatherConfig;
  size?: GridSize;
  now?: string;
  prepare?: (api: FakeWeatherApi) => void;
  updateConfig?: (next: WeatherConfig) => Promise<void>;
}

interface Payload {
  timeZone: string;
  current: Record<string, unknown>;
  daily: Record<string, unknown>[];
}

function payload(change?: (value: Payload) => void): Record<string, unknown> {
  const value = fakeForecastPayload() as unknown as Payload;
  change?.(value);
  return value as unknown as Record<string, unknown>;
}

async function render(options: Options = {}) {
  const api = new FakeWeatherApi();
  options.prepare?.(api);
  const clock = new ManualClock(options.now ?? NOON);
  const config = signal<WeatherConfig>(options.config ?? { location: PARIS, days: 5 });
  const size = signal<GridSize>(options.size ?? { w: 3, h: 4 });
  const open = vi.fn<(ctx: unknown, url: string) => Promise<void>>(() => Promise.resolve());
  const updateConfig = vi.fn((next: WeatherConfig): Promise<void> => {
    if (options.updateConfig) return options.updateConfig(next);
    config.set(next);
    return Promise.resolve();
  });
  const ctx: WidgetContext<WeatherConfig> = {
    instanceId: 'inst-1',
    type: 'weather',
    config,
    size,
    permissions: new Set(['network', 'open-url']),
    updateConfig,
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: WEATHER_API, useValue: api },
      { provide: CLOCK, useValue: clock },
      { provide: UrlOpener, useValue: { open } },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(WeatherComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };
  /** Advances the test clock and the timers together. */
  const elapse = async (ms: number) => {
    clock.advance(ms);
    await settle(ms);
  };
  const click = async (target: HTMLElement | null) => {
    if (!target) throw new Error('element not found');
    target.click();
    await settle();
  };
  await settle();
  return {
    fixture,
    el,
    api,
    clock,
    config,
    size,
    open,
    updateConfig,
    ctx,
    q,
    all,
    text,
    settle,
    elapse,
    click,
  };
}

describe('WeatherComponent', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('1. shows an empty state without a location and opens the panel', async () => {
    const t = await render({ config: { location: null, days: 5 } });
    expect(t.q('weather-empty')).not.toBeNull();
    expect(t.api.callCount).toBe(0);
    await t.click(t.q('weather-choose'));
    expect(t.q('weather-panel')).not.toBeNull();
    expect(t.q('weather-panel')?.getAttribute('role')).toBe('group');
    expect(t.api.callCount).toBe(0);
  });

  it('2. loads, then shows the temperature, the condition and the attribution', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    expect(t.text('weather-temperature')).toBe('13 °C');
    expect(t.text('weather-condition')).toBe('Couvert');
    expect(t.text('weather-attribution')).toBe('Données météo : Open-Meteo.com');
    expect(t.api.forecastCalls).toEqual([{ latitude: 49.9, longitude: 2.3 }]);
  });

  it('2b. shows a loading status while the request is pending', async () => {
    const t = await render();
    const loading = t.q('weather-loading');
    expect(loading?.getAttribute('role')).toBe('status');
    t.api.resolveNext(payload());
    await t.settle();
    expect(t.q('weather-loading')).toBeNull();
    expect(t.text('weather-temperature')).toBe('13 °C');
  });

  it('3. adapts to the widget size', async () => {
    const t = await render({
      size: { w: 2, h: 2 },
      prepare: (api) => api.respondForecast(payload()),
    });
    expect(t.q('weather-days-list')).toBeNull();
    expect(t.text('weather-temperature')).toBe('13°');
    expect(t.text('weather-attribution')).toBe('Open-Meteo');
    t.size.set({ w: 4, h: 4 });
    await t.settle();
    expect(t.all('weather-day')).toHaveLength(3);
    expect(t.q('weather-details')).not.toBeNull();
    t.size.set({ w: 3, h: 4 });
    await t.settle();
    expect(t.all('weather-day')).toHaveLength(3);
    expect(t.q('weather-details')).toBeNull();
  });

  it('4. drops past days, caps the count and uses day icons in the list', async () => {
    const t = await render({
      now: '2026-10-22T10:00:00.000Z',
      prepare: (api) =>
        api.respondForecast(
          payload((v) => {
            v.current = { ...v.current, isDay: false };
          }),
        ),
    });
    const rows = t.all('weather-day');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('[data-testid="weather-day-label"]')?.textContent).toBe(
      "Aujourd'hui",
    );
    expect(rows[1].querySelector('[data-testid="weather-day-label"]')?.textContent).toBe('Demain');
    // Code 80 by day = cloud-sun-rain (has a sun ray); at night it would be cloud-rain.
    expect(rows[0].querySelector('path[d="m4.93 4.93 1.41 1.41"]')).not.toBeNull();
    t.config.set({ location: PARIS, days: 1 });
    await t.settle();
    t.api.resolveNext(payload());
    await t.settle();
    expect(t.all('weather-day')).toHaveLength(1);
  });

  it('5. shows a network error without data and retries with force', async () => {
    const t = await render({ prepare: (api) => api.failForecast(NETWORK) });
    expect(t.text('weather-error')).toContain('Connexion impossible');
    expect(t.q('weather-error')?.getAttribute('role')).toBe('alert');
    t.api.respondForecast(payload());
    await t.click(t.q('weather-retry'));
    expect(t.api.callCount).toBe(2);
    expect(t.text('weather-temperature')).toBe('13 °C');
  });

  it('6. keeps the data with an offline banner and the age after a network failure', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    t.api.failForecast(NETWORK);
    await t.elapse(5 * MIN);
    await t.click(t.q('weather-refresh'));
    expect(t.text('weather-temperature')).toBe('13 °C');
    expect(t.text('weather-banner')).toBe('Hors ligne : dernière météo connue.');
    expect(t.text('weather-age')).toBe('Mis à jour il y a 5 min');
  });

  it('7. refreshes after 30 minutes and backs off after failures', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    await t.elapse(30 * MIN - 1);
    expect(t.api.callCount).toBe(1);
    t.api.respondForecast(payload());
    await t.elapse(1);
    expect(t.api.callCount).toBe(2);
  });

  it('7b. backs off 60 s, 2 min, 5 min after successive failures', async () => {
    const f = await render({
      prepare: (api) => {
        api.failForecast(NETWORK);
        api.failForecast(NETWORK);
        api.failForecast(NETWORK);
      },
    });
    expect(f.api.callCount).toBe(1);
    await f.elapse(MIN - 1);
    expect(f.api.callCount).toBe(1);
    await f.elapse(1);
    expect(f.api.callCount).toBe(2);
    await f.elapse(2 * MIN - 1);
    expect(f.api.callCount).toBe(2);
    await f.elapse(1);
    expect(f.api.callCount).toBe(3);
    await f.elapse(5 * MIN - 1);
    expect(f.api.callCount).toBe(3);
    f.api.failForecast(NETWORK);
    await f.elapse(1);
    expect(f.api.callCount).toBe(4);
  });

  describe('8. events and the limiter', () => {
    it('refreshes on focus and visibility only when the data is stale or in error', async () => {
      const t = await render({ prepare: (api) => api.respondForecast(payload()) });
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await t.settle();
      expect(t.api.callCount).toBe(1);
      t.clock.advance(31 * MIN);
      t.api.respondForecast(payload());
      window.dispatchEvent(new Event('focus'));
      await t.settle();
      expect(t.api.callCount).toBe(2);
    });

    it('recovers with the online event before the 60 s timer (CA-M4)', async () => {
      const t = await render({ prepare: (api) => api.respondForecast(payload()) });
      t.api.failForecast(NETWORK);
      await t.click(t.q('weather-refresh'));
      expect(t.q('weather-banner')).not.toBeNull();
      expect(t.api.callCount).toBe(2);

      await t.elapse(10_000);
      window.dispatchEvent(new Event('focus'));
      await t.settle();
      expect(t.api.callCount).toBe(2);
      expect(t.q('weather-banner')).not.toBeNull();

      await t.elapse(10_000);
      t.api.respondForecast(
        payload((v) => {
          v.current = { ...v.current, temperatureC: 20 };
        }),
      );
      window.dispatchEvent(new Event('online'));
      await t.settle();
      expect(t.api.callCount).toBe(3);
      expect(t.text('weather-temperature')).toBe('20 °C');
      expect(t.q('weather-banner')).toBeNull();
    });

    it('lets the 60 s timer succeed without an online event', async () => {
      const t = await render({ prepare: (api) => api.respondForecast(payload()) });
      t.api.failForecast(NETWORK);
      await t.click(t.q('weather-refresh'));
      await t.elapse(59_000);
      expect(t.api.callCount).toBe(2);
      t.api.respondForecast(payload());
      await t.elapse(1000);
      expect(t.api.callCount).toBe(3);
      expect(t.q('weather-banner')).toBeNull();
    });

    it('schedules the 2 minute step after a throttled attempt, not 5', async () => {
      const t = await render({ prepare: (api) => api.respondForecast(payload()) });
      t.api.failForecast(NETWORK);
      await t.click(t.q('weather-refresh'));
      await t.elapse(30_000);
      window.dispatchEvent(new Event('focus'));
      await t.settle();
      expect(t.api.callCount).toBe(2);
      t.api.failForecast(NETWORK);
      await t.elapse(30_000);
      expect(t.api.callCount).toBe(3);
      await t.elapse(2 * MIN - 1);
      expect(t.api.callCount).toBe(3);
      t.api.respondForecast(payload());
      await t.elapse(1);
      expect(t.api.callCount).toBe(4);
    });
  });

  it('7c. counts one failure when online fires during an in-flight request', async () => {
    const t = await render();
    window.dispatchEvent(new Event('online'));
    await t.settle();
    expect(t.api.callCount).toBe(1);
    t.api.rejectNext(NETWORK);
    await t.settle();
    t.api.failForecast(NETWORK);
    await t.elapse(MIN - 1);
    expect(t.api.callCount).toBe(1);
    await t.elapse(1);
    expect(t.api.callCount).toBe(2);
    t.api.failForecast(NETWORK);
    await t.elapse(2 * MIN - 1);
    expect(t.api.callCount).toBe(2);
    await t.elapse(1);
    expect(t.api.callCount).toBe(3);
  });

  it('7d. offers the settings from the error and loading views', async () => {
    const t = await render();
    expect(t.q('weather-loading')).not.toBeNull();
    expect(t.q('weather-settings')).not.toBeNull();
    t.api.rejectNext(NETWORK);
    await t.settle();
    expect(t.q('weather-error')).not.toBeNull();
    await t.click(t.q('weather-settings'));
    expect(t.q('weather-panel')).not.toBeNull();
    await t.click(t.q('weather-close'));
    expect(document.activeElement).toBe(t.q('weather-settings'));
  });

  it('7e. visibilitychange alone refreshes stale data; hidden does not', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    t.clock.advance(31 * MIN);
    t.api.respondForecast(payload());
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await t.settle();
      expect(t.api.callCount).toBe(1);
    } finally {
      delete (document as unknown as Record<string, unknown>)['visibilityState'];
    }
    document.dispatchEvent(new Event('visibilitychange'));
    await t.settle();
    expect(t.api.callCount).toBe(2);
  });

  it('7f. Escape closes the panel from any control and returns the focus', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    await t.click(t.q('weather-settings'));
    t.q('weather-days')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await t.settle();
    expect(t.q('weather-panel')).toBeNull();
    expect(document.activeElement).toBe(t.q('weather-settings'));
  });

  it('7g. keeps the focus in the widget after choosing a city from the empty state', async () => {
    const t = await render({
      config: { location: null, days: 5 },
      prepare: (api) => api.respondGeocode([AMIENS]),
    });
    await t.click(t.q('weather-choose'));
    const input = t.q<HTMLInputElement>('weather-search-input');
    if (!input) throw new Error('no input');
    input.value = 'Amiens';
    input.dispatchEvent(new Event('input'));
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    await t.click(t.q('weather-search-result'));
    expect(t.el.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('9. ignores the response of a previous location', async () => {
    const t = await render();
    t.config.set({
      location: { ...PARIS, name: 'Lille', latitude: 50.6, longitude: 3.06 },
      days: 5,
    });
    await t.settle();
    expect(t.api.callCount).toBe(2);
    t.api.resolveNext(
      payload((v) => {
        v.current = { ...v.current, temperatureC: 1 };
      }),
    );
    await t.settle();
    expect(t.q('weather-temperature')).toBeNull();
    t.api.resolveNext(
      payload((v) => {
        v.current = { ...v.current, temperatureC: 20 };
      }),
    );
    await t.settle();
    expect(t.text('weather-temperature')).toBe('20 °C');
    expect(t.text('weather-location')).toBe('Lille, Hauts-de-France (France)');
  });

  it('10. stops everything when destroyed', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    t.fixture.destroy();
    await vi.advanceTimersByTimeAsync(3 * 60 * MIN);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.api.callCount).toBe(1);
  });

  it('11. opens the attribution through the UrlOpener', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    await t.click(t.q('weather-attribution'));
    expect(t.open).toHaveBeenCalledWith(t.ctx, 'https://open-meteo.com/');
  });

  it('11b. reports a failure to open the link', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    t.open.mockRejectedValueOnce(new Error('nope'));
    await t.click(t.q('weather-attribution'));
    expect(t.text('weather-link-error')).toBe("Impossible d'ouvrir le lien.");
  });

  describe('12. choosing a place', () => {
    async function openPicker(options: Options = {}) {
      const t = await render({
        config: { location: null, days: 5 },
        prepare: (api) => {
          api.respondGeocode([AMIENS]);
          api.respondForecast(payload());
        },
        ...options,
      });
      await t.click(t.q('weather-choose'));
      const input = t.q<HTMLInputElement>('weather-search-input');
      if (!input) throw new Error('no input');
      input.value = 'Amiens';
      input.dispatchEvent(new Event('input'));
      await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
      return t;
    }

    it('saves the place and closes the panel', async () => {
      const t = await openPicker();
      await t.click(t.q('weather-search-result'));
      expect(t.updateConfig).toHaveBeenCalledTimes(1);
      expect(t.updateConfig).toHaveBeenCalledWith({
        location: toWeatherLocation(AMIENS),
        days: 5,
      });
      expect(t.q('weather-panel')).toBeNull();
      expect(t.text('weather-temperature')).toBe('13 °C');
    });

    it('shows an error and keeps the panel when saving fails', async () => {
      const t = await openPicker({ updateConfig: () => Promise.reject(new Error('write')) });
      await t.click(t.q('weather-search-result'));
      expect(t.text('weather-save-error')).toBe("Impossible d'enregistrer la ville.");
      expect(t.q('weather-panel')).not.toBeNull();
    });

    it('ignores a second click while saving', async () => {
      let release: () => void = () => undefined;
      const t = await openPicker({
        updateConfig: () => new Promise<void>((resolve) => (release = resolve)),
      });
      const button = t.q('weather-search-result');
      button?.click();
      button?.click();
      await t.settle();
      expect(t.updateConfig).toHaveBeenCalledTimes(1);
      release();
      await t.settle();
    });
  });

  it('13. changes the number of days', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    await t.click(t.q('weather-settings'));
    const select = t.q<HTMLSelectElement>('weather-days');
    if (!select) throw new Error('no select');
    select.value = '7';
    select.dispatchEvent(new Event('change'));
    await t.settle();
    expect(t.updateConfig).toHaveBeenCalledWith({ location: PARIS, days: 7 });
  });

  it('13b. reports a failed days-count save with its own message', async () => {
    const t = await render({
      prepare: (api) => api.respondForecast(payload()),
      updateConfig: () => Promise.reject(new Error('write')),
    });
    await t.click(t.q('weather-settings'));
    const select = t.q<HTMLSelectElement>('weather-days');
    if (!select) throw new Error('no select');
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    await t.settle();
    expect(t.text('weather-days-error')).toBe("Impossible d'enregistrer le nombre de jours.");
    expect(t.q('weather-save-error')).toBeNull();
  });

  it('closes the panel with the close button and returns the focus to the gear', async () => {
    const t = await render({ prepare: (api) => api.respondForecast(payload()) });
    const gear = t.q('weather-settings');
    await t.click(gear);
    expect(t.q('weather-panel')).not.toBeNull();
    await t.click(t.q('weather-close'));
    expect(t.q('weather-panel')).toBeNull();
    expect(document.activeElement).toBe(t.q('weather-settings'));
  });

  describe('14. time zones of the response', () => {
    const rowsFor = async (timeZone: string, now: string) => {
      const t = await render({
        now,
        prepare: (api) =>
          api.respondForecast(
            payload((v) => {
              v.timeZone = timeZone;
            }),
          ),
      });
      return t.all('weather-day').length;
    };

    it('falls back to the user zone for an unknown zone', async () => {
      // Paris is on the 22nd: only two of the three days remain.
      expect(await rowsFor('Mars/Base', '2026-10-22T02:00:00.000Z')).toBe(2);
    });

    it('accepts Etc/GMT+11 (still the 21st there)', async () => {
      expect(await rowsFor('Etc/GMT+11', '2026-10-22T02:00:00.000Z')).toBe(3);
    });

    it('accepts Antarctica/McMurdo (already the 22nd there)', async () => {
      expect(await rowsFor('Antarctica/McMurdo', '2026-10-21T20:00:00.000Z')).toBe(2);
    });
  });

  it('15. hides absent values and spells out missing ranges', async () => {
    const t = await render({
      size: { w: 4, h: 4 },
      prepare: (api) =>
        api.respondForecast(
          payload((v) => {
            v.current = { ...v.current, apparentTemperatureC: null };
            v.daily[0] = {
              ...v.daily[0],
              temperatureMaxC: null,
              precipitationProbabilityPct: null,
            };
          }),
        ),
    });
    expect(t.q('weather-feels-like')).toBeNull();
    expect(t.text('weather-details')).toContain('Humidité 74 %');
    expect(t.text('weather-day-range')).toBe('– / 8°');
    expect(t.text('weather-day-range-sr')).toBe('Maximum non disponible, minimum 8 °C');
    expect(t.q('weather-day-range')?.getAttribute('aria-hidden')).toBe('true');
    expect(t.all('weather-day')[0].textContent).not.toContain('Pluie');
  });

  it.each<[string, unknown, string]>([
    ['client_unavailable', { kind: 'client_unavailable' }, 'module réseau'],
    ['forbidden', { kind: 'forbidden' }, 'erreur interne'],
    ['unavailable', new WeatherError('unavailable'), 'disponible que dans'],
    ['429', { kind: 'upstream_status', status: 429 }, 'Trop de requêtes'],
    ['503', { kind: 'upstream_status', status: 503 }, '(503)'],
    ['timeout', { kind: 'timeout' }, 'ne répond pas'],
    ['invalid_response', { kind: 'invalid_response' }, 'illisible'],
    ['raw string', 'a raw tauri error', 'Impossible de charger la météo.'],
  ])('16. maps %s to a distinct message', async (name, error, expected) => {
    const t = await render({ prepare: (api) => api.failForecast(error) });
    expect(t.text('weather-error')).toContain(expected);
    if (name !== 'unavailable') {
      expect(t.text('weather-error')).not.toContain('disponible que dans');
    }
    expect(t.text('weather-error')).not.toContain('raw tauri');
  });
});
