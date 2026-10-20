import { Injectable, Signal, inject, signal } from '@angular/core';
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
import { boundGrid, fallbackConstraints } from './grid-adapter';
import { applyNudge, sameRect } from './grid-layout';
import type { LayoutDelta } from './grid-layout';
import type { WidgetConfigWriter } from '../widgets/widget-context';
import type { WidgetTypeId } from '../widgets/widget-definition';
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

  private readonly layoutErrorState = signal(false);
  /** The last layout write failed and the layout went back to the persisted one. */
  readonly layoutError: Signal<boolean> = this.layoutErrorState.asReadonly();

  /** Last layout known to be in the database, by instance id (revert target on a failed write). */
  private readonly persistedGrids = new Map<string, GridRect>();
  private layoutWriting = false;
  private layoutPending = new Map<string, GridRect>();
  private layoutDrained: Promise<void> = Promise.resolve();

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

  /** Dashboard loaded, type known, maxInstances not reached. */
  canAdd(type: WidgetTypeId): boolean {
    const definition = this.registry.get(type);
    if (!this.dashboardState() || !definition) return false;
    return !this.limitReached(type, definition.maxInstances);
  }

  async add(type: WidgetTypeId): Promise<WidgetInstanceRecord> {
    const definition = this.registry.get(type);
    if (!definition) throw new UnknownWidgetTypeError(type);
    const dashboard = this.dashboardState();
    if (!dashboard) throw new DataError('unavailable', 'Dashboard not loaded');
    if (this.limitReached(type, definition.maxInstances)) {
      throw new WidgetLimitError(type, definition.maxInstances as number);
    }
    const record = await this.instanceRepository.create({
      dashboardId: dashboard.id,
      widgetType: type,
      grid: nextFreePosition(
        this.instancesState().map((i) => i.grid),
        definition.size.default,
      ),
      config: definition.config.defaults(),
      configVersion: definition.config.version,
    });
    this.persistedGrids.set(record.id, { ...record.grid });
    this.instancesState.update((list) => [...list, record].sort(compareInstances));
    return record;
  }

  async remove(id: string): Promise<void> {
    await this.instanceRepository.remove(id);
    this.persistedGrids.delete(id);
    this.layoutPending.delete(id);
    this.instancesState.update((list) => list.filter((i) => i.id !== id));
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
    const current = new Map(this.instancesState().map((i) => [i.id, i.grid]));
    const changed = new Map<string, GridRect>();
    for (const item of items) {
      const grid = current.get(item.id);
      if (grid && !sameRect(grid, item.grid)) changed.set(item.id, { ...item.grid });
    }
    if (changed.size === 0) return this.layoutDrained;

    this.layoutErrorState.set(false);
    this.instancesState.update((list) =>
      list
        .map((i) => {
          const grid = changed.get(i.id);
          return grid ? { ...i, grid } : i;
        })
        .sort(compareInstances),
    );
    for (const [id, grid] of changed) this.layoutPending.set(id, grid);
    if (!this.layoutWriting) this.layoutDrained = this.drainLayout(dashboard.id);
    return this.layoutDrained;
  }

  /**
   * Keyboard move/resize of one widget by a grid delta, bounded to its constraints; overlapped
   * widgets are pushed down. Returns the new displayed rect, or null when nothing changed.
   */
  nudge(id: string, delta: LayoutDelta): GridRect | null {
    const entries = this.instancesState().map((i) => {
      const constraints = this.registry.get(i.widgetType)?.size ?? fallbackConstraints(i.grid);
      return { id: i.id, grid: boundGrid(i.grid, constraints), constraints };
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
