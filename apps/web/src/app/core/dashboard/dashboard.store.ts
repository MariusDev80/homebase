import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import {
  DASHBOARD_REPOSITORY,
  DataError,
  WIDGET_INSTANCE_REPOSITORY,
  type Dashboard,
  type GridRect,
  type JsonObject,
  type LayoutItem,
  type WidgetInstanceRecord,
} from '../../data';
import { nextFreePosition } from '../widgets/grid';
import { fallbackConstraints } from './grid-adapter';
import { applyNudge, fitLayout, sameRect } from './grid-layout';
import type { FittedLayout, LayoutDelta } from './grid-layout';
import type { WidgetConfigWriter } from '../widgets/widget-context';
import type { WidgetSizeConstraints, WidgetTypeId } from '../widgets/widget-definition';
import { PendingWrites } from '../widgets/pending-writes';
import { WidgetRegistry } from '../widgets/widget-registry';

export class WidgetLimitError extends Error {
  readonly widgetType: string;
  readonly maxInstances: number;

  constructor(widgetType: string, maxInstances: number) {
    super(`Widget "${widgetType}" is limited to ${maxInstances} instance(s) per dashboard`);
    this.name = 'WidgetLimitError';
    this.widgetType = widgetType;
    this.maxInstances = maxInstances;
  }
}

export class UnknownWidgetTypeError extends Error {
  readonly widgetType: string;

  constructor(widgetType: string) {
    super(`Unknown widget type "${widgetType}"`);
    this.name = 'UnknownWidgetTypeError';
    this.widgetType = widgetType;
  }
}

export type AddBlockReason = 'limit' | 'full';

export class GridFullError extends Error {
  readonly widgetType: string;

  constructor(widgetType: string) {
    super(`No room on the grid for widget "${widgetType}"`);
    this.name = 'GridFullError';
    this.widgetType = widgetType;
  }
}

