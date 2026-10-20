import { DataError } from '../../data';
import type { Dashboard, DashboardRepository, NewDashboard } from '../../data';

/** In-memory DashboardRepository with deterministic ids and timestamps (specs only). */
export class FakeDashboardRepository implements DashboardRepository {
  readonly items: Dashboard[] = [];
  private counter = 0;
  private nextFailure: unknown;

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

  private build(input: NewDashboard): Dashboard {
    this.counter++;
    const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, this.counter)).toISOString();
    const sortOrder = this.items.reduce((max, d) => Math.max(max, d.sortOrder), -1) + 1;
    const dashboard: Dashboard = {
      id: input.id ?? `dashboard-${this.counter}`,
      name: input.name,
      sortOrder,
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

  async rename(id: string, name: string): Promise<Dashboard> {
    await this.check();
    const index = this.items.findIndex((d) => d.id === id);
    const current = this.items[index];
    if (!current) throw new DataError('not_found', `Dashboard ${id} not found`);
    const updated: Dashboard = { ...current, name: name.trim() };
    this.items[index] = updated;
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    await this.check();
    const index = this.items.findIndex((d) => d.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }
}
