import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { DashboardDeleteDialogComponent } from './dashboard-delete-dialog.component';
import { WidgetPickerDialogComponent } from './widget-picker-dialog.component';
import { WidgetAddFlow } from '../dashboard/widget-add-flow';
import { WidgetRegistry } from '../widgets/widget-registry';

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
  imports: [
    RouterLink,
    RouterLinkActive,
    TranslocoPipe,
    DashboardFormDialogComponent,
    DashboardDeleteDialogComponent,
    WidgetPickerDialogComponent,
  ],
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
  protected readonly removal = signal<{ readonly dashboard: Dashboard } | null>(null);
  protected readonly announcement = signal('');
  protected readonly flow = inject(WidgetAddFlow);
  private readonly registry = inject(WidgetRegistry);
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addWidgetButton');
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

  protected readonly widgetLabelKey = computed(() => {
    switch (this.flow.phase()) {
      case 'unavailable':
        return 'dashboard.addWidgetUnavailable';
      case 'confirming':
        return 'dashboard.finishAdd';
      default:
        return 'dashboard.addWidget';
    }
  });

  constructor() {
    // The add button tells the flow how to take the focus back (after the pop-up, a removal).
    const unregister = this.flow.registerTrigger(() => this.addButton()?.nativeElement.focus());
    inject(DestroyRef).onDestroy(unregister);
    // Announce the widget just added (the blue V is then the active control).
    effect(() => {
      const id = this.flow.newInstanceId();
      if (id === null) return;
      untracked(() => {
        const type = this.store.instances().find((i) => i.id === id)?.widgetType;
        const key = type ? this.registry.get(type)?.titleKey : undefined;
        const title = key ? this.transloco.translate(key) : (type ?? '');
        this.announcement.set(this.transloco.translate('dashboard.widgetAdded', { title }));
      });
    });
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

  // ---- Add widget (green +, blue V) ----

  protected onWidgetButton(): void {
    switch (this.flow.phase()) {
      case 'idle':
        this.hideLabel();
        this.flow.open();
        return;
      case 'confirming':
        this.flow.finish();
        return;
      default:
        return;
    }
  }

  /** Escape on the V ends the add, like a click. */
  protected onWidgetEscape(event: Event): void {
    if (this.flow.phase() !== 'confirming') return;
    event.preventDefault();
    this.flow.finish();
  }

  // ---- Dialog ----

  protected openCreate(event: Event): void {
    if (!this.list.canCreate()) return;
    this.trigger = event.currentTarget as HTMLElement;
    this.hideLabel();
    this.form.set({ dashboard: null });
  }

  protected openRemove(): void {
    const target = this.menu()?.dashboard;
    if (!target || !this.list.canRemove()) return;
    // `trigger` is still the bubble of the menu.
    this.menu.set(null);
    this.hideLabel();
    this.removal.set({ dashboard: target });
  }

  /** `deleted`: the dashboard is gone; the focus goes to the active bubble, else the `+`. */
  protected onRemovalClosed(deleted: boolean): void {
    const trigger = this.trigger;
    this.trigger = null;
    this.removal.set(null);
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        const target = deleted
          ? (root.querySelector<HTMLElement>('[data-dashboard-id][aria-current="page"]') ??
            root.querySelector<HTMLElement>('[data-testid="sidebar-add-dashboard"]'))
          : trigger?.isConnected
            ? trigger
            : null;
        target?.focus();
      },
      { injector: this.injector },
    );
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
