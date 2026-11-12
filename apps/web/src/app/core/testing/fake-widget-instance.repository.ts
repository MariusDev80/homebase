import { DataError } from '../../data';
import type {
  JsonObject,
  LayoutItem,
  NewWidgetInstance,
  WidgetInstanceRepository,
  WidgetInstanceRecord,
} from '../../data';

/** In-memory WidgetInstanceRepository with deterministic ids and timestamps (specs only). */
export class FakeWidgetInstanceRepository implements WidgetInstanceRepository {
  readonly items: WidgetInstanceRecord[] = [];
  private counter = 0;
  private nextFailure: unknown;

  /** The next call rejects with `error`. */
  failNext(error: unknown): void {
    this.nextFailure = error;
  }

  /** Test helper: inserts a record as is (e.g. unknown type, future config version). */
  seed(
    record: Partial<WidgetInstanceRecord> & Pick<WidgetInstanceRecord, 'dashboardId'>,
  ): WidgetInstanceRecord {
    this.counter++;
    const stamp = this.stamp();
    const full: WidgetInstanceRecord = {
      id: `instance-${this.counter}`,
      widgetType: 'hello',
      grid: { x: 0, y: 0, w: 3, h: 2 },
      config: {},
      configVersion: 1,
      createdAt: stamp,
      updatedAt: stamp,
      ...record,
    };
    this.items.push(full);
    return full;
  }

  private stamp(): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.counter)).toISOString();
  }

  private check(): Promise<void> {
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  async listByDashboard(dashboardId: string): Promise<WidgetInstanceRecord[]> {
    await this.check();
    return this.items
      .filter((i) => i.dashboardId === dashboardId)
      .sort(
        (a, b) =>
          a.grid.y - b.grid.y ||
          a.grid.x - b.grid.x ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
  }

  async get(id: string): Promise<WidgetInstanceRecord | null> {
    await this.check();
    return this.items.find((i) => i.id === id) ?? null;
  }

  async create(input: NewWidgetInstance): Promise<WidgetInstanceRecord> {
    await this.check();
    return this.seed({ ...input });
  }

  async updateConfig(
    id: string,
    config: JsonObject,
    configVersion: number,
  ): Promise<WidgetInstanceRecord> {
    await this.check();
    const index = this.items.findIndex((i) => i.id === id);
    const current = this.items[index];
    if (!current) throw new DataError('not_found', `Widget instance ${id} not found`);
    this.counter++;
    const updated: WidgetInstanceRecord = {
      ...current,
      config,
      configVersion,
      updatedAt: this.stamp(),
    };
    this.items[index] = updated;
    return updated;
  }

  async updateLayout(dashboardId: string, items: readonly LayoutItem[]): Promise<number> {
    await this.check();
    let changed = 0;
    for (const item of items) {
      const index = this.items.findIndex((i) => i.id === item.id && i.dashboardId === dashboardId);
      const current = this.items[index];
      if (current) {
        this.items[index] = { ...current, grid: { ...item.grid } };
        changed++;
      }
    }
    return changed;
  }

  async moveToDashboard(targetDashboardId: string, items: readonly LayoutItem[]): Promise<number> {
    await this.check();
    let changed = 0;
    for (const item of items) {
      const index = this.items.findIndex((i) => i.id === item.id);
      const current = this.items[index];
      if (current) {
        this.items[index] = { ...current, dashboardId: targetDashboardId, grid: { ...item.grid } };
        changed++;
      }
    }
    return changed;
  }

  /**
   * Dashboard ids in dashboard order (sort_order, created_at, id); set by the spec. Instances on a
   * dashboard absent from the list sort last.
   */
  dashboardOrder: readonly string[] = [];

  async findFirstOfType(widgetType: string): Promise<WidgetInstanceRecord | null> {
    await this.check();
    const rank = (id: string): number => {
      const index = this.dashboardOrder.indexOf(id);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    const matches = this.items
      .filter((i) => i.widgetType === widgetType)
      .sort(
        (a, b) =>
          rank(a.dashboardId) - rank(b.dashboardId) ||
          a.grid.y - b.grid.y ||
          a.grid.x - b.grid.x ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    return matches[0] ?? null;
  }

  async remove(id: string): Promise<boolean> {
    await this.check();
    const index = this.items.findIndex((i) => i.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }
}
