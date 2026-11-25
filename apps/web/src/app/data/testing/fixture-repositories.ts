import type { Clock, IdGenerator } from '../clock';
import type { SqlExecutor } from '../sql-executor';

/**
 * Test-only parents for the content repository specs (notes, todos, search): a dashboard and a
 * widget instance inserted by SQL on the in-memory database. The production repositories for
 * these tables are Rust commands; the fixtures are removed with the SQLite content repositories.
 */
export class FixtureDashboards {
  constructor(
    private readonly db: SqlExecutor,
    private readonly clock: Clock,
    private readonly newId: IdGenerator,
  ) {}

  async create(input: { name: string }): Promise<{ id: string }> {
    const id = this.newId();
    const now = this.clock.nowIso();
    await this.db.execute(
      `INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at)
       SELECT $1, $2, COALESCE(MAX(sort_order) + 1, 0), 'th-large', '{}', 1, $3, $3 FROM dashboards`,
      [id, input.name, now],
    );
    return { id };
  }

  async remove(id: string): Promise<void> {
    await this.db.execute('DELETE FROM dashboards WHERE id = $1', [id]);
  }
}

export class FixtureWidgetInstances {
  constructor(
    private readonly db: SqlExecutor,
    private readonly clock: Clock,
    private readonly newId: IdGenerator,
  ) {}

  async create(input: {
    dashboardId: string;
    widgetType: string;
    grid: { x: number; y: number; w: number; h: number };
    config: object;
    configVersion: number;
  }): Promise<{ id: string }> {
    const id = this.newId();
    const { x, y, w, h } = input.grid;
    await this.db.execute(
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
    return { id };
  }

  async remove(id: string): Promise<void> {
    await this.db.execute('DELETE FROM widget_instances WHERE id = $1', [id]);
  }
}
