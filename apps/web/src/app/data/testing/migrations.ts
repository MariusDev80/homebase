import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NodeSqliteExecutor } from './node-sqlite-executor';

export interface MigrationFile {
  version: number;
  name: string;
  file: string;
  sql: string;
}

export function migrationsDir(): string {
  const dir = process.env['HOMEBASE_MIGRATIONS_DIR'];
  if (!dir) {
    throw new Error('HOMEBASE_MIGRATIONS_DIR is not set (see vitest.data.config.ts)');
  }
  return dir;
}

export function listMigrationFiles(): MigrationFile[] {
  const dir = migrationsDir();
  return readdirSync(dir)
    .map((file) => ({ file, match: /^V(\d+)__([a-z0-9_]+)\.sql$/.exec(file) }))
    .filter((e): e is { file: string; match: RegExpExecArray } => e.match !== null)
    .map(({ file, match }) => ({
      version: Number(match[1]),
      name: match[2],
      file,
      sql: readFileSync(join(dir, file), 'utf8'),
    }))
    .sort((a, b) => a.version - b.version);
}

/** In-memory database with every migration applied, each in a transaction like sqlx. */
export function createTestDatabase(): NodeSqliteExecutor {
  const executor = new NodeSqliteExecutor();
  for (const migration of listMigrationFiles()) {
    executor.exec('BEGIN');
    try {
      executor.exec(migration.sql);
      executor.exec('COMMIT');
    } catch (e) {
      executor.exec('ROLLBACK');
      throw e;
    }
  }
  return executor;
}
