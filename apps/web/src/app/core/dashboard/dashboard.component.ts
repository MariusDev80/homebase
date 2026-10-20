import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GridRect, WidgetInstanceRecord } from '../../data';
import { GRID_COLUMNS, GRID_MAX_ROWS, clampGrid } from '../widgets/grid';
import type { WidgetTypeId } from '../widgets/widget-definition';
import { WidgetHostComponent } from '../widgets/widget-host.component';
import { WidgetRegistry } from '../widgets/widget-registry';
import { DashboardStore } from './dashboard.store';

@Component({
  selector: 'app-dashboard',
  imports: [TranslocoPipe, WidgetHostComponent],
  templateUrl: './dashboard.component.html',
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

  /** CSS Grid placement (1-based lines). Unknown types are only bounded to the column count. */
  protected placement(instance: WidgetInstanceRecord): Record<string, string> {
    const grid = this.boundedGrid(instance);
    return {
      'grid-column': `${grid.x + 1} / span ${grid.w}`,
      'grid-row': `${grid.y + 1} / span ${grid.h}`,
    };
  }

  private boundedGrid(instance: WidgetInstanceRecord): GridRect {
    const definition = this.registry.get(instance.widgetType);
    if (definition) return clampGrid(instance.grid, definition.size);
    const w = Math.min(Math.max(1, Math.floor(instance.grid.w) || 1), GRID_COLUMNS);
    const x = Math.min(Math.max(0, Math.floor(instance.grid.x) || 0), GRID_COLUMNS - w);
    return {
      x,
      y: Math.max(0, Math.floor(instance.grid.y) || 0),
      w,
      h: Math.min(Math.max(1, Math.floor(instance.grid.h) || 1), GRID_MAX_ROWS),
    };
  }
}
