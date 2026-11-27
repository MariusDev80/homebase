import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Spec timers-reminders D2: the front never writes SQL on the tables owned by the Rust scheduler.
// An optional identifier delimiter is accepted: "habits", 'habits', `habits`, [habits].
const SQL_ON_TABLE =
  /\b(from|into|update|join|table)\s+["'`[]?(reminders|reminder_deliveries|time_sessions|habits|habit_checks)\b/i;
const RUST_ONLY_TABLE = /\b(reminder_deliveries|time_sessions|habit_checks)\b/i;
// `habit_checks` is also the name of a Tauri command: the only file allowed to contain the word.
const COMMAND_NAME_FILES = ['data/tauri/tauri-habit.repository.ts'];

// Spec typed-data-commands (lot TC4): the front has no SQL access at all. Case-sensitive on purpose
// (SQL keywords are written in capitals in this code base; prose and identifiers are not).
const SQL_PATTERNS = [
  /SELECT /,
  /INSERT INTO/,
  /DELETE FROM/,
  /PRAGMA/,
  /ATTACH/,
  /VACUUM/,
  /UPDATE \w+ SET/,
  /plugin:sql/,
  /@tauri-apps\/plugin-sql/,
];

const EXECUTOR = /\bSqlExecutor\b/;

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory())
      return entry.name === 'testing' && dir.pathname.endsWith('/data/') ? [] : sourceFiles(child);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [child] : [];
  });
}

describe('front SQL guard', () => {
  it('finds no SQL, no SQL plugin and no executor in the production sources', () => {
    const files = sourceFiles(new URL('../../', import.meta.url));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const hit = SQL_PATTERNS.some((pattern) => pattern.test(text)) || EXECUTOR.test(text);
      return hit ? [fileURLToPath(file).split('\\').join('/')] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('the generic patterns catch positive examples and spare prose', () => {
    const hits = (text: string) => SQL_PATTERNS.some((pattern) => pattern.test(text));
    for (const sample of [
      'SELECT * FROM notes',
      'INSERT INTO notes (id)',
      'DELETE FROM todos',
      'PRAGMA journal_mode',
      "ATTACH DATABASE 'x' AS y",
      'VACUUM INTO',
      'UPDATE notes SET title = 1',
      "invoke('plugin:sql|select')",
      "import Database from '@tauri-apps/plugin-sql'",
    ]) {
      expect(hits(sample), sample).toBe(true);
    }
    expect(hits('const attached = true; // select a note, then update the set')).toBe(false);
    expect(hits('updated_at')).toBe(false);
    expect(EXECUTOR.test("import { SqlExecutor } from './testing/sql-executor'")).toBe(true);
    expect(EXECUTOR.test('const executor: SqlExecutorFactory = null')).toBe(false);
    expect(EXECUTOR.test('const sqlExecutor = 1')).toBe(false);
  });

  it('finds no SQL on the Rust-owned tables in the front sources', () => {
    const files = sourceFiles(new URL('../', import.meta.url));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const path = fileURLToPath(file).split('\\').join('/');
      const allowed = COMMAND_NAME_FILES.some((name) => path.endsWith('/' + name));
      const rustOnly = !allowed && RUST_ONLY_TABLE.test(text);
      return SQL_ON_TABLE.test(text) || rustOnly ? [path] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('the patterns catch the forbidden statements', () => {
    expect(SQL_ON_TABLE.test('SELECT * FROM reminders')).toBe(true);
    expect(SQL_ON_TABLE.test('insert into Reminders (id)')).toBe(true);
    expect(SQL_ON_TABLE.test('UPDATE  reminders SET x')).toBe(true);
    expect(SQL_ON_TABLE.test('JOIN time_sessions s')).toBe(true);
    expect(SQL_ON_TABLE.test('DELETE FROM habits')).toBe(true);
    expect(SQL_ON_TABLE.test('insert into habit_checks')).toBe(true);
    expect(SQL_ON_TABLE.test('SELECT * FROM "habit_checks"')).toBe(true);
    expect(SQL_ON_TABLE.test("insert into 'habits' (id)")).toBe(true);
    expect(SQL_ON_TABLE.test('FROM `habits`')).toBe(true);
    expect(SQL_ON_TABLE.test('JOIN [habit_checks] c')).toBe(true);
    expect(RUST_ONLY_TABLE.test('SELECT day_on FROM habit_checks')).toBe(true);
    expect(SQL_ON_TABLE.test('const habits = []')).toBe(false);
    expect(SQL_ON_TABLE.test('const reminders = []')).toBe(false);
  });
});
