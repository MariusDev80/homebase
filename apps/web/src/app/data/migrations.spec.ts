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
      expect(tables.map((t) => t.name)).toEqual(['dashboards', 'settings', 'widget_instances']);

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
});
