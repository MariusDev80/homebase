import {
  Injectable,
  Injector,
  Signal,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AppLock } from '../lock/app-lock';
import type { CardTheme } from './dashboard-theme';
import { DashboardStore } from './dashboard.store';

export type ThemeFlowPhase = 'unavailable' | 'idle' | 'editing';

type RawState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'editing';
      readonly session: number;
      readonly dashboardId: string;
      readonly preview: CardTheme | null;
    };

/**
 * Edit flow of the dashboard theme panel (spec dashboard-theme 4.6, D8). The raw state remembers
 * the store session it was created in: once the session changes, the state is `idle` and can
 * never come back (same model as WidgetAddFlow).
 */
@Injectable({ providedIn: 'root' })
export class DashboardThemeFlow {
  private readonly store = inject(DashboardStore);
  private readonly lock = inject(AppLock);
  private readonly injector = inject(Injector);

  private readonly raw = signal<RawState>({ kind: 'idle' });
  private trigger: (() => void) | null = null;

  /**
   * 'unavailable': store not ready, no current dashboard, or AppLock locked.
   * A raw 'editing' state from another session is 'idle'.
   */
  readonly phase: Signal<ThemeFlowPhase> = computed(() => {
    if (this.store.status() !== 'ready' || this.store.dashboard() === null) return 'unavailable';
    if (this.lock.isLocked()) return 'unavailable';
    const state = this.raw();
    if (state.kind === 'editing' && state.session === this.store.session()) return 'editing';
    return 'idle';
  });

  /** Dashboard being edited; non null only in 'editing'. */
  readonly dashboardId: Signal<string | null> = computed(() => {
    const state = this.raw();
    return this.phase() === 'editing' && state.kind === 'editing' ? state.dashboardId : null;
  });

  /** Store session of the current edit; non null only in 'editing'. */
  readonly editingSession: Signal<number | null> = computed(() => {
    const state = this.raw();
    return this.phase() === 'editing' && state.kind === 'editing' ? state.session : null;
  });

  /** Draft shown instead of the stored theme; null outside 'editing' or before the first change. */
  readonly preview: Signal<CardTheme | null> = computed(() => {
    const state = this.raw();
    return this.phase() === 'editing' && state.kind === 'editing' ? state.preview : null;
  });

  /** idle -> editing for the current dashboard and session. No effect otherwise. */
  open(): void {
    this.dropStale();
    if (this.phase() !== 'idle') return;
    const dashboard = this.store.dashboard();
    if (!dashboard) return;
    this.raw.set({
      kind: 'editing',
      session: this.store.session(),
      dashboardId: dashboard.id,
      preview: null,
    });
  }

  /** Only in 'editing' (current session); otherwise ignored. */
  setPreview(theme: CardTheme): void {
    this.dropStale();
    const state = this.raw();
    if (this.phase() !== 'editing' || state.kind !== 'editing') return;
    this.raw.set({ ...state, preview: theme });
  }

  /**
   * editing -> idle, preview dropped, focus back to the trigger after render. With
   * `expectedSession`, no effect unless the edit still belongs to that session.
   */
  close(expectedSession?: number): void {
    this.dropStale();
    const state = this.raw();
    if (this.phase() !== 'editing' || state.kind !== 'editing') return;
    if (expectedSession !== undefined && state.session !== expectedSession) return;
    this.raw.set({ kind: 'idle' });
    afterNextRender(() => this.focusTrigger(), { injector: this.injector });
  }

  /** The sidebar button registers how to focus itself; returns the unregistration. */
  registerTrigger(focus: () => void): () => void {
    this.trigger = focus;
    return () => {
      if (this.trigger === focus) this.trigger = null;
    };
  }

  focusTrigger(): void {
    this.trigger?.();
  }

  /** A state from another session never has an effect again. */
  private dropStale(): void {
    const state = this.raw();
    if (state.kind !== 'idle' && state.session !== this.store.session()) {
      this.raw.set({ kind: 'idle' });
    }
  }
}
