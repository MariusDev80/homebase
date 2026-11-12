import { TestBed } from '@angular/core/testing';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { WEATHER_API } from './weather-api';
import { WeatherError } from './weather-error';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(), invoke: vi.fn() }));

describe('WEATHER_API', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(isTauri).mockReset();
    delete (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('rejects with unavailable outside Tauri, without calling invoke', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const api = TestBed.inject(WEATHER_API);
    await expect(api.forecast(49.9, 2.3)).rejects.toMatchObject({
      constructor: WeatherError,
      kind: 'unavailable',
    });
    await expect(api.geocode('Amiens', 'fr')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('invokes the forecast command inside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue({ ok: 1 });
    await expect(TestBed.inject(WEATHER_API).forecast(49.9, 2.3)).resolves.toEqual({ ok: 1 });
    expect(invoke).toHaveBeenCalledWith('weather_forecast', { latitude: 49.9, longitude: 2.3 });
  });

  it('invokes the geocode command inside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue([]);
    await TestBed.inject(WEATHER_API).geocode('Amiens', 'fr');
    expect(invoke).toHaveBeenCalledWith('weather_geocode', { query: 'Amiens', language: 'fr' });
  });
});
