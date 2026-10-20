import { Clock, IdGenerator } from '../clock';
import { DataError } from '../data-error';
import { Dashboard, NewDashboard } from '../models';
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
    await this.executor.execute(
      `INSERT INTO dashboards (id, name, sort_order, created_at, updated_at)
       SELECT $1, $2, COALESCE(MAX(sort_order) + 1, 0), $3, $3 FROM dashboards`,
      [id, name, this.clock.nowIso()],
    );
    return this.mustGet(id);
  }

  async createIfNone(input: NewDashboard): Promise<boolean> {
    const id = input.id ?? this.newId();
    const name = validName(input.name);
    const result = await this.executor.execute(
      `INSERT INTO dashboards (id, name, sort_order, created_at, updated_at)
       SELECT $1, $2, 0, $3, $3 WHERE NOT EXISTS (SELECT 1 FROM dashboards)`,
      [id, name, this.clock.nowIso()],
    );
    return result.rowsAffected > 0;
  }

  async rename(id: string, name: string): Promise<Dashboard> {
    const trimmed = validName(name);
    const result = await this.executor.execute(
      'UPDATE dashboards SET name = $2, updated_at = $3 WHERE id = $1',
      [id, trimmed, this.clock.nowIso()],
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
