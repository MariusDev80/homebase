import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { UrlOpener } from '../../core/system';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { FakeWeatherApi } from '../../core/testing/fake-weather-api';
import { SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { WEATHER_API } from '../../core/weather';
import type { WeatherApi, WeatherPlace } from '../../core/weather';
import { WIDGET_CONTEXT } from '../../core/widgets';
import type { WidgetContext } from '../../core/widgets';
import { CLOCK, SETTINGS_REPOSITORY } from '../../data';
import {
  PLACE_SEARCH_DEBOUNCE_MS,
  WeatherLocationPickerComponent,
} from './weather-location-picker.component';
import type { WeatherConfig } from './weather.config';

const place = (over: Partial<WeatherPlace> = {}): Record<string, unknown> => ({
  id: 1,
  name: 'Amiens',
  region: 'Hauts-de-France',
  country: 'France',
  latitude: 49.9,
  longitude: 2.3,
  ...over,
});

async function render(api: WeatherApi = new FakeWeatherApi()) {
  const open = vi.fn<(ctx: unknown, url: string) => Promise<void>>(() => Promise.resolve());
  const ctx: WidgetContext<WeatherConfig> = {
    instanceId: 'inst-1',
    type: 'weather',
    config: signal({ location: null, days: 5 }),
    size: signal({ w: 3, h: 4 }),
    permissions: new Set(['network', 'open-url']),
    updateConfig: () => Promise.resolve(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: WEATHER_API, useValue: api },
      { provide: CLOCK, useValue: new ManualClock() },
      { provide: UrlOpener, useValue: { open } },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(WeatherLocationPickerComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const input = el.querySelector('[data-testid="weather-search-input"]') as HTMLInputElement;
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };
  const type = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const status = () =>
    el.querySelector('[data-testid="weather-search-status"]')?.textContent?.trim();
  const buttons = () =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="weather-search-result"]'));
  const picked: WeatherPlace[] = [];
  fixture.componentInstance.picked.subscribe((p) => picked.push(p));
  let cancelled = 0;
  fixture.componentInstance.cancelled.subscribe(() => cancelled++);
  return {
    fixture,
    el,
    input,
    settle,
    type,
    status,
    buttons,
    picked,
    cancelledCount: () => cancelled,
    open,
  };
}

describe('WeatherLocationPickerComponent', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('focuses the field and labels it', async () => {
    const t = await render();
    await t.settle();
    expect(document.activeElement).toBe(t.input);
    expect(t.el.querySelector('label')?.textContent).toContain('Ville');
    expect(t.input.getAttribute('maxlength')).toBe('100');
    expect(t.input.getAttribute('autocomplete')).toBe('off');
    expect(t.el.textContent).toContain('Saisissez au moins 2 caractères.');
  });

  it('debounces: three keystrokes 100 ms apart give a single call 300 ms after the last', async () => {
    const api = new FakeWeatherApi();
    api.respondGeocode([place()]);
    const t = await render(api);
    t.type('A');
    await t.settle(100);
    t.type('Am');
    await t.settle(100);
    t.type('Ami');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS - 1);
    expect(api.geocodeCalls).toHaveLength(0);
    await t.settle(1);
    expect(api.geocodeCalls).toEqual([{ query: 'Ami', language: 'fr' }]);
    expect(t.buttons()).toHaveLength(1);
    expect(t.status()).toBe('Résultats : 1');
  });

  it('does not search for fewer than 2 characters', async () => {
    const api = new FakeWeatherApi();
    const t = await render(api);
    t.type('A');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS * 2);
    expect(api.geocodeCalls).toHaveLength(0);
    expect(t.buttons()).toHaveLength(0);
    expect(t.el.textContent).toContain('Saisissez au moins 2 caractères.');
  });

  it('shows only the last search when answers arrive out of order', async () => {
    const pending: ((value: unknown) => void)[] = [];
    const api: WeatherApi = {
      forecast: () => Promise.reject(new Error('unused')),
      geocode: () => new Promise((resolve) => pending.push(resolve)),
    };
    const t = await render(api);
    t.type('Amiens');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    t.type('Paris');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    expect(pending).toHaveLength(2);
    pending[1]([place({ id: 2, name: 'Paris' })]);
    await t.settle();
    pending[0]([place({ id: 1, name: 'Amiens' })]);
    await t.settle();
    expect(t.buttons().map((b) => b.textContent?.trim())).toEqual([
      'Paris, Hauts-de-France (France)',
    ]);
  });

  it('renders a hostile place name as text', async () => {
    const api = new FakeWeatherApi();
    api.respondGeocode([place({ name: '<img src=x onerror=alert(1)>' })]);
    const t = await render(api);
    t.type('Amiens');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    expect(t.el.querySelector('img')).toBeNull();
    expect(t.buttons()[0].textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('emits picked on click and cancelled on Escape', async () => {
    const api = new FakeWeatherApi();
    api.respondGeocode([place()]);
    const t = await render(api);
    t.type('Amiens');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    t.buttons()[0].click();
    expect(t.picked).toHaveLength(1);
    expect(t.picked[0].id).toBe(1);
    t.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(t.cancelledCount()).toBe(1);
  });

  it('reports an error and an empty result', async () => {
    const api = new FakeWeatherApi();
    api.failGeocode({ kind: 'network' });
    api.respondGeocode([]);
    const t = await render(api);
    t.type('Amiens');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    expect(t.status()).toBe('Recherche impossible pour le moment.');
    t.type('Zzzz');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    expect(t.status()).toBe('Aucune ville trouvée.');
  });

  it('disables the results while disabled', async () => {
    const api = new FakeWeatherApi();
    api.respondGeocode([place(), place({ id: 2, region: null })]);
    const t = await render(api);
    t.type('Amiens');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    expect(t.buttons().every((b) => !b.disabled)).toBe(true);
    t.fixture.componentRef.setInput('disabled', true);
    t.fixture.detectChanges();
    expect(t.buttons().every((b) => b.disabled)).toBe(true);
  });

  it('opens the GeoNames attribution through the UrlOpener', async () => {
    const t = await render();
    (t.el.querySelector('[data-testid="weather-geonames"]') as HTMLElement).click();
    await t.settle();
    expect(t.open).toHaveBeenCalledWith(expect.anything(), 'https://www.geonames.org/');
  });

  it('ignores answers after destruction', async () => {
    const api = new FakeWeatherApi();
    const t = await render(api);
    t.type('Amiens');
    await t.settle(PLACE_SEARCH_DEBOUNCE_MS);
    t.fixture.destroy();
    api.resolveNext([place()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.geocodeCalls).toHaveLength(1);
  });
});
