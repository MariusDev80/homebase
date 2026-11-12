import { Injectable, Signal, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { WIDGET_INSTANCE_REPOSITORY } from '../../data';
import type { WidgetInstanceRecord } from '../../data';
import { DashboardStore } from './dashboard.store';

export interface WidgetFocusRequest {
  readonly instanceId: string;
  /** Increases on every request, so asking twice for the same instance is a new request. */
  readonly sequence: number;
  /** Session of the dashboard store when the request was made. */
  readonly session: number;
}

export type WidgetFocusOutcome = 'focused' | 'not-found' | 'unplaced';

/**
 * Brings a widget instance into view (focus, brief highlight), on another dashboard if needed.
 * Widgets only ask; the widget host owning the instance claims `request`.
 */
@Injectable({ providedIn: 'root' })
export class WidgetFocus {
  private readonly store = inject(DashboardStore);
  private readonly router = inject(Router);
  private readonly instances = inject(WIDGET_INSTANCE_REPOSITORY);
  private readonly requestState = signal<WidgetFocusRequest | null>(null);
  private sequence = 0;
  private claimedSequence = 0;

  readonly request: Signal<WidgetFocusRequest | null> = this.requestState.asReadonly();

  /**
   * Goes to the dashboard of the instance if needed, waits for it to open, then requests the
   * focus. 'not-found': absent instance, failed read, refused navigation or failed opening;
   * 'unplaced': the instance exists but has no room on the grid.
   */
  async focusInstance(instanceId: string): Promise<WidgetFocusOutcome> {
    // Same dashboard: no await before the request (the caller refocuses its field right after).
    if (this.store.instances().some((i) => i.id === instanceId))
      return this.requestOrUnplaced(instanceId);

    let record: WidgetInstanceRecord | null;
    try {
      record = await this.instances.get(instanceId);
    } catch {
      return 'not-found';
    }
    if (!record) return 'not-found';
    try {
      if (!(await this.router.navigate(['/dashboards', record.dashboardId]))) return 'not-found';
    } catch {
      return 'not-found';
    }
    if ((await this.store.whenOpened()) !== 'ready') return 'not-found';
    if (this.store.dashboard()?.id !== record.dashboardId) return 'not-found';
    if (!this.store.instances().some((i) => i.id === instanceId)) return 'not-found';
    return this.requestOrUnplaced(instanceId);
  }

  /** true once per request, and only while its session is the current one. */
  claim(request: WidgetFocusRequest): boolean {
    if (request.session !== this.store.session()) return false;
    if (request.sequence <= this.claimedSequence) return false;
    this.claimedSequence = request.sequence;
    return true;
  }

  private requestOrUnplaced(instanceId: string): WidgetFocusOutcome {
    if (!this.store.layout().placed.has(instanceId)) return 'unplaced';
    this.requestState.set({
      instanceId,
      sequence: ++this.sequence,
      session: this.store.session(),
    });
    return 'focused';
  }
}
