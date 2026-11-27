// Fails when the initial chunks (index.html scripts + modulepreload + their static imports) contain
// the command names of the lazy content repositories (todo, note, shortcut: data/content.tokens.ts). Those
// repositories must only be reachable through dynamic imports (lazy widgets / calendar sources).
// It also fails when `plugin:sql` appears in ANY file of the dist: the front has no SQL plugin access.
// Usage: node scripts/check-initial-bundle.mjs [distDir]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] ?? path.join(scriptDir, '..', 'dist', 'web', 'browser'));
// Command names owned by the lazy content repositories (data/tauri/tauri-{todo,note,shortcut}).
const FORBIDDEN = ['todo_list_items', 'note_search', 'shortcut_reorder'];
// Must appear in no .js file of the dist at all (no relevance guard: absence is the goal).
const FORBIDDEN_EVERYWHERE = ['plugin:sql'];

const indexPath = path.join(dist, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`Build output not found: ${indexPath} (run the web build first)`);
  process.exit(2);
}

const html = readFileSync(indexPath, 'utf8');
const roots = [
  ...html.matchAll(/<script[^>]*\ssrc="([^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g),
].map((m) => m[1]);
if (roots.length === 0) {
  console.error('No script / modulepreload found in index.html');
  process.exit(2);
}

// Static imports only: `from"./x.js"` and `import"./x.js"`; dynamic `import("./x.js")` is skipped.
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["'](\.\/[^"']+\.js)["']/g;
const initial = new Set();
const queue = [...roots];
while (queue.length > 0) {
  const name = queue.pop().replace(/^\.\//, '');
  if (initial.has(name)) continue;
  const file = path.join(dist, name);
  if (!existsSync(file)) {
    console.error(`Initial chunk missing on disk: ${name}`);
    process.exit(2);
  }
  initial.add(name);
  for (const m of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) queue.push(m[1]);
}

// Relevance: each forbidden pattern must exist somewhere in the dist (lazy chunks), else the guard
// would pass vacuously after a SQL rewrite or a rename.
function listJs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJs(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}
const allText = listJs(dist).map((f) => readFileSync(f, 'utf8'));
const stale = FORBIDDEN.filter((needle) => !allText.some((t) => t.includes(needle)));
if (stale.length > 0) {
  console.error(
    `Obsolete pattern(s), found nowhere in the dist (update FORBIDDEN): ${stale.join(', ')}`,
  );
  process.exit(2);
}

const everywhere = FORBIDDEN_EVERYWHERE.flatMap((needle) =>
  listJs(dist).flatMap((f) =>
    readFileSync(f, 'utf8').includes(needle) ? [`${path.relative(dist, f)}: ${needle}`] : [],
  ),
);
if (everywhere.length > 0) {
  console.error('Forbidden pattern(s) found in the dist (the front has no SQL plugin access):');
  for (const line of everywhere) console.error(`  ${line}`);
  process.exit(1);
}

const found = [];
for (const name of initial) {
  const text = readFileSync(path.join(dist, name), 'utf8');
  for (const needle of FORBIDDEN) if (text.includes(needle)) found.push(`${name}: ${needle}`);
}
if (found.length > 0) {
  console.error('Content repository commands found in the initial bundle (must stay lazy):');
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}
console.log(
  `OK: no content repository command in ${initial.size} initial chunk(s), no plugin:sql anywhere in the dist.`,
);
