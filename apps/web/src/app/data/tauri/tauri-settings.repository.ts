import type { IdGenerator } from '../clock';
import type { JsonValue } from '../json';
import type { SettingsRepository } from '../repositories';
import { invokeCommand } from './invoke-command';
import { stringifyJson, toSettingValue, type SettingWire } from './wire';

/** SettingsRepository over the `setting_*` Rust commands. */
export class TauriSettingsRepository implements SettingsRepository {
  // Settings use a natural key; the generator only keeps the constructor signature uniform.
  constructor(protected readonly newId?: IdGenerator) {}

  async get(key: string): Promise<JsonValue | undefined> {
    const valueJson = await invokeCommand<string | null>('setting_get', { key });
    return valueJson === null || valueJson === undefined ? undefined : toSettingValue(valueJson);
  }

  async getAll(): Promise<ReadonlyMap<string, JsonValue>> {
    const rows = await invokeCommand<SettingWire[]>('setting_list', {});
    return new Map(rows.map((r) => [r.key, toSettingValue(r.valueJson)]));
  }

  async set(key: string, value: JsonValue): Promise<void> {
    await invokeCommand<null>('setting_set', { key, valueJson: stringifyJson(value) });
  }

  remove(key: string): Promise<boolean> {
    return invokeCommand<boolean>('setting_delete', { key });
  }
}
