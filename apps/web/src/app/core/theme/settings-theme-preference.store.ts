import { Injectable, inject } from '@angular/core';
import { SETTINGS_REPOSITORY } from '../../data';
import { THEME_MODES, ThemeMode, ThemePreferenceStore } from './theme-preference.store';

export const THEME_SETTINGS_KEY = 'ui.theme';

/** Persists the theme preference in the `settings` table (key `ui.theme`). */
@Injectable({ providedIn: 'root' })
export class SettingsThemePreferenceStore implements ThemePreferenceStore {
  private readonly settings = inject(SETTINGS_REPOSITORY);

  async load(): Promise<ThemeMode | null> {
    try {
      const value = await this.settings.get(THEME_SETTINGS_KEY);
      return THEME_MODES.find((mode) => mode === value) ?? 'system';
    } catch (error: unknown) {
      console.error('Could not read theme preference', error);
      return 'system';
    }
  }

  async save(mode: ThemeMode): Promise<void> {
    try {
      await this.settings.set(THEME_SETTINGS_KEY, mode);
    } catch (error: unknown) {
      console.error('Could not save theme preference', error);
    }
  }
}
