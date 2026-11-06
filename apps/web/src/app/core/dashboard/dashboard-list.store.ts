import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import {
  DASHBOARD_REPOSITORY,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
  type Dashboard,
  type DashboardPatch,
} from '../../data';
import { PendingWrites } from '../widgets/pending-writes';

/** = CONFIG_LIMITS.maxDashboards (not imported: core/backup stays out of the initial bundle). */
export const MAX_DASHBOARDS = 100;
export const LAST_DASHBOARD_SETTING = 'dashboard.last';

export class DashboardLimitError extends Error {
  constructor() {
    super(`At most ${MAX_DASHBOARDS} dashboards are allowed`);
    this.name = 'DashboardLimitError';
  }
}

export type DashboardListStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The list of dashboards (sidebar, navigation guard) and the last opened one. */
@Injectable({ providedIn: 'root' })
export class DashboardListStore {
  private readonly repository = inject(DASHBOARD_REPOSITORY);
  private readonly instances = inject(WIDGET_INSTANCE_REPOSITORY);
  private readonly settings = inject(SETTINGS_REPOSITORY);
  private readonly pendingWrites = inject(PendingWrites);

  private readonly dashboardsState = signal<readonly Dashboard[]>([]);
  private readonly statusState = signal<DashboardListStatus>('idle');
  private loading: Promise<void> | null = null;

  readonly dashboards: Signal<readonly Dashboard[]> = this.dashboardsState.asReadonly();
  readonly status: Signal<DashboardListStatus> = this.statusState.asReadonly();
  readonly canCreate: Signal<boolean> = computed(
    () => this.statusState() === 'ready' && this.dashboardsState().length < MAX_DASHBOARDS,
  );
  readonly canRemove: Signal<boolean> = computed(() => this.dashboardsState().length >= 2);

  /** createIfNone then list. Never rejects: on failure the status is 'error' (a retry is allowed). */
  load(defaultName: string): Promise<void> {
    if (this.statusState() === 'ready') return Promise.resolve();
    if (this.loading) return this.loading;
    this.statusState.set('loading');
    const run = (async () => {
      try {
        await this.repository.createIfNone({ name: defaultName });
        this.dashboardsState.set(await this.repository.list());
        this.statusState.set('ready');
      } catch (error) {
        console.error('Could not load the dashboards', error);
        this.statusState.set('error');
      } finally {
        this.loading = null;
      }
    })();
    this.loading = run;
    return run;
  }

  /** Last opened dashboard if it still exists, else the first; null when empty or in error. Never rejects. */
  async defaultTargetId(): Promise<string | null> {
    if (this.statusState() !== 'ready') return null;
    let last: unknown;
    try {
      last = await this.settings.get(LAST_DASHBOARD_SETTING);
    } catch (error) {
      console.error('Could not read the last opened dashboard', error);
    }
    const list = this.dashboardsState();
    if (typeof last === 'string' && list.some((d) => d.id === last)) return last;
    return list[0]?.id ?? null;
  }

  /** Persists the last opened dashboard without blocking; an error is logged, never propagated. */
  rememberOpened(id: string): void {
    try {
      this.settings.set(LAST_DASHBOARD_SETTING, id).catch((error: unknown) => {
        console.error('Could not remember the last opened dashboard', error);
      });
    } catch (error) {
      console.error('Could not remember the last opened dashboard', error);
    }
  }

  async create(input: { readonly name: string; readonly icon: string }): Promise<Dashboard> {
    if (this.dashboardsState().length >= MAX_DASHBOARDS) throw new DashboardLimitError();
    const created = await this.repository.create({ name: input.name, icon: input.icon });
    this.dashboardsState.update((list) => [...list, created]);
    return created;
  }

  async update(id: string, patch: DashboardPatch): Promise<Dashboard> {
    const updated = await this.repository.update(id, patch);
    this.dashboardsState.update((list) => list.map((d) => (d.id === id ? updated : d)));
    return updated;
  }

  async countWidgets(id: string): Promise<number> {
    return (await this.instances.listByDashboard(id)).length;
  }

  /** Flushes the pending writes (before a deletion). */
  prepareRemoval(): Promise<void> {
    return this.pendingWrites.flushAll();
  }

  /** After the successful deletion (or a `not_found`): rereads the list. */
  async afterRemoval(): Promise<void> {
    this.dashboardsState.set(await this.repository.list());
  }
}
