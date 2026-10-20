import { JsonValue, SettingsRepository } from '../../data';

/** In-memory SettingsRepository for component/service tests (no SQL involved). */
export class FakeSettingsRepository implements SettingsRepository {
  readonly values = new Map<string, JsonValue>();
  failGet = false;
  failSet = false;

  get(key: string): Promise<JsonValue | undefined> {
    return this.failGet
      ? Promise.reject(new Error('get failed'))
      : Promise.resolve(this.values.get(key));
  }

  getAll(): Promise<ReadonlyMap<string, JsonValue>> {
    return Promise.resolve(new Map(this.values));
  }

  set(key: string, value: JsonValue): Promise<void> {
    if (this.failSet) return Promise.reject(new Error('set failed'));
    this.values.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }
}
