// Fails when a debug-only symbol of the calendar (core/calendar/calendar-debug.ts, loaded in
// development builds only) shows up in a .js file of the production bundle.
// Usage: node scripts/check-no-debug-in-bundle.mjs [distDir]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] ?? path.join(scriptDir, '..', 'dist', 'web', 'browser'));
const FORBIDDEN = ['__hbCalendar', 'installCalendarDebug', 'seedRepeatingTodos'];

if (!existsSync(dist)) {
  console.error(`Build output not found: ${dist} (run the web build first)`);
  process.exit(2);
}

function listJs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJs(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const files = listJs(dist);
if (files.length === 0) {
  console.error(`No .js file under ${dist}`);
  process.exit(2);
}

const found = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const symbol of FORBIDDEN) {
    if (text.includes(symbol)) found.push(`${path.relative(dist, file)}: ${symbol}`);
  }
}

if (found.length > 0) {
  console.error('Debug-only symbols found in the production bundle:');
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`OK: no debug symbol in ${files.length} bundle file(s).`);