export type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class DashboardStore implements WidgetConfigWriter {
  private readonly dashboards = inject(DASHBOARD_REPOSITORY);
  private readonly instanceRepository = inject(WIDGET_INSTANCE_REPOSITORY);
  private readonly registry = inject(WidgetRegistry);

  private readonly dashboardState = signal<Dashboard | null>(null);
  private readonly instancesState = signal<readonly WidgetInstanceRecord[]>([]);
  private readonly statusState = signal<DashboardStatus>('idle');
  private readonly errorState = signal<DataError | null>(null);

  readonly dashboard: Signal<Dashboard | null> = this.dashboardState.asReadonly();
  readonly instances: Signal<readonly WidgetInstanceRecord[]> = this.instancesState.asReadonly();
  readonly status: Signal<DashboardStatus> = this.statusState.asReadonly();
  readonly error: Signal<DataError | null> = this.errorState.asReadonly();

  /** Displayed rects (fitLayout of the stored ones): nothing is written by computing them. */
  readonly layout: Signal<FittedLayout> = computed(() =>
    fitLayout(
      this.instancesState().map((i) => ({
        id: i.id,
        grid: i.grid,
        constraints: this.constraintsOf(i),
      })),
    ),
  );

  private readonly layoutErrorState = signal(false);
  /** The last layout write failed and the layout went back to the persisted one. */
  readonly layoutError: Signal<boolean> = this.layoutErrorState.asReadonly();

  /** Last layout known to be in the database, by instance id (revert target on a failed write). */
  private readonly persistedGrids = new Map<string, GridRect>();
  private layoutWriting = false;
  private layoutPending = new Map<string, GridRect>();
  private layoutDrained: Promise<void> = Promise.resolve();

  constructor() {
    // The store is a singleton: the registration lasts as long as the application.
    inject(PendingWrites).register(() => this.layoutDrained);
  }

  /** createIfNone({ name }) then list()[0] then listByDashboard(id). */
  async load(defaultDashboardName: string): Promise<void> {
    this.statusState.set('loading');
    this.errorState.set(null);
    try {
      await this.dashboards.createIfNone({ name: defaultDashboardName });
      const [first] = await this.dashboards.list();
      if (!first) {
        throw new DataError('not_found', 'No dashboard available after createIfNone');
      }
      const instances = await this.instanceRepository.listByDashboard(first.id);
      this.dashboardState.set(first);
      this.instancesState.set(instances);
      this.persistedGrids.clear();
      for (const i of instances) this.persistedGrids.set(i.id, { ...i.grid });
      this.layoutPending.clear();
      this.statusState.set('ready');
    } catch (error) {
      this.errorState.set(
        error instanceof DataError
          ? error
          : new DataError('unknown', 'Dashboard load failed', { cause: error }),
      );
      this.statusState.set('error');
    }
  }

  /** Why the type cannot be added right now (limit of instances, no room), or null. */
  addBlockReason(type: WidgetTypeId): AddBlockReason | null {
    const definition = this.registry.get(type);
    if (!this.dashboardState() || !definition) return null;
    if (this.limitReached(type, definition.maxInstances)) return 'limit';
    return this.findRoom(definition.size) === null ? 'full' : null;
  }

  /** Dashboard loaded, type known, maxInstances not reached, room on the grid. */
  canAdd(type: WidgetTypeId): boolean {
    const definition = this.registry.get(type);
    if (!this.dashboardState() || !definition) return false;
    return this.addBlockReason(type) === null;
  }

  async add(type: WidgetTypeId): Promise<WidgetInstanceRecord> {
    const definition = this.registry.get(type);
    if (!definition) throw new UnknownWidgetTypeError(type);
    const dashboard = this.dashboardState();
    if (!dashboard) throw new DataError('unavailable', 'Dashboard not loaded');
    if (this.limitReached(type, definition.maxInstances)) {
      throw new WidgetLimitError(type, definition.maxInstances as number);
    }
    const displayed = new Map(this.layout().placed);
    const grid = this.findRoom(definition.size);
    if (!grid) throw new GridFullError(type);
    const record = await this.instanceRepository.create({
      dashboardId: dashboard.id,
      widgetType: type,
      grid,
      config: definition.config.defaults(),
      configVersion: definition.config.version,
    });
    this.persistedGrids.set(record.id, { ...record.grid });
    // The repositioned widgets are written with the displayed rects (D3).
    displayed.set(record.id, { ...record.grid });
    this.applyDisplayed(displayed, record);
    return record;
  }

  async remove(id: string): Promise<void> {
    // The displayed layout is read before the removal: the others must not move (D3).
    const displayed = new Map(this.layout().placed);
    await this.instanceRepository.remove(id);
    this.persistedGrids.delete(id);
    this.layoutPending.delete(id);
    displayed.delete(id);
    this.instancesState.update((list) => list.filter((i) => i.id !== id));
    this.applyDisplayed(displayed);
  }

  async resetConfig(id: string): Promise<void> {
    const record = this.instancesState().find((i) => i.id === id);
    const definition = record ? this.registry.get(record.widgetType) : undefined;
    if (!record || !definition) throw new UnknownWidgetTypeError(record?.widgetType ?? id);
    await this.saveConfig(id, definition.config.defaults(), definition.config.version);
  }

  async saveConfig(
    id: string,
    config: JsonObject,
    configVersion: number,
  ): Promise<WidgetInstanceRecord> {
    const updated = await this.instanceRepository.updateConfig(id, config, configVersion);
    // The local grid wins: a layout change may be optimistic and not written yet.
    this.instancesState.update((list) =>
      list.map((i) => (i.id === id ? { ...updated, grid: i.grid } : i)),
    );
    return updated;
  }

  /**
   * Layout change (end of a drag/resize, keyboard move). Only items whose rect really differs are
   * kept. The local state is updated at once; the write is coalesced (one in flight, one pending,
   * last value wins per item). On a failed write the layout goes back to the last persisted one
   * and `layoutError` is set. Never rejects; resolves when the write chain is idle.
   */
  changeLayout(items: readonly LayoutItem[]): Promise<void> {
    const dashboard = this.dashboardState();
    if (!dashboard) return Promise.resolve();
    const displayed = new Map(this.layout().placed);
    let really = false;
    for (const item of items) {
      const grid = displayed.get(item.id);
      if (grid && !sameRect(grid, item.grid)) {
        displayed.set(item.id, { ...item.grid });
        really = true;
      }
    }
    if (!really) return this.layoutDrained;
    // One batch: the changed widgets and every widget whose stored rect differs from the displayed one.
    this.applyDisplayed(displayed);
    return this.layoutDrained;
  }

  /**
   * Sets the local state to `target` (rect by id; `added` is a record just created) and queues the
   * write of every placed widget whose stored rect differs. Widgets without room keep their rect.
   */
  private applyDisplayed(
    target: ReadonlyMap<string, GridRect>,
    added?: WidgetInstanceRecord,
  ): void {
    const dashboard = this.dashboardState();
    if (!dashboard) return;
    const changed = new Map<string, GridRect>();
    const base = added ? [...this.instancesState(), added] : this.instancesState();
    for (const instance of base) {
      const grid = target.get(instance.id);
      if (grid && !sameRect(grid, instance.grid)) changed.set(instance.id, { ...grid });
    }
    if (changed.size > 0 || added) {
      this.instancesState.set(
        base
          .map((i) => {
            const grid = changed.get(i.id);
            return grid ? { ...i, grid } : i;
          })
          .sort(compareInstances),
      );
    }
    if (changed.size === 0) return;
    this.layoutErrorState.set(false);
    for (const [id, grid] of changed) this.layoutPending.set(id, grid);
    if (!this.layoutWriting) this.layoutDrained = this.drainLayout(dashboard.id);
  }

  /**
   * Keyboard move/resize of one widget by a grid delta, bounded to its constraints; overlapped
   * widgets are pushed down. Returns the new displayed rect, or null when nothing changed.
   */
  nudge(id: string, delta: LayoutDelta): GridRect | null {
    const placed = this.layout().placed;
    const entries = this.instancesState().flatMap((i) => {
      const grid = placed.get(i.id);
      return grid ? [{ id: i.id, grid, constraints: this.constraintsOf(i) }] : [];
    });
    const items = applyNudge(entries, id, delta);
    if (items.length === 0) return null;
    void this.changeLayout(items);
    return items.find((i) => i.id === id)?.grid ?? null;
  }

  private async drainLayout(dashboardId: string): Promise<void> {
    this.layoutWriting = true;
    try {
      while (this.layoutPending.size > 0) {
        const job = this.layoutPending;
        this.layoutPending = new Map();
        const items = [...job].map(([id, grid]) => ({ id, grid }));
        try {
          await this.instanceRepository.updateLayout(dashboardId, items);
          for (const [id, grid] of job) {
            if (this.persistedGrids.has(id)) this.persistedGrids.set(id, grid);
          }
        } catch (error) {
          console.error('Could not save the dashboard layout', error);
          this.layoutPending = new Map();
          this.instancesState.update((list) =>
            list
              .map((i) => {
                const grid = this.persistedGrids.get(i.id);
                return grid ? { ...i, grid: { ...grid } } : i;
              })
              .sort(compareInstances),
          );
          this.layoutErrorState.set(true);
        }
      }
    } finally {
      this.layoutWriting = false;
    }
  }

  private constraintsOf(instance: WidgetInstanceRecord): WidgetSizeConstraints {
    return this.registry.get(instance.widgetType)?.size ?? fallbackConstraints(instance.grid);
  }

  /** First free rect among the displayed ones for a new widget of this size, or null. */
  private findRoom(size: WidgetSizeConstraints): GridRect | null {
    return nextFreePosition([...this.layout().placed.values()], size.default, size.min);
  }

  private limitReached(type: WidgetTypeId, max: number | undefined): boolean {
    if (max === undefined) return false;
    return this.instancesState().filter((i) => i.widgetType === type).length >= max;
  }
}

/** Same order as WidgetInstanceRepository.listByDashboard. */
function compareInstances(a: WidgetInstanceRecord, b: WidgetInstanceRecord): number {
  return (
    a.grid.y - b.grid.y ||
    a.grid.x - b.grid.x ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}
