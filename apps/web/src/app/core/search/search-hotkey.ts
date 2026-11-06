import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { Router } from '@angular/router';
import { WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { DashboardStore } from '../dashboard/dashboard.store';
import { AppLock } from '../lock/app-lock';

/**
 * Type id of the search widget. Declared here (core/ imports no widget): the string coupling with
 * `widgets/search` is deliberate and noted in ADR-001.
 */
export const SEARCH_WIDGET_TYPE = 'search';

interface PendingFocus {
  readonly dashboardId: string;
  /** Store session of the target dashboard once it is open; null until then. */
  session: number | null;
}

/** True when typing in this element must not be hijacked by a single-key shortcut. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The single, global keyboard shortcut of the search bar: Ctrl+K (Cmd+K) anywhere, and `/`
 * outside text fields. Registered once here (root service); the search widget only
 * `register`s the function that focuses its field. Without a search bar on the current page,
 * Ctrl+K goes to the first dashboard that has one and focuses it there; `/` does nothing.
 */
@Injectable({ providedIn: 'root' })
export class SearchHotkey {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly lock = inject(AppLock);
  private readonly store = inject(DashboardStore);
  private readonly instances = inject(WIDGET_INSTANCE_REPOSITORY);
  private readonly injector = inject(Injector);
  private readonly targets: (() => void)[] = [];
  private pending: PendingFocus | null = null;

  constructor() {
    const listener = (event: KeyboardEvent): void => this.onKeydown(event);
    this.document.addEventListener('keydown', listener);
    inject(DestroyRef).onDestroy(() => this.document.removeEventListener('keydown', listener));
  }

  /** Makes `focus` the target of the shortcut (last registration wins); returns the unregister function. */
  register(focus: () => void): () => void {
    this.targets.push(focus);
    this.consumePending(focus);
    return () => {
      const index = this.targets.indexOf(focus);
      if (index >= 0) this.targets.splice(index, 1);
    };
  }

  /** A pending Ctrl+K request is consumed by the registration of the right dashboard's bar. */
  private consumePending(focus: () => void): void {
    const pending = this.pending;
    if (!pending) return;
    const session = this.store.session();
    if (pending.session !== null && pending.session !== session) {
      this.pending = null;
      return;
    }
    if (pending.dashboardId !== this.store.dashboard()?.id) return;
    this.pending = null;
    // The field does not exist yet when the component registers.
    afterNextRender(() => focus(), { injector: this.injector });
  }

  private onKeydown(event: KeyboardEvent): void {
    if (this.lock.isLocked() || event.defaultPrevented) return;
    const withModifier = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const isCtrlK = withModifier && event.key.toLowerCase() === 'k';
    const isSlash =
      event.key === '/' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isTextEntry(event.target);
    if (!isCtrlK && !isSlash) return;
    const target = this.targets.at(-1);
    if (target) {
      event.preventDefault();
      target();
      return;
    }
    if (!isCtrlK) return;
    event.preventDefault();
    void this.goToSearchBar();
  }

  private async goToSearchBar(): Promise<void> {
    let record;
    try {
      record = await this.instances.findFirstOfType(SEARCH_WIDGET_TYPE);
    } catch {
      return;
    }
    if (!record) return;
    const dashboardId = record.dashboardId;
    const request: PendingFocus = { dashboardId, session: null };
    this.pending = request;
    const abandon = (): void => {
      if (this.pending === request) this.pending = null;
    };
    let navigated: boolean;
    try {
      navigated = await this.router.navigate(['/dashboards', dashboardId]);
    } catch {
      navigated = false;
    }
    if (!navigated) {
      abandon();
      return;
    }
    const outcome = await this.store.whenOpened();
    if (outcome !== 'ready' || this.store.dashboard()?.id !== dashboardId) {
      abandon();
      return;
    }
    if (this.pending === request) request.session = this.store.session();
  }
}
