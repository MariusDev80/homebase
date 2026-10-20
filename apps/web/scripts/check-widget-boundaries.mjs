// Checks the dependency rules of ADR-001 section 3.1 (R1 to R4). Pure Node, no dependency.
// Usage: node scripts/check-widget-boundaries.mjs [rootDir]   (default: src/app)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(scriptDir, '..', 'src', 'app'));

if (!existsSync(root)) {
  console.error(`Root directory not found: ${root}`);
  process.exit(2);
}

const ALIASES = { '@core/': 'core', '@data/': 'data', '@widgets/': 'widgets' };
const IMPORT_PATTERN =
  /(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function listTsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') files.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Blanks block comments (keeping newlines) and whole-line `//` comments. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

/** Zone = first segment under root; widget = second segment under widgets/. */
function locate(absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  const zone = ['core', 'data', 'widgets'].includes(segments[0]) ? segments[0] : 'other';
  // A file directly inside widgets/ (e.g. widgets.providers.ts) belongs to no widget.
  const widget = zone === 'widgets' && segments.length > 2 ? segments[1] : null;
  return { zone, widget, relative: relative.split(path.sep).join('/') };
}

function resolveSpecifier(specifier, fromFile) {
  if (specifier.startsWith('.')) return path.resolve(path.dirname(fromFile), specifier);
  for (const [prefix, zone] of Object.entries(ALIASES)) {
    if (specifier.startsWith(prefix)) return path.join(root, zone, specifier.slice(prefix.length));
  }
  return null;
}

const violations = [];

for (const file of listTsFiles(root)) {
  const source = stripComments(readFileSync(file, 'utf8'));
  const from = locate(file);
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    const line = source.slice(0, match.index).split('\n').length;
    const report = (rule, message) => violations.push(`${file}:${line} [${rule}] ${message}`);

    if (from.zone === 'widgets' && specifier.startsWith('@tauri-apps/')) {
      report('R4', `widget must not import ${specifier}; go through core/ or data/`);
    }
    const resolved = resolveSpecifier(specifier, file);
    const target = resolved ? locate(resolved) : null;
    if (!target) continue;

    if (from.zone === 'core' && target.zone === 'widgets') {
      report('R2', `core/ must not import widgets/ (${specifier})`);
    }
    if (from.zone === 'other' && target.zone === 'widgets') {
      const allowed =
        (from.relative === 'app.config.ts' && target.relative === 'widgets/widgets.providers') ||
        from.relative.endsWith('.spec.ts');
      if (!allowed) {
        report('R5', `only app.config.ts may import widgets/widgets.providers (${specifier})`);
      }
    }
    if (from.zone === 'data' && (target.zone === 'core' || target.zone === 'widgets')) {
      report('R3', `data/ must not import ${target.zone}/ (${specifier})`);
    }
    if (from.zone === 'widgets' && from.widget && target.zone === 'widgets') {
      if (target.widget === null) {
        report('R1', `widget must not import widgets/ root files (${specifier})`);
      } else if (target.widget !== from.widget) {
        report('R1', `widget "${from.widget}" must not import widget "${target.widget}"`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  console.error(`${violations.length} boundary violation(s).`);
  process.exit(1);
}
console.log(`Widget boundaries OK (${path.relative(process.cwd(), root) || '.'}).`);
