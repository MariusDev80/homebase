import { Clock, IdGenerator } from '../clock';
import { DataError } from '../data-error';
import { JsonObject } from '../json';
import { LayoutItem, NewWidgetInstance, WidgetInstanceRecord } from '../models';
import { WidgetInstanceRepository } from '../repositories';
import { SqlExecutor } from '../sql-executor';
import { WIDGET_INSTANCE_COLUMNS, WidgetInstanceRow, toWidgetInstance } from './row-mappers';

/** Exported for the atomicity test only (not re-exported by data/index.ts). */
export const UPDATE_LAYOUT_SQL = `UPDATE widget_instances
SET grid_x = j.x, grid_y = j.y, grid_w = j.w, grid_h = j.h, updated_at = $3
FROM (
  SELECT json_extract(value, '$.id') AS id,
         json_extract(value, '$.x')  AS x,
         json_extract(value, '$.y')  AS y,
         json_extract(value, '$.w')  AS w,
         json_extract(value, '$.h')  AS h
  FROM json_each($2)
) AS j
WHERE widget_instances.id = j.id AND widget_instances.dashboard_id = $1`;

function assertLayout(items: readonly LayoutItem[]): void {
  const seen = new Set<string>();
  for (const { id, grid } of items) {
    if (seen.has(id)) {
      throw new DataError('invalid_input', 'Duplicate widget instance id in layout');
    }
    seen.add(id);
    const { x, y, w, h } = grid;
    const ok =
      Number.isSafeInteger(x) &&
      Number.isSafeInteger(y) &&
      Number.isSafeInteger(w) &&
      Number.isSafeInteger(h) &&
      x >= 0 &&
      y >= 0 &&
      w >= 1 &&
      h >= 1;
    if (!ok) {
      throw new DataError('invalid_input', 'Invalid grid rectangle in layout');
    }
  }
}

export class SqliteWidgetInstanceRepository implements WidgetInstanceRepository {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly clock: Clock,
    private readonly newId: IdGenerator,
  ) {}

  async listByDashboard(dashboardId: string): Promise<WidgetInstanceRecord[]> {
    const rows = await this.executor.select<WidgetInstanceRow>(
      `SELECT ${WIDGET_INSTANCE_COLUMNS} FROM widget_instances
       WHERE dashboard_id = $1 ORDER BY grid_y, grid_x, created_at, id`,
      [dashboardId],
    );
    return rows.map(toWidgetInstance);
  }

  async get(id: string): Promise<WidgetInstanceRecord | null> {
    const rows = await this.executor.select<WidgetInstanceRow>(
      `SELECT ${WIDGET_INSTANCE_COLUMNS} FROM widget_instances WHERE id = $1`,
      [id],
    );
    return rows.length === 0 ? null : toWidgetInstance(rows[0]);
  }

  async create(input: NewWidgetInstance): Promise<WidgetInstanceRecord> {
    const id = input.id ?? this.newId();
    const { x, y, w, h } = input.grid;
    await this.executor.execute(
      `INSERT INTO widget_instances
         (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h,
          config, config_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        id,
        input.dashboardId,
        input.widgetType,
        x,
        y,
        w,
        h,
        JSON.stringify(input.config),
        input.configVersion,
        this.clock.nowIso(),
      ],
    );
    return this.mustGet(id);
  }

  async updateConfig(
    id: string,
    config: JsonObject,
    configVersion: number,
  ): Promise<WidgetInstanceRecord> {
    const result = await this.executor.execute(
      'UPDATE widget_instances SET config = $2, config_version = $3, updated_at = $4 WHERE id = $1',
      [id, JSON.stringify(config), configVersion, this.clock.nowIso()],
    );
    if (result.rowsAffected === 0) {
      throw new DataError('not_found', 'Widget instance not found');
    }
    return this.mustGet(id);
  }

  async updateLayout(dashboardId: string, items: readonly LayoutItem[]): Promise<number> {
    if (items.length === 0) {
      return 0;
    }
    assertLayout(items);
    const payload = JSON.stringify(items.map((i) => ({ id: i.id, ...i.grid })));
    const result = await this.executor.execute(UPDATE_LAYOUT_SQL, [
      dashboardId,
      payload,
      this.clock.nowIso(),
    ]);
    return result.rowsAffected;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.executor.execute('DELETE FROM widget_instances WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  }

  private async mustGet(id: string): Promise<WidgetInstanceRecord> {
    const record = await this.get(id);
    if (!record) {
      throw new DataError('not_found', 'Widget instance not found');
    }
    return record;
  }
}
