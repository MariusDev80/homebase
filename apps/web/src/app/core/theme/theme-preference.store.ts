import { InjectionToken } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** Persistence port for the theme preference (the SQLite implementation comes with the data layer). */
export interface ThemePreferenceStore {
  /** Returns the saved mode, or null when nothing was saved yet. */
  load(): Promise<ThemeMode | null>;
  save(mode: ThemeMode): Promise<void>;
}

/** Default implementation: in memory only (lost on restart). */
export class InMemoryThemePreferenceStore implements ThemePreferenceStore {
  private mode: ThemeMode | null = null;

  load(): Promise<ThemeMode | null> {
    return Promise.resolve(this.mode);
  }

  save(mode: ThemeMode): Promise<void> {
    this.mode = mode;
    return Promise.resolve();
  }
}

export const THEME_PREFERENCE_STORE = new InjectionToken<ThemePreferenceStore>(
  'THEME_PREFERENCE_STORE',
  { providedIn: 'root', factory: () => new InMemoryThemePreferenceStore() },
);
