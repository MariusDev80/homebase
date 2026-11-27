import type { IdGenerator } from '../clock';
import type { JsonObject } from '../json';
import type { LayoutItem, NewWidgetInstance, WidgetInstanceRecord } from '../models';
import type { WidgetInstanceRepository } from '../repositories';
import { invokeCommand } from './invoke-command';
import { stringifyJson, toWidgetInstance, wireGrid, type WidgetWire } from './wire';

/** WidgetInstanceRepository over the `widget_*` Rust commands. */
export class TauriWidgetInstanceRepository implements WidgetInstanceRepository {
  constructor(private readonly newId: IdGenerator) {}

  async listByDashboard(dashboardId: string): Promise<WidgetInstanceRecord[]> {
    const rows = await invokeCommand<WidgetWire[]>('widget_list', { dashboardId });
    return rows.map(toWidgetInstance);
  }

  async get(id: string): Promise<WidgetInstanceRecord | null> {
    const row = await invokeCommand<WidgetWire | null>('widget_get', { id });
    return row === null || row === undefined ? null : toWidgetInstance(row);
  }

  async create(input: NewWidgetInstance): Promise<WidgetInstanceRecord> {
    return toWidgetInstance(
      await invokeCommand<WidgetWire>('widget_create', {
        input: {
          id: input.id ?? this.newId(),
          dashboardId: input.dashboardId,
          widgetType: input.widgetType,
          grid: wireGrid(input.grid),
          configJson: stringifyJson(input.config),
          configVersion: input.configVersion,
        },
      }),
    );
  }

  async updateConfig(
    id: string,
    config: JsonObject,
    configVersion: number,
  ): Promise<WidgetInstanceRecord> {
    return toWidgetInstance(
      await invokeCommand<WidgetWire>('widget_update_config', {
        id,
        configJson: stringifyJson(config),
        configVersion,
      }),
    );
  }

  updateLayout(dashboardId: string, items: readonly LayoutItem[]): Promise<number> {
    return invokeCommand<number>('widget_update_layout', {
      dashboardId,
      items: items.map((i) => ({ id: i.id, grid: wireGrid(i.grid) })),
    });
  }

  async findFirstOfType(widgetType: string): Promise<WidgetInstanceRecord | null> {
    const row = await invokeCommand<WidgetWire | null>('widget_find_first_of_type', {
      widgetType,
    });
    return row === null || row === undefined ? null : toWidgetInstance(row);
  }

  remove(id: string): Promise<boolean> {
    return invokeCommand<boolean>('widget_delete', { id });
  }
}
