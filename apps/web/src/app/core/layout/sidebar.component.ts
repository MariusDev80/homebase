import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Dashboard } from '../../data';
import { dashboardIconClass } from '../dashboard/dashboard-icons';
import { DashboardListStore } from '../dashboard/dashboard-list.store';
import { DashboardStore } from '../dashboard/dashboard.store';
import { DashboardFormDialogComponent } from './dashboard-form-dialog.component';

interface SidebarLabel {
  readonly text: string;
  readonly top: number;
  readonly left: number;
}

interface BubbleMenu {
  readonly dashboard: Dashboard;
  readonly top: number;
  readonly left: number;
}

/** Height reserved under the menu so that it stays inside the window. */
const MENU_MIN_ROOM = 96;

/** Vertical bar: one icon bubble per destination, with a floating text bubble on hover/focus. */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe, DashboardFormDialogComponent],
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sidebar',
    '(document:keydown.escape)': 'onEscape()',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class SidebarComponent {
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly list = inject(DashboardListStore);
  private readonly store = inject(DashboardStore);
  protected readonly label = signal<SidebarLabel | null>(null);
  protected readonly menu = signal<BubbleMenu | null>(null);
  /** Dialog state: `dashboard` null creates, otherwise edits. */
  protected readonly form = signal<{ readonly dashboard: Dashboard | null } | null>(null);
  protected readonly announcement = signal('');
  private readonly scrollArea = viewChild<ElementRef<HTMLElement>>('scrollArea');
  private readonly menuRoot = viewChild<ElementRef<HTMLElement>>('menuRoot');
  /** Current anchor: the hovered or focused bubble, to reposition on list scroll. */
  private anchor: HTMLElement | null = null;
  /** Element that opened the menu or the dialog: gets the focus back. */
  private trigger: HTMLElement | null = null;

  /** In the order of the bar: sort_order, the repository already breaks ties. */
  protected readonly dashboards = computed(() =>
    [...this.list.dashboards()].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  protected readonly addLabelKey = computed(() =>
    this.list.status() === 'ready' && !this.list.canCreate()
      ? 'dashboards.limit'
      : 'dashboards.add',
  );

  constructor() {
    // Announce the dashboard shown at each change (not the first one).
    let seen: string | null = null;
    effect(() => {
      const current = this.store.dashboard();
      if (!current) return;
      untracked(() => {
        if (seen === null) {
          seen = current.id;
          return;
        }
        if (seen === current.id) return;
        seen = current.id;
        const name = this.list.dashboards().find((d) => d.id === current.id)?.name ?? current.name;
        this.announcement.set(this.transloco.translate('layout.current', { name }));
      });
    });
  }

  protected iconClass(icon: string): string {
    return dashboardIconClass(icon);
  }

  /** mouseenter, or a focusin whose target is :focus-visible (keyboard). */
  protected showLabel(event: Event, text: string, translate = true): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    if (event.type === 'focusin' && !target.matches(':focus-visible')) return;
    this.anchor = target;
    this.label.set(this.place(target, translate ? this.transloco.translate(text) : text));
  }

  protected hideLabel(): void {
    this.anchor = null;
    if (this.label() !== null) this.label.set(null);
  }

  /** Scroll of the list: follows the anchor, removes the label if the anchor is out of view. */
  protected onListScroll(): void {
    // The menu is fixed: a scrolled bubble would leave it behind.
    if (this.menu() !== null) this.closeMenu(false);
    const anchor = this.anchor;
    const current = this.label();
    const area = this.scrollArea()?.nativeElement;
    if (!anchor || !current || !area) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = area.getBoundingClientRect();
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
      this.hideLabel();
      return;
    }
    this.label.set(this.place(anchor, current.text));
  }

  private place(anchor: HTMLElement, text: string): SidebarLabel {
    const rect = anchor.getBoundingClientRect();
    return { text, top: rect.top + 4, left: rect.right + 8 };
  }

  // ---- Context menu of a dashboard bubble ----

  /** Right click, Menu key or Shift+F10 on a bubble. Idempotent for an open menu. */
  protected openMenu(event: Event, dashboard: Dashboard): void {
    event.preventDefault();
    const bubble = event.currentTarget as HTMLElement | null;
    if (!bubble) return;
    this.hideLabel();
    if (this.menu()?.dashboard.id === dashboard.id) {
      this.focusItem(0);
      return;
    }
    const rect = bubble.getBoundingClientRect();
    this.trigger = bubble;
    this.menu.set({
      dashboard,
      left: rect.right + 8,
      top: Math.min(rect.top, window.innerHeight - MENU_MIN_ROOM),
    });
    afterNextRender(() => this.focusItem(0), { injector: this.injector });
  }

  protected onBubbleKeydown(event: KeyboardEvent, dashboard: Dashboard): void {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      this.openMenu(event, dashboard);
    }
  }

  private closeMenu(restoreFocus: boolean): void {
    this.menu.set(null);
    if (restoreFocus) this.trigger?.focus();
  }

  private enabledItems(): HTMLElement[] {
    const root = this.menuRoot()?.nativeElement;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
  }

  private focusItem(index: number): void {
    this.enabledItems().at(index)?.focus();
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const items = this.enabledItems();
        if (items.length === 0) return;
        const down = event.key === 'ArrowDown';
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = current === -1 ? (down ? 0 : items.length - 1) : current + (down ? 1 : -1);
        items.at(next % items.length)?.focus();
        return;
      }
      case 'Home':
      case 'End':
        event.preventDefault();
        this.focusItem(event.key === 'Home' ? 0 : -1);
        return;
      case 'Tab':
        this.closeMenu(false);
        return;
    }
  }

  protected onEscape(): void {
    this.hideLabel();
    if (this.menu() !== null) this.closeMenu(true);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.menu() === null) return;
    const root = this.menuRoot()?.nativeElement;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    this.closeMenu(false);
  }

  // ---- Dialog ----

  protected openCreate(event: Event): void {
    if (!this.list.canCreate()) return;
    this.trigger = event.currentTarget as HTMLElement;
    this.hideLabel();
    this.form.set({ dashboard: null });
  }

  protected openEdit(): void {
    const target = this.menu()?.dashboard;
    if (!target) return;
    // `trigger` is still the bubble of the menu.
    this.menu.set(null);
    this.hideLabel();
    this.form.set({ dashboard: target });
  }

  /** `saved`: the dashboard that was created or updated; null when dismissed. */
  protected onFormClosed(saved: Dashboard | null): void {
    const wasCreation = this.form()?.dashboard === null;
    const trigger = this.trigger;
    this.trigger = null;
    this.form.set(null);
    afterNextRender(
      () => {
        const created =
          saved && wasCreation
            ? Array.from(
                this.host.nativeElement.querySelectorAll<HTMLElement>('[data-dashboard-id]'),
              ).find((el) => el.dataset['dashboardId'] === saved.id)
            : undefined;
        const target = created ?? (trigger?.isConnected ? trigger : null);
        target?.focus();
      },
      { injector: this.injector },
    );
  }
}
