import {
  Injectable,
  Injector,
  Signal,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { WidgetTypeId } from '../widgets/widget-definition';
import { DashboardStore } from './dashboard.store';

export type AddWidgetPhase = 'unavailable' | 'idle' | 'choosing' | 'confirming';

type RawState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'choosing'; readonly session: number }
  | { readonly kind: 'confirming'; readonly session: number; readonly instanceId: string };

/**
 * Add-widget flow driven by the green `+` / blue V button of the sidebar (spec
 * dashboards-sidebar 4.9, D13, D14). The raw state remembers the store session it was created
 * in: once the session changes, the state is `idle` and can never come back.
 */
@Injectable({ providedIn: 'root' })
export class WidgetAddFlow {
  private readonly store = inject(DashboardStore);
  private readonly injector = inject(Injector);

  private readonly raw = signal<RawState>({ kind: 'idle' });
  private readonly pendingState = signal(false);
  private readonly addFailedState = signal(false);
  private trigger: (() => void) | null = null;

  readonly phase: Signal<AddWidgetPhase> = computed(() => {
    if (this.store.status() !== 'ready') return 'unavailable';
    const state = this.raw();
    if (state.kind === 'idle') return 'idle';
    if (state.session !== this.store.session()) return 'idle';
    if (
      state.kind === 'confirming' &&
      !this.store.instances().some((i) => i.id === state.instanceId)
    ) {
      return 'idle';
    }
    return state.kind;
  });

  /** Non null only while confirming. */
  readonly newInstanceId: Signal<string | null> = computed(() => {
    const state = this.raw();
    return this.phase() === 'confirming' && state.kind === 'confirming' ? state.instanceId : null;
  });

  readonly pending: Signal<boolean> = this.pendingState.asReadonly();
  readonly addFailed: Signal<boolean> = this.addFailedState.asReadonly();

  /** idle -> choosing (current session). */
  open(): void {
    this.dropStale();
    if (this.phase() !== 'idle') return;
    this.addFailedState.set(false);
    this.raw.set({ kind: 'choosing', session: this.store.session() });
  }

  /** choosing -> idle, the focus goes back to the trigger. */
  cancel(): void {
    this.dropStale();
    if (this.phase() !== 'choosing' || this.pendingState()) return;
    this.raw.set({ kind: 'idle' });
    this.afterRender(() => this.focusTrigger());
  }

  /** choosing -> confirming. A failure keeps `choosing` and sets `addFailed`. */
  async pick(type: WidgetTypeId): Promise<void> {
    this.dropStale();
    if (this.phase() !== 'choosing' || this.pendingState()) return;
    if (!this.store.canAdd(type)) return;
    const session = this.store.session();
    this.pendingState.set(true);
    this.addFailedState.set(false);
    try {
      const record = await this.store.add(type);
      if (this.store.session() !== session) {
        // The dashboard changed during the write: the widget stays created, the flow ends.
        this.raw.set({ kind: 'idle' });
        return;
      }
      this.raw.set({ kind: 'confirming', session, instanceId: record.id });
      this.afterRender(() => this.focusTrigger());
    } catch (error: unknown) {
      console.error('Could not add widget', error);
      this.addFailedState.set(true);
    } finally {
      this.pendingState.set(false);
    }
  }

  /** confirming -> idle. Creates, cancels and removes nothing. */
  finish(): void {
    this.dropStale();
    if (this.phase() !== 'confirming') return;
    this.raw.set({ kind: 'idle' });
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

  private afterRender(callback: () => void): void {
    afterNextRender(callback, { injector: this.injector });
  }
}
