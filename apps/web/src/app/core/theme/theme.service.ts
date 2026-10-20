import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { THEME_MODES, THEME_PREFERENCE_STORE, ThemeMode } from './theme-preference.store';

export type EffectiveTheme = 'light' | 'dark';
export const DARK_CLASS = 'app-dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(THEME_PREFERENCE_STORE);

  private readonly modeState = signal<ThemeMode>('system');
  private readonly systemDark = signal(false);
  private userChanged = false;

  readonly mode = this.modeState.asReadonly();
  readonly effectiveTheme = computed<EffectiveTheme>(() => {
    const mode = this.modeState();
    if (mode === 'system') {
      return this.systemDark() ? 'dark' : 'light';
    }
    return mode;
  });

  /** Resolves once the initial preference has been loaded from the store. */
  readonly ready: Promise<void>;

  constructor() {
    const query = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (query) {
      this.systemDark.set(query.matches);
      const listener = (event: MediaQueryListEvent): void => this.systemDark.set(event.matches);
      query.addEventListener('change', listener);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', listener));
    }

    effect(() => {
      this.document.documentElement.classList.toggle(DARK_CLASS, this.effectiveTheme() === 'dark');
    });

    this.ready = this.loadInitial();
  }

  setMode(mode: ThemeMode): void {
    this.userChanged = true;
    this.modeState.set(mode);
    void this.store.save(mode).catch((error: unknown) => {
      console.error('Could not persist theme preference', error);
    });
  }

  /** system -> light -> dark -> system */
  cycle(): void {
    const index = THEME_MODES.indexOf(this.modeState());
    this.setMode(THEME_MODES[(index + 1) % THEME_MODES.length]);
  }

  private async loadInitial(): Promise<void> {
    try {
      const saved = await this.store.load();
      // Do not override a choice the user made while the preference was loading.
      if (saved && !this.userChanged && THEME_MODES.includes(saved)) {
        this.modeState.set(saved);
      }
    } catch (error: unknown) {
      console.error('Could not load theme preference', error);
    }
  }
}
