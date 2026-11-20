import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDatabase, listMigrationFiles, migrationsDir } from './testing/migrations';

const FILE_PATTERN = /^V([1-9]\d*)__([a-z0-9_]+)\.sql$/;

function sqlFiles(): string[] {
  return readdirSync(migrationsDir()).filter((f) => f !== 'checksums.json');
}

function sha256(file: string): string {
  return createHash('sha256')
    .update(readFileSync(join(migrationsDir(), file)))
    .digest('hex');
}

describe('migrations', () => {
  it('only contains V<n>__<name>.sql files and checksums.json, with contiguous versions', () => {
    const files = sqlFiles();
    for (const f of files) {
      expect(f, `unexpected file in migrations dir: ${f}`).toMatch(FILE_PATTERN);
    }
    const versions = files.map((f) => Number(FILE_PATTERN.exec(f)?.[1])).sort((a, b) => a - b);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
    expect(versions.length).toBeGreaterThan(0);
  });

  it('has no CR and no BOM', () => {
    for (const f of sqlFiles()) {
      const text = readFileSync(join(migrationsDir(), f), 'utf8');
      expect(text.includes('\r'), `${f} contains CR`).toBe(false);
      expect(text.charCodeAt(0), `${f} starts with a BOM`).not.toBe(0xfeff);
    }
  });

  it('matches checksums.json exactly (migrations are immutable)', () => {
    const manifest = JSON.parse(
      readFileSync(join(migrationsDir(), 'checksums.json'), 'utf8'),
    ) as Record<string, string>;
    const files = sqlFiles().sort();
    expect(Object.keys(manifest).sort()).toEqual(files);
    for (const f of files) {
      const actual = sha256(f);
      expect(manifest[f], `${f}: expected checksum ${manifest[f]}, computed ${actual}`).toBe(
        actual,
      );
    }
  });

  it('does not contain transaction control or journal/foreign_keys pragmas', () => {
    const forbidden = /\b(BEGIN|COMMIT|ROLLBACK)\b|PRAGMA\s+(journal_mode|foreign_keys)/i;
    for (const m of listMigrationFiles()) {
      const code = m.sql
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n');
      expect(forbidden.test(code), `${m.file} contains a forbidden statement`).toBe(false);
    }
  });

  it('applies on a blank database with the expected schema', async () => {
    const db = createTestDatabase();
    try {
      const tables = await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      expect(tables.map((t) => t.name)).toEqual([
        'dashboards',
        'notes',
        'reminder_deliveries',
        'reminders',
        'settings',
        'shortcuts',
        'time_sessions',
        'todo_lists',
        'todos',
        'widget_instances',
      ]);

      const integrity = await db.select<{ integrity_check: string }>('PRAGMA integrity_check');
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);

      const [row] = await db.select<{ v: string }>('SELECT sqlite_version() AS v');
      const [major, minor] = row.v.split('.').map(Number);
      expect(major > 3 || (major === 3 && minor >= 38)).toBe(true);
    } finally {
      db.close();
    }
  });

  describe('V4 (dashboards.icon)', () => {
    const AT = '2026-01-01T00:00:00.000Z';
    const ID = '00000000-0000-4000-8000-000000000001';

    it('gives existing rows the default icon and leaves updated_at untouched', async () => {
      const db = createTestDatabase(3);
      try {
        await db.execute(
          'INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES ($1, $2, 0, $3, $3)',
          [ID, 'Home', AT],
        );
        const v4 = listMigrationFiles().find((m) => m.version === 4);
        expect(v4?.name).toBe('dashboard_icon');
        db.exec('BEGIN');
        db.exec(v4?.sql ?? '');
        db.exec('COMMIT');
        expect(await db.select('SELECT icon, created_at, updated_at FROM dashboards')).toEqual([
          { icon: 'th-large', created_at: AT, updated_at: AT },
        ]);
        expect(await db.select('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('checks the shape of the icon', async () => {
      const db = createTestDatabase();
      try {
        const insert = (icon: string) =>
          db.execute(
            "INSERT INTO dashboards (id, name, sort_order, icon, created_at, updated_at) VALUES ($1, 'D', 0, $2, $3, $3)",
            [ID, icon, AT],
          );
        const bad = ['pi pi-x', '', 'A', 'a'.repeat(33), '1a', '-a', 'a_b', 'é'];
        for (const icon of bad) {
          await expect(insert(icon), JSON.stringify(icon)).rejects.toMatchObject({
            kind: 'constraint',
          });
        }
        await insert('chart-line');
        await db.execute('DELETE FROM dashboards');
        await insert('a'.repeat(32));
        expect(await db.select('SELECT icon FROM dashboards')).toEqual([{ icon: 'a'.repeat(32) }]);
      } finally {
        db.close();
      }
    });
  });

  describe('V5 (dashboards.theme)', () => {
    const AT = '2026-01-01T00:00:00.000Z';
    const ID = '00000000-0000-4000-8000-000000000001';
    /** Serialized object of exactly `chars` characters. */
    const object = (chars: number): string => `{"a":"${'x'.repeat(chars - 8)}"}`;

    it('gives existing rows the default theme and leaves icon and updated_at untouched', async () => {
      const db = createTestDatabase(4);
      try {
        await db.execute(
          "INSERT INTO dashboards (id, name, sort_order, icon, created_at, updated_at) VALUES ($1, 'Home', 0, 'briefcase', $2, $2)",
          [ID, AT],
        );
        const v5 = listMigrationFiles().find((m) => m.version === 5);
        expect(v5?.name).toBe('dashboard_theme');
        db.exec('BEGIN');
        db.exec(v5?.sql ?? '');
        db.exec('COMMIT');
        expect(
          await db.select('SELECT theme, theme_version, icon, updated_at FROM dashboards'),
        ).toEqual([{ theme: '{}', theme_version: 1, icon: 'briefcase', updated_at: AT }]);
        expect(await db.select('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('checks the shape of the theme and of its version', async () => {
      const db = createTestDatabase();
      try {
        const insert = (theme: string, version = 1) =>
          db.execute(
            "INSERT INTO dashboards (id, name, sort_order, theme, theme_version, created_at, updated_at) VALUES ($1, 'D', 0, $2, $3, $4, $4)",
            [ID, theme, version, AT],
          );
        const bad = ['pas du json', '[]', '"x"', 'null', object(4097)];
        for (const theme of bad) {
          await expect(insert(theme), theme.slice(0, 20)).rejects.toMatchObject({
            kind: 'constraint',
          });
        }
        await expect(insert('{}', 0)).rejects.toMatchObject({ kind: 'constraint' });
        await insert('{"cardBody":"rose"}');
        await db.execute('DELETE FROM dashboards');
        await insert(object(4096));
        expect(await db.select('SELECT length(theme) AS n FROM dashboards')).toEqual([{ n: 4096 }]);
      } finally {
        db.close();
      }
    });
  });

  describe('V6 (todos.description, rrule, important)', () => {
    const AT = '2026-01-01T00:00:00.000Z';
    const DONE = '2026-02-02T10:00:00.000Z';
    const DASH = '00000000-0000-4000-8000-000000000001';
    const INSTANCE = '00000000-0000-4000-8000-000000000002';
    const LIST = '00000000-0000-4000-8000-000000000003';
    const T1 = '00000000-0000-4000-8000-000000000011';
    const T2 = '00000000-0000-4000-8000-000000000012';

    const TAIL_V5 = `  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT`;
    const TAIL_V6 = `  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
, description TEXT NOT NULL DEFAULT ''
  CHECK (length(description) <= 10000 AND length(CAST(description AS BLOB)) <= 40000), rrule TEXT NULL
  CHECK (rrule IS NULL OR (length(rrule) BETWEEN 10 AND 256 AND rrule GLOB 'FREQ=*'
         AND due_on IS NOT NULL)), important INTEGER NOT NULL DEFAULT 0
  CHECK (important IN (0, 1))) STRICT`;

    type Db = ReturnType<typeof createTestDatabase>;

    async function schemaOfTodos(db: Db): Promise<string> {
      const rows = await db.select<{ sql: string }>(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'todos'",
      );
      return rows[0].sql;
    }

    async function seed(db: Db): Promise<void> {
      await db.execute(
        "INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES ($1, 'Home', 0, $2, $2)",
        [DASH, AT],
      );
      await db.execute(
        "INSERT INTO widget_instances (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version, created_at, updated_at) VALUES ($1, $2, 'todo', 0, 0, 4, 4, '{}', 1, $3, $3)",
        [INSTANCE, DASH, AT],
      );
      await db.execute(
        'INSERT INTO todo_lists (id, widget_instance_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
        [LIST, INSTANCE, 'Tâches', AT],
      );
      await db.execute(
        "INSERT INTO todos (id, list_id, title, due_on, completed_at, sort_order, created_at, updated_at) VALUES ($1, $2, 'A', '2026-03-04', $3, 0, $4, $4)",
        [T1, LIST, DONE, AT],
      );
      await db.execute(
        "INSERT INTO todos (id, list_id, title, sort_order, created_at, updated_at) VALUES ($1, $2, 'B', 1, $3, $3)",
        [T2, LIST, AT],
      );
    }

    it('gives existing rows the defaults and leaves the other columns untouched', async () => {
      const db = createTestDatabase(5);
      try {
        await seed(db);
        const columns =
          'SELECT id, list_id, title, due_on, completed_at, sort_order, created_at, updated_at FROM todos ORDER BY id';
        const before = await db.select(columns);
        const v6 = listMigrationFiles().find((m) => m.version === 6);
        expect(v6?.name).toBe('todo_details');
        db.exec('BEGIN');
        db.exec(v6?.sql ?? '');
        db.exec('COMMIT');
        expect(await db.select(columns)).toEqual(before);
        expect(await db.select('SELECT description, rrule, important FROM todos')).toEqual([
          { description: '', rrule: null, important: 0 },
          { description: '', rrule: null, important: 0 },
        ]);
        expect(await db.select('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('checks description, rrule and important (S1)', async () => {
      const db = createTestDatabase();
      try {
        await seed(db);
        const set = (assignments: string, ...params: (string | number | null)[]) =>
          db.execute(`UPDATE todos SET ${assignments} WHERE id = '${T1}'`, params);
        const refused = (promise: Promise<unknown>, label: string) =>
          expect(promise, label).rejects.toMatchObject({ kind: 'constraint' });

        await set('description = $1', 'a'.repeat(10000));
        await refused(set('description = $1', 'a'.repeat(10001)), '10001 characters');
        await set('description = $1', 'é'.repeat(10000)); // 20 000 bytes
        const nulThen = (chars: number) =>
          `description = 'a' || char(0) || replace(hex(zeroblob(${chars})), '00', 'b')`;
        await set(nulThen(39_998)); // exactly 40 000 bytes
        await refused(set(nulThen(39_999)), 'NUL then 40 001 bytes');

        await set('rrule = $1', 'FREQ=DAILY');
        await set('rrule = $1', `FREQ=${'A'.repeat(251)}`); // 256 characters
        await refused(set('rrule = $1', 'freq=daily'), 'lowercase prefix');
        await refused(set('rrule = $1', 'DAILY'), 'DAILY');
        await refused(set('rrule = $1', 'FREQ='), 'FREQ=');
        await refused(set('rrule = $1', `FREQ=${'A'.repeat(252)}`), '257 characters');
        await refused(set('due_on = NULL'), 'clearing due_on of a todo with a rule');
        await set('rrule = NULL, due_on = NULL');
        await refused(
          db.execute(`UPDATE todos SET rrule = 'FREQ=DAILY' WHERE id = '${T1}'`),
          'rule without due date',
        );

        await set('important = $1', 1);
        await refused(set('important = $1', 2), 'important 2');
        await refused(set('important = $1', -1), 'important -1');
      } finally {
        db.close();
      }
    });

    it('makes the CREATE TABLE text of todos match the spec (S2)', async () => {
      const v5 = createTestDatabase(5);
      const v6 = createTestDatabase(6);
      try {
        const before = await schemaOfTodos(v5);
        expect(before.endsWith(TAIL_V5)).toBe(true);
        const expected = before.slice(0, before.length - TAIL_V5.length) + TAIL_V6;
        expect(await schemaOfTodos(v6)).toBe(expected);
      } finally {
        v5.close();
        v6.close();
      }
    });
  });

  describe('V7 (reminders, reminder_deliveries, time_sessions)', () => {
    const AT = '2026-01-01T00:00:00.000Z';
    const DUE = '2026-11-16T08:00:00.000Z';
    const KEY = '2026-11-16T09:00:00';
    const END = '2026-11-16T07:10:00.000Z';
    const R1 = '00000000-0000-4000-8000-000000000001';
    const S1 = '00000000-0000-4000-8000-000000000011';
    const S2 = '00000000-0000-4000-8000-000000000012';

    type Db = ReturnType<typeof createTestDatabase>;

    interface ReminderParams {
      id?: string;
      exdates?: string;
      enabled?: number;
      at?: string | null;
      key?: string | null;
    }

    const insertReminder = (db: Db, p: ReminderParams = {}) =>
      db.execute(
        "INSERT INTO reminders (id, title, start_local, time_zone, rrule, exdates, enabled, next_fire_at, next_fire_key, created_at, updated_at) VALUES ($1, 'T', '2026-11-16T09:00:00', 'Europe/Paris', 'FREQ=DAILY', $2, $3, $4, $5, $6, $6)",
        [
          p.id ?? R1,
          p.exdates ?? '[]',
          p.enabled ?? 1,
          p.at === undefined ? DUE : p.at,
          p.key === undefined ? KEY : p.key,
          AT,
        ],
      );

    const insertSession = (
      db: Db,
      kind: string,
      ends: string | null,
      ended: string | null,
      reason: string | null,
      id = S1,
    ) =>
      db.execute(
        "INSERT INTO time_sessions (id, kind, label, started_at, ends_at, ended_at, end_reason, created_at, updated_at) VALUES ($1, $2, '', '2026-11-16T07:00:00.000Z', $3, $4, $5, $6, $6)",
        [id, kind, ends, ended, reason, AT],
      );

    const insertDelivery = (db: Db, outcome = 'late', skipped = 6) =>
      db.execute(
        'INSERT INTO reminder_deliveries (reminder_id, occurrence_key, due_at, outcome, skipped_count, seen_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NULL, $6, $6)',
        [R1, KEY, DUE, outcome, skipped, AT],
      );

    const refused = (promise: Promise<unknown>, label: string) =>
      expect(promise, label).rejects.toMatchObject({ kind: 'constraint' });

    it('accepts a valid row in each table', async () => {
      const db = createTestDatabase();
      try {
        await insertReminder(db);
        await insertDelivery(db);
        await insertSession(db, 'countdown', END, null, null);
        await insertSession(db, 'stopwatch', null, null, null, S2);
        expect(await db.select('SELECT COUNT(*) AS n FROM reminders')).toEqual([{ n: 1 }]);
        expect(await db.select('SELECT COUNT(*) AS n FROM time_sessions')).toEqual([{ n: 2 }]);
      } finally {
        db.close();
      }
    });

    it('checks reminders', async () => {
      const db = createTestDatabase();
      try {
        await refused(insertReminder(db, { enabled: 0 }), 'disabled with a cache');
        await refused(insertReminder(db, { key: null }), 'cache without key');
        await refused(insertReminder(db, { at: null }), 'key without cache');
        await refused(insertReminder(db, { exdates: 'x' }), 'exdates not JSON');
        await refused(insertReminder(db, { exdates: '{}' }), 'exdates not an array');
        await refused(insertReminder(db, { id: 'BAD' }), 'malformed id');
        await insertReminder(db, { enabled: 0, at: null, key: null });
      } finally {
        db.close();
      }
    });

    it('checks time_sessions', async () => {
      const db = createTestDatabase();
      try {
        await refused(insertSession(db, 'stopwatch', END, null, null), 'stopwatch with an end');
        await refused(insertSession(db, 'countdown', null, null, null), 'countdown without end');
        await refused(
          insertSession(db, 'countdown', '2026-11-16T07:00:00.000Z', null, null),
          'ends_at not after started_at',
        );
        await refused(
          insertSession(db, 'countdown', END, '2026-11-16T07:11:00.000Z', 'completed'),
          'completed with ended_at different from ends_at',
        );
        await refused(insertSession(db, 'countdown', END, END, null), 'ended_at without reason');
        await refused(insertSession(db, 'alarm', END, null, null), 'unknown kind');
        await insertSession(db, 'countdown', END, END, 'completed');
      } finally {
        db.close();
      }
    });

    it('allows a single running pomodoro (safety-net index)', async () => {
      const db = createTestDatabase();
      try {
        await insertSession(db, 'pomodoro_work', END, null, null, S1);
        await expect(
          insertSession(db, 'pomodoro_short_break', END, null, null, S2),
        ).rejects.toMatchObject({ kind: 'conflict' });
        await insertSession(db, 'pomodoro_work', END, END, 'completed', S2);
        await insertSession(
          db,
          'countdown',
          END,
          null,
          null,
          '00000000-0000-4000-8000-000000000013',
        );
      } finally {
        db.close();
      }
    });

    it('checks reminder_deliveries, keys them by occurrence and cascades on delete', async () => {
      const db = createTestDatabase();
      try {
        await refused(insertDelivery(db), 'delivery of an unknown reminder');
        await insertReminder(db);
        await refused(insertDelivery(db, 'skipped'), 'unknown outcome');
        await refused(insertDelivery(db, 'late', -1), 'negative skipped count');
        await refused(insertDelivery(db, 'late', 1001), 'skipped count above 1000');
        await insertDelivery(db);
        await expect(insertDelivery(db, 'on_time', 0)).rejects.toMatchObject({ kind: 'conflict' });
        await db.execute('DELETE FROM reminders WHERE id = $1', [R1]);
        expect(await db.select('SELECT COUNT(*) AS n FROM reminder_deliveries')).toEqual([
          { n: 0 },
        ]);
      } finally {
        db.close();
      }
    });

    it('migrates a V6 database with data into V7 without loss', async () => {
      const db = createTestDatabase(6);
      try {
        await db.execute(
          "INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000000d1', 'Home', 0, $1, $1)",
          [AT],
        );
        await db.execute(
          "INSERT INTO settings (key, value, created_at, updated_at) VALUES ('theme', '\"dark\"', $1, $1)",
          [AT],
        );
        const dashboards = await db.select('SELECT * FROM dashboards');
        const settings = await db.select('SELECT * FROM settings');
        const v7 = listMigrationFiles().find((m) => m.version === 7);
        expect(v7?.name).toBe('timers_reminders');
        db.exec('BEGIN');
        db.exec(v7?.sql ?? '');
        db.exec('COMMIT');
        expect(await db.select('SELECT * FROM dashboards')).toEqual(dashboards);
        expect(await db.select('SELECT * FROM settings')).toEqual(settings);
        expect(await db.select('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
      } finally {
        db.close();
      }
    });
  });
});
