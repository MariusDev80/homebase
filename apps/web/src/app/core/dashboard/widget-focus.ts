import { Injectable, Signal, inject, signal } from '@angular/core';
import { DashboardStore } from './dashboard.store';

export interface WidgetFocusRequest {
  readonly instanceId: string;
  /** Increases on every request, so asking twice for the same instance is a new request. */
  readonly sequence: number;
}

/**
 * Brings a widget instance of the current dashboard into view (scroll, focus, brief highlight).
 * Widgets only ask; the widget host owning the instance reacts to `request`.
 */
@Injectable({ providedIn: 'root' })
export class WidgetFocus {
  private readonly store = inject(DashboardStore);
  private readonly requestState = signal<WidgetFocusRequest | null>(null);
  private sequence = 0;

  readonly request: Signal<WidgetFocusRequest | null> = this.requestState.asReadonly();

  /** 'not-found' when the instance is not on the current dashboard (or no longer exists). */
  focusInstance(instanceId: string): 'focused' | 'not-found' {
    if (!this.store.instances().some((i) => i.id === instanceId)) return 'not-found';
    this.requestState.set({ instanceId, sequence: ++this.sequence });
    return 'focused';
  }
}
