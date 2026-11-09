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
        'settings',
        'shortcuts',
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
});
