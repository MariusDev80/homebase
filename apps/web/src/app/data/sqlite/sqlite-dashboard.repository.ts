import { Clock, IdGenerator } from '../clock';
import { DataError } from '../data-error';
import {
  DASHBOARD_ICON_PATTERN,
  DEFAULT_DASHBOARD_THEME_VERSION,
  DEFAULT_DASHBOARD_ICON,
  Dashboard,
  DashboardPatch,
  NewDashboard,
} from '../models';
import { JsonObject } from '../json';
import { validTheme } from '../dashboard-theme-input';
import { DashboardRepository } from '../repositories';
import { SqlExecutor } from '../sql-executor';
import { DASHBOARD_COLUMNS, DashboardRow, toDashboard } from './row-mappers';

function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new DataError('invalid_input', 'Dashboard name must be 1 to 100 characters');
  }
  return trimmed;
}

function validIcon(icon: string): string {
  if (!DASHBOARD_ICON_PATTERN.test(icon)) {
    throw new DataError('invalid_input', 'Dashboard icon has an invalid format');
  }
  return icon;
}

export class SqliteDashboardRepository implements DashboardRepository {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly clock: Clock,
    private readonly newId: IdGenerator,
  ) {}

  async list(): Promise<Dashboard[]> {
    const rows = await this.executor.select<DashboardRow>(
      `SELECT ${DASHBOARD_COLUMNS} FROM dashboards ORDER BY sort_order, created_at, id`,
    );
    return rows.map(toDashboard);
  }

  async get(id: string): Promise<Dashboard | null> {
    const rows = await this.executor.select<DashboardRow>(
      `SELECT ${DASHBOARD_COLUMNS} FROM dashboards WHERE id = $1`,
      [id],
    );
    return rows.length === 0 ? null : toDashboard(rows[0]);
  }

  async create(input: NewDashboard): Promise<Dashboard> {
    const id = input.id ?? this.newId();
    const name = validName(input.name);
    const icon = validIcon(input.icon ?? DEFAULT_DASHBOARD_ICON);
    const themeVersion = input.themeVersion ?? DEFAULT_DASHBOARD_THEME_VERSION;
    const theme = validTheme(input.theme ?? {}, themeVersion);
    await this.executor.execute(
      `INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at)
       SELECT $1, $2, COALESCE(MAX(sort_order) + 1, 0), $4, $5, $6, $3, $3 FROM dashboards`,
      [id, name, this.clock.nowIso(), icon, theme, themeVersion],
    );
    return this.mustGet(id);
  }

  async createIfNone(input: NewDashboard): Promise<boolean> {
    const id = input.id ?? this.newId();
    const name = validName(input.name);
    const icon = validIcon(input.icon ?? DEFAULT_DASHBOARD_ICON);
    const themeVersion = input.themeVersion ?? DEFAULT_DASHBOARD_THEME_VERSION;
    const theme = validTheme(input.theme ?? {}, themeVersion);
    const result = await this.executor.execute(
      `INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at)
       SELECT $1, $2, 0, $4, $5, $6, $3, $3 WHERE NOT EXISTS (SELECT 1 FROM dashboards)`,
      [id, name, this.clock.nowIso(), icon, theme, themeVersion],
    );
    return result.rowsAffected > 0;
  }

  async update(id: string, patch: DashboardPatch): Promise<Dashboard> {
    const name = validName(patch.name);
    const icon = validIcon(patch.icon);
    const result = await this.executor.execute(
      'UPDATE dashboards SET name = $2, icon = $3, updated_at = $4 WHERE id = $1',
      [id, name, icon, this.clock.nowIso()],
    );
    if (result.rowsAffected === 0) {
      throw new DataError('not_found', 'Dashboard not found');
    }
    return this.mustGet(id);
  }

  async updateTheme(id: string, theme: JsonObject, themeVersion: number): Promise<Dashboard> {
    const serialized = validTheme(theme, themeVersion);
    const result = await this.executor.execute(
      'UPDATE dashboards SET theme = $2, theme_version = $3, updated_at = $4 WHERE id = $1',
      [id, serialized, themeVersion, this.clock.nowIso()],
    );
    if (result.rowsAffected === 0) {
      throw new DataError('not_found', 'Dashboard not found');
    }
    return this.mustGet(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.executor.execute('DELETE FROM dashboards WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  }

  private async mustGet(id: string): Promise<Dashboard> {
    const dashboard = await this.get(id);
    if (!dashboard) {
      throw new DataError('not_found', 'Dashboard not found');
    }
    return dashboard;
  }
}
