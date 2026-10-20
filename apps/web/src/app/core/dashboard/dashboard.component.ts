import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { Gridster, GridsterItem } from 'angular-gridster2';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { LayoutItem, WidgetInstanceRecord } from '../../data';
import type { WidgetTypeId } from '../widgets/widget-definition';
import { WidgetHostComponent } from '../widgets/widget-host.component';
import { WidgetRegistry } from '../widgets/widget-registry';
import { DashboardStore } from './dashboard.store';
import {
  boundGrid,
  buildGridOptions,
  fallbackConstraints,
  fromGridsterItem,
  sameGridsterItem,
  toGridsterItem,
} from './grid-adapter';
import type { DashboardGridItem } from './grid-adapter';

interface GridEntry {
  readonly instance: WidgetInstanceRecord;
  readonly item: DashboardGridItem;
}

@Component({
  selector: 'app-dashboard',
  imports: [TranslocoPipe, WidgetHostComponent, Gridster, GridsterItem],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  // Unencapsulated: restyles the gridster elements (unlayered library CSS) with the tokens.
  encapsulation: ViewEncapsulation.None,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown)': 'onMenuKeydown($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  protected readonly store = inject(DashboardStore);
  protected readonly registry = inject(WidgetRegistry);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly menuRoot = viewChild<ElementRef<HTMLElement>>('menuRoot');
  private readonly menuTrigger = viewChild<ElementRef<HTMLButtonElement>>('menuTrigger');

  protected readonly adding = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly addFailed = signal(false);
  /** Layout edit mode: drag, resize and keyboard move are enabled only while true. */
  protected readonly editing = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly changedItems = new Map<string, LayoutItem>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Gridster mutates its item objects in place: keep them while their values are unchanged. */
  private readonly itemCache = new Map<string, DashboardGridItem>();

  protected readonly gridOptions = computed(() =>
    buildGridOptions({ editing: this.editing(), onItemChange: (item) => this.onItemChange(item) }),
  );

  protected readonly entries = computed<GridEntry[]>(() => {
    const seen = new Set<string>();
    const entries = this.store.instances().map((instance) => {
      const constraints =
        this.registry.get(instance.widgetType)?.size ?? fallbackConstraints(instance.grid);
      const wanted = toGridsterItem(
        instance.id,
        boundGrid(instance.grid, constraints),
        constraints,
      );
      const cached = this.itemCache.get(instance.id);
      const item = cached && sameGridsterItem(cached, wanted) ? cached : wanted;
      this.itemCache.set(instance.id, item);
      seen.add(instance.id);
      return { instance, item };
    });
    for (const id of this.itemCache.keys()) if (!seen.has(id)) this.itemCache.delete(id);
    return entries;
  });

  constructor() {
    // A widget was removed (its host is destroyed with the focus on it): keep the focus in the
    // page by moving it to the add-widget button.
    let previousCount = 0;
    effect(() => {
      const count = this.store.instances().length;
      if (count < previousCount) {
        afterNextRender(() => this.menuTrigger()?.nativeElement.focus(), {
          injector: this.injector,
        });
      }
      previousCount = count;
    });
    this.destroyRef.onDestroy(() => this.flushLayout());
    void this.store.load(this.transloco.translate('dashboard.defaultName'));
  }

  protected toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeMenu(false);
    } else {
      this.openMenu('first');
    }
  }

  private openMenu(focus: 'first' | 'last' | null): void {
    this.menuOpen.set(true);
    if (focus) {
      afterNextRender(() => this.focusItem(focus === 'first' ? 0 : -1), {
        injector: this.injector,
      });
    }
  }

  private closeMenu(restoreFocus: boolean): void {
    this.menuOpen.set(false);
    if (restoreFocus) this.menuTrigger()?.nativeElement.focus();
  }

  /** Enabled items only: disabled entries (maxInstances reached, add in progress) are skipped. */
  private enabledItems(): HTMLButtonElement[] {
    const root = this.menuRoot()?.nativeElement;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
  }

  private focusItem(index: number): void {
    const items = this.enabledItems();
    if (items.length === 0) return;
    items.at(index)?.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    const root = this.menuRoot()?.nativeElement;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    this.closeMenu(false);
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const root = this.menuRoot()?.nativeElement;
    if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;
    const open = this.menuOpen();
    switch (event.key) {
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        this.closeMenu(true);
        return;
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const down = event.key === 'ArrowDown';
        if (!open) {
          this.openMenu(down ? 'first' : 'last');
          return;
        }
        const items = this.enabledItems();
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = current === -1 ? (down ? 0 : items.length - 1) : current + (down ? 1 : -1);
        items.at(next % items.length)?.focus();
        return;
      }
      case 'Home':
      case 'End':
        if (!open) return;
        event.preventDefault();
        this.focusItem(event.key === 'Home' ? 0 : -1);
        return;
      case 'Tab':
        if (open) this.closeMenu(false);
        return;
    }
  }

  protected canAdd(type: WidgetTypeId): boolean {
    return !this.adding() && this.store.canAdd(type);
  }

  protected async add(type: WidgetTypeId): Promise<void> {
    if (!this.canAdd(type)) return;
    this.adding.set(true);
    this.addFailed.set(false);
    try {
      await this.store.add(type);
      this.closeMenu(true);
    } catch (error: unknown) {
      console.error('Could not add widget', error);
      this.addFailed.set(true);
    } finally {
      this.adding.set(false);
      // Entries were disabled while adding, which dropped the focus: restore it on a failure.
      if (this.addFailed()) {
        afterNextRender(() => this.focusItem(0), { injector: this.injector });
      }
    }
  }

  protected toggleEditing(): void {
    if (this.editing()) this.flushLayout();
    this.editing.update((value) => !value);
  }

  /** Gridster reports each changed item (dragged, resized or pushed): batch them into one write. */
  private onItemChange(item: DashboardGridItem): void {
    if (!this.editing()) return;
    this.changedItems.set(item.id, fromGridsterItem(item));
    this.flushTimer ??= setTimeout(() => this.flushLayout(), 0);
  }

  private flushLayout(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.changedItems.size === 0) return;
    const items = [...this.changedItems.values()];
    this.changedItems.clear();
    void this.store.changeLayout(items);
  }
}
