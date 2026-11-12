import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { THEME_MODES, THEME_PREFERENCE_STORE, ThemeMode } from './theme-preference.store';

export type EffectiveTheme = 'light' | 'dark';
export const DARK_CLASS = 'app-dark';
/**
 * Synchronous mirror of the preference (the source of truth stays in the settings table).
 * Read by public/theme-init.js before the first paint: keep both in sync.
 */
export const THEME_MIRROR_KEY = 'hb.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(THEME_PREFERENCE_STORE);

  private readonly modeState = signal<ThemeMode>(this.readMirror() ?? 'system');
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
    this.writeMirror(mode);
    void this.store.save(mode).catch((error: unknown) => {
      console.error('Could not persist theme preference', error);
    });
  }

  /** system -> light -> dark -> system */
  cycle(): void {
    const index = THEME_MODES.indexOf(this.modeState());
    this.setMode(THEME_MODES[(index + 1) % THEME_MODES.length]);
  }

  private readMirror(): ThemeMode | null {
    try {
      const value = this.document.defaultView?.localStorage.getItem(THEME_MIRROR_KEY);
      return THEME_MODES.find((mode) => mode === value) ?? null;
    } catch {
      return null;
    }
  }

  private writeMirror(mode: ThemeMode): void {
    try {
      this.document.defaultView?.localStorage.setItem(THEME_MIRROR_KEY, mode);
    } catch {
      // Storage unavailable: only the first-paint optimisation is lost.
    }
  }

  private removeMirror(): void {
    try {
      this.document.defaultView?.localStorage.removeItem(THEME_MIRROR_KEY);
    } catch {
      // Storage unavailable: nothing to realign.
    }
  }

  private async loadInitial(): Promise<void> {
    try {
      const saved = await this.store.load();
      // Do not override a choice the user made while the preference was loading.
      // The database is the source of truth: nothing (or garbage) saved means 'system', and the
      // synchronous mirror is realigned accordingly.
      if (!this.userChanged) {
        const next: ThemeMode = saved && THEME_MODES.includes(saved) ? saved : 'system';
        this.modeState.set(next);
        if (saved === null) this.removeMirror();
        else this.writeMirror(next);
      }
    } catch (error: unknown) {
      console.error('Could not load theme preference', error);
    }
  }
}
