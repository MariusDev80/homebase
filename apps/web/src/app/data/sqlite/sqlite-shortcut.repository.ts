import { Clock, IdGenerator } from '../clock';
import { DataError } from '../data-error';
import { NewShortcut, Shortcut, ShortcutFields } from '../models';
import { ShortcutRepository } from '../repositories';
import { SqlExecutor } from '../sql-executor';
import { SHORTCUT_COLUMNS, ShortcutRow, toShortcut } from './row-mappers';

export const SHORTCUT_LABEL_MAX = 80;
export const SHORTCUT_URL_MAX = 2048;
export const SHORTCUT_REORDER_MAX = 1000;

/** Exported for tests only (not re-exported by data/index.ts). */
export const REORDER_SHORTCUTS_SQL = `UPDATE shortcuts
SET sort_order = j.pos, updated_at = $2
FROM (SELECT CAST(key AS INTEGER) AS pos, value AS id FROM json_each($1)) AS j
WHERE shortcuts.id = j.id AND shortcuts.sort_order <> j.pos`;

function validFields(fields: ShortcutFields): ShortcutFields {
  const label = fields.label.trim();
  if (label.length < 1 || label.length > SHORTCUT_LABEL_MAX) {
    throw new DataError('invalid_input', 'Shortcut label must be 1 to 80 characters');
  }
  const url = fields.url;
  if (url.length > SHORTCUT_URL_MAX || !/^https?:\/\//.test(url)) {
    throw new DataError(
      'invalid_input',
      'Shortcut url must start with http:// or https:// (2048 characters at most)',
    );
  }
  return { label, url };
}

export class SqliteShortcutRepository implements ShortcutRepository {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly clock: Clock,
    private readonly newId: IdGenerator,
  ) {}

  async list(): Promise<Shortcut[]> {
    const rows = await this.executor.select<ShortcutRow>(
      `SELECT ${SHORTCUT_COLUMNS} FROM shortcuts ORDER BY sort_order, created_at, id`,
    );
    return rows.map(toShortcut);
  }

  async create(input: NewShortcut): Promise<Shortcut> {
    const id = input.id ?? this.newId();
    const { label, url } = validFields(input);
    await this.executor.execute(
      `INSERT INTO shortcuts (id, label, url, sort_order, created_at, updated_at)
       SELECT $1, $2, $3, COALESCE(MAX(sort_order) + 1, 0), $4, $4 FROM shortcuts`,
      [id, label, url, this.clock.nowIso()],
    );
    return this.mustGet(id);
  }

  async update(id: string, fields: ShortcutFields): Promise<Shortcut> {
    const { label, url } = validFields(fields);
    const result = await this.executor.execute(
      'UPDATE shortcuts SET label = $2, url = $3, updated_at = $4 WHERE id = $1',
      [id, label, url, this.clock.nowIso()],
    );
    if (result.rowsAffected === 0) {
      throw new DataError('not_found', 'Shortcut not found');
    }
    return this.mustGet(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.executor.execute('DELETE FROM shortcuts WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  }

  async reorder(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    if (ids.length > SHORTCUT_REORDER_MAX) {
      throw new DataError('invalid_input', 'Too many shortcut ids in reorder');
    }
    if (new Set(ids).size !== ids.length) {
      throw new DataError('invalid_input', 'Duplicate shortcut id in reorder');
    }
    await this.executor.execute(REORDER_SHORTCUTS_SQL, [JSON.stringify(ids), this.clock.nowIso()]);
  }

  private async mustGet(id: string): Promise<Shortcut> {
    const rows = await this.executor.select<ShortcutRow>(
      `SELECT ${SHORTCUT_COLUMNS} FROM shortcuts WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new DataError('not_found', 'Shortcut not found');
    }
    return toShortcut(rows[0]);
  }
}
