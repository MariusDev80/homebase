import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Spec timers-reminders D2: the front never writes SQL on the tables owned by the Rust scheduler.
const SQL_ON_TABLE =
  /\b(from|into|update|join|table)\s+(reminders|reminder_deliveries|time_sessions)\b/i;
const RUST_ONLY_TABLE = /\b(reminder_deliveries|time_sessions)\b/i;

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) return sourceFiles(child);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [child] : [];
  });
}

describe('schedule SQL guard', () => {
  it('finds no SQL on the Rust-owned tables in the front sources', () => {
    const files = sourceFiles(new URL('../', import.meta.url));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return SQL_ON_TABLE.test(text) || RUST_ONLY_TABLE.test(text) ? [fileURLToPath(file)] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('the patterns catch the forbidden statements', () => {
    expect(SQL_ON_TABLE.test('SELECT * FROM reminders')).toBe(true);
    expect(SQL_ON_TABLE.test('insert into Reminders (id)')).toBe(true);
    expect(SQL_ON_TABLE.test('UPDATE  reminders SET x')).toBe(true);
    expect(SQL_ON_TABLE.test('JOIN time_sessions s')).toBe(true);
    expect(SQL_ON_TABLE.test('const reminders = []')).toBe(false);
  });
});
