import type { IdGenerator } from '../clock';
import { validTheme } from '../dashboard-theme-input';
import type { JsonObject } from '../json';
import {
  DEFAULT_DASHBOARD_THEME_VERSION,
  type Dashboard,
  type DashboardPatch,
  type LayoutItem,
  type NewDashboard,
} from '../models';
import type { DashboardRepository } from '../repositories';
import { invokeCommand } from './invoke-command';
import { toDashboard, wireGrid, type DashboardWire, type DashboardWithWidgetsWire } from './wire';

/** Exact wire shape of DashboardNewDto. The theme is validated here, like updateTheme. */
function wireNew(input: NewDashboard, newId: IdGenerator): Record<string, unknown> {
  const themeVersion = input.themeVersion ?? DEFAULT_DASHBOARD_THEME_VERSION;
  return {
    id: input.id ?? newId(),
    name: input.name,
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    themeJson: validTheme(input.theme ?? {}, themeVersion),
    themeVersion,
  };
}

/** DashboardRepository over the `dashboard_*` Rust commands. */
export class TauriDashboardRepository implements DashboardRepository {
  constructor(private readonly newId: IdGenerator) {}

  async list(): Promise<Dashboard[]> {
    const rows = await invokeCommand<DashboardWire[]>('dashboard_list', {});
    return rows.map(toDashboard);
  }

  async get(id: string): Promise<Dashboard | null> {
    const row = await invokeCommand<DashboardWire | null>('dashboard_get', { id });
    return row === null || row === undefined ? null : toDashboard(row);
  }

  async create(input: NewDashboard): Promise<Dashboard> {
    return toDashboard(
      await invokeCommand<DashboardWire>('dashboard_create', {
        input: wireNew(input, this.newId),
      }),
    );
  }

  createIfNone(input: NewDashboard): Promise<boolean> {
    return invokeCommand<boolean>('dashboard_ensure_default', {
      input: wireNew(input, this.newId),
    });
  }

  async update(id: string, patch: DashboardPatch): Promise<Dashboard> {
    return toDashboard(
      await invokeCommand<DashboardWire>('dashboard_update', {
        id,
        name: patch.name,
        icon: patch.icon,
      }),
    );
  }

  async updateTheme(id: string, theme: JsonObject, themeVersion: number): Promise<Dashboard> {
    return toDashboard(
      await invokeCommand<DashboardWire>('dashboard_update_theme', {
        id,
        themeJson: validTheme(theme, themeVersion),
        themeVersion,
      }),
    );
  }

  async createWithWidgets(
    input: NewDashboard,
    sourceDashboardId: string,
    items: readonly LayoutItem[],
  ): Promise<{ readonly dashboard: Dashboard; readonly moved: number }> {
    const result = await invokeCommand<DashboardWithWidgetsWire>('dashboard_create_with_widgets', {
      input: {
        dashboard: wireNew(input, this.newId),
        sourceDashboardId,
        items: items.map((i) => ({ id: i.id, grid: wireGrid(i.grid) })),
      },
    });
    return { dashboard: toDashboard(result.dashboard), moved: result.moved };
  }
}
