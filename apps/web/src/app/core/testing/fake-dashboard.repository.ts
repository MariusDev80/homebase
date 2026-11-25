import {
  DEFAULT_DASHBOARD_ICON,
  DEFAULT_DASHBOARD_THEME_VERSION,
  DataError,
  validTheme,
} from '../../data';
import type {
  Dashboard,
  DashboardPatch,
  DashboardRepository,
  JsonObject,
  LayoutItem,
  NewDashboard,
} from '../../data';
import type { FakeWidgetInstanceRepository } from './fake-widget-instance.repository';

/** In-memory DashboardRepository with deterministic ids and timestamps (specs only). */
export class FakeDashboardRepository implements DashboardRepository {
  readonly items: Dashboard[] = [];
  private counter = 0;
  private writes = 0;
  private nextFailure: unknown;

  private instances?: FakeWidgetInstanceRepository;

  /** Links an instance fake: createWithWidgets then really moves the instances of the source dashboard. */
  static linked(instances: FakeWidgetInstanceRepository): FakeDashboardRepository {
    const repo = new FakeDashboardRepository();
    repo.instances = instances;
    return repo;
  }

  /** The next call rejects with `error`. */
  failNext(error: unknown): void {
    this.nextFailure = error;
  }

  private check(): Promise<void> {
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  /** Every write gets a later updatedAt than any creation, like the real repository. */
  private tick(): string {
    this.writes++;
    return new Date(Date.UTC(2026, 0, 1, 1, 0, this.writes)).toISOString();
  }

  private build(input: NewDashboard): Dashboard {
    const themeVersion = input.themeVersion ?? DEFAULT_DASHBOARD_THEME_VERSION;
    const theme = JSON.parse(validTheme(input.theme ?? {}, themeVersion)) as JsonObject;
    this.counter++;
    const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, this.counter)).toISOString();
    const sortOrder = this.items.reduce((max, d) => Math.max(max, d.sortOrder), -1) + 1;
    const dashboard: Dashboard = {
      id: input.id ?? `dashboard-${this.counter}`,
      name: input.name,
      sortOrder,
      icon: input.icon ?? DEFAULT_DASHBOARD_ICON,
      theme,
      themeVersion,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.items.push(dashboard);
    return dashboard;
  }

  async list(): Promise<Dashboard[]> {
    await this.check();
    return [...this.items].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  }

  async get(id: string): Promise<Dashboard | null> {
    await this.check();
    return this.items.find((d) => d.id === id) ?? null;
  }

  async create(input: NewDashboard): Promise<Dashboard> {
    await this.check();
    return this.build(input);
  }

  async createIfNone(input: NewDashboard): Promise<boolean> {
    await this.check();
    if (this.items.length > 0) return false;
    this.build(input);
    return true;
  }

  async update(id: string, patch: DashboardPatch): Promise<Dashboard> {
    await this.check();
    const index = this.items.findIndex((d) => d.id === id);
    const current = this.items[index];
    if (!current) throw new DataError('not_found', `Dashboard ${id} not found`);
    const updated: Dashboard = {
      ...current,
      name: patch.name.trim(),
      icon: patch.icon,
      updatedAt: this.tick(),
    };
    this.items[index] = updated;
    return updated;
  }

  async updateTheme(id: string, theme: JsonObject, themeVersion: number): Promise<Dashboard> {
    await this.check();
    const serialized = validTheme(theme, themeVersion);
    const index = this.items.findIndex((d) => d.id === id);
    const current = this.items[index];
    if (!current) throw new DataError('not_found', `Dashboard ${id} not found`);
    const updated: Dashboard = {
      ...current,
      theme: JSON.parse(serialized) as JsonObject,
      themeVersion,
      updatedAt: this.tick(),
    };
    this.items[index] = updated;
    return updated;
  }

  /**
   * Creates the dashboard and, when linked to the instance fake, moves the listed instances of the
   * source dashboard (conflict, and nothing created, when none moves). Unlinked: moved = items.length.
   */
  async createWithWidgets(
    input: NewDashboard,
    sourceDashboardId: string,
    items: readonly LayoutItem[],
  ): Promise<{ readonly dashboard: Dashboard; readonly moved: number }> {
    await this.check();
    if (items.length === 0) throw new DataError('invalid_input', 'items must not be empty');
    const movable = this.instances
      ? items.filter((item) =>
          this.instances?.items.some(
            (i) => i.id === item.id && i.dashboardId === sourceDashboardId,
          ),
        )
      : items;
    if (movable.length === 0) throw new DataError('conflict', 'No widget instance could be moved');
    const dashboard = this.build(input);
    this.instances?.relocate(dashboard.id, movable);
    return { dashboard, moved: movable.length };
  }
}
