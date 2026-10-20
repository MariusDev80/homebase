import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  protected readonly store = inject(DashboardStore);
  protected readonly registry = inject(WidgetRegistry);
  private readonly transloco = inject(TranslocoService);

  protected readonly adding = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly addFailed = signal(false);

  constructor() {
    void this.store.load(this.transloco.translate('dashboard.defaultName'));
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
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
      this.menuOpen.set(false);
    } catch (error: unknown) {
      console.error('Could not add widget', error);
      this.addFailed.set(true);
    } finally {
      this.adding.set(false);
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
