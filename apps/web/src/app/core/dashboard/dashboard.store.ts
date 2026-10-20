import { Injectable, Signal, inject, signal } from '@angular/core';
import {
  DASHBOARD_REPOSITORY,
  DataError,
  WIDGET_INSTANCE_REPOSITORY,
  type Dashboard,
  type JsonObject,
  type WidgetInstanceRecord,
} from '../../data';
import { nextFreePosition } from '../widgets/grid';
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
    this.instancesState.update((list) => [...list, record].sort(compareInstances));
    return record;
  }

  async remove(id: string): Promise<void> {
    await this.instanceRepository.remove(id);
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
    this.instancesState.update((list) => list.map((i) => (i.id === id ? updated : i)));
    return updated;
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
