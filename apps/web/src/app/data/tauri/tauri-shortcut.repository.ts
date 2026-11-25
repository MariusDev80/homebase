import type { IdGenerator } from '../clock';
import type { NewShortcut, Shortcut, ShortcutFields } from '../models';
import type { ShortcutRepository } from '../repositories';
import { invokeCommand } from './invoke-command';
import { toShortcut, type ShortcutWire } from './wire';

/** ShortcutRepository over the `shortcut_*` Rust commands. */
export class TauriShortcutRepository implements ShortcutRepository {
  constructor(private readonly newId: IdGenerator) {}

  async list(): Promise<Shortcut[]> {
    const rows = await invokeCommand<ShortcutWire[]>('shortcut_list', {});
    return rows.map(toShortcut);
  }

  async create(input: NewShortcut): Promise<Shortcut> {
    return toShortcut(
      await invokeCommand<ShortcutWire>('shortcut_create', {
        input: { id: input.id ?? this.newId(), label: input.label, url: input.url },
      }),
    );
  }

  async update(id: string, fields: ShortcutFields): Promise<Shortcut> {
    return toShortcut(
      await invokeCommand<ShortcutWire>('shortcut_update', {
        id,
        label: fields.label,
        url: fields.url,
      }),
    );
  }

  remove(id: string): Promise<boolean> {
    return invokeCommand<boolean>('shortcut_delete', { id });
  }

  async reorder(ids: readonly string[]): Promise<void> {
    await invokeCommand<void>('shortcut_reorder', { ids: [...ids] });
  }

  async search(query: string, limit: number): Promise<Shortcut[]> {
    const rows = await invokeCommand<ShortcutWire[]>('shortcut_search', { query, limit });
    return rows.map(toShortcut);
  }
}
