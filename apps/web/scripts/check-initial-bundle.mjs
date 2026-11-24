// Fails when the initial chunks (index.html scripts + modulepreload + their static imports) contain
// SQL of the lazy content repositories (todo, note, shortcut: data/content.tokens.ts). Those
// repositories must only be reachable through dynamic imports (lazy widgets / calendar sources).
// Usage: node scripts/check-initial-bundle.mjs [distDir]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] ?? path.join(scriptDir, '..', 'dist', 'web', 'browser'));
const FORBIDDEN = ['FROM todos', 'FROM notes', 'FROM shortcuts'];

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

const found = [];
for (const name of initial) {
  const text = readFileSync(path.join(dist, name), 'utf8');
  for (const needle of FORBIDDEN) if (text.includes(needle)) found.push(`${name}: ${needle}`);
}
if (found.length > 0) {
  console.error('Content repository SQL found in the initial bundle (must stay lazy):');
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`OK: no content repository SQL in ${initial.size} initial chunk(s).`);
