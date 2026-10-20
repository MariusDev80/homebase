import { TestBed } from '@angular/core/testing';
import { SETTINGS_REPOSITORY } from '../../data';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { SettingsThemePreferenceStore } from './settings-theme-preference.store';

describe('SettingsThemePreferenceStore', () => {
  let repo: FakeSettingsRepository;
  let store: SettingsThemePreferenceStore;

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    TestBed.configureTestingModule({
      providers: [{ provide: SETTINGS_REPOSITORY, useValue: repo }],
    });
    store = TestBed.inject(SettingsThemePreferenceStore);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('saves under ui.theme and loads it back', async () => {
    await store.save('dark');
    expect(repo.values.get('ui.theme')).toBe('dark');
    expect(await store.load()).toBe('dark');
  });

  it('returns system when nothing is stored', async () => {
    expect(await store.load()).toBe('system');
  });

  it('returns system for an invalid stored value', async () => {
    for (const bad of ['purple', 3, null, { a: 1 }]) {
      repo.values.set('ui.theme', bad);
      expect(await store.load()).toBe('system');
    }
  });

  it('logs and swallows read errors', async () => {
    repo.failGet = true;
    expect(await store.load()).toBe('system');
    expect(console.error).toHaveBeenCalled();
  });

  it('logs and swallows write errors', async () => {
    repo.failSet = true;
    await expect(store.save('light')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
