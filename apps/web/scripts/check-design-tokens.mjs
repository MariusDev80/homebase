// Forbids raw colors outside the design tokens (docs/DESIGN.md section 5): Tailwind palette
// classes (bg-slate-800, text-white...), hexadecimal values and rgb()/hsl()/oklch() functions in
// templates, inline templates and component styles. Only core/theme/tokens.css and
// core/theme/homebase-preset.ts may define colors. Pure Node, no dependency.
// Usage: node scripts/check-design-tokens.mjs [rootDir]   (default: src/app)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(scriptDir, '..', 'src', 'app'));

if (!existsSync(root)) {
  console.error(`Root directory not found: ${root}`);
  process.exit(2);
}

const EXTENSIONS = ['.html', '.css', '.ts'];
const ALLOWED_FILES = new Set(['tokens.css', 'homebase-preset.ts']);

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';
const UTILITIES =
  'bg|text|border|border-[xytblrse]|ring|ring-offset|outline|fill|stroke|from|via|to|divide|placeholder|accent|caret|decoration|shadow';

const RULES = [
  {
    name: 'palette',
    message: 'raw Tailwind palette class; use a semantic class (bg-canvas, text-fg-muted...)',
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:[\w-]+:)*(?:${UTILITIES})-(?:${PALETTE})(?:-\d{2,3})?(?:/\d+)?(?![\w-])`,
      'g',
    ),
  },
  {
    name: 'hex',
    message: 'hexadecimal color; use a --hb-* token',
    pattern: /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g,
  },
  {
    name: 'color-function',
    message: 'raw color function; use a --hb-* token',
    pattern: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g,
  },
];

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') files.push(...listFiles(full));
    } else if (
      EXTENSIONS.includes(path.extname(entry.name)) &&
      !entry.name.endsWith('.spec.ts') &&
      !ALLOWED_FILES.has(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Blanks comments (keeping newlines) so that documentation can mention colors. */
function stripComments(source) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

const violations = [];
for (const file of listFiles(root)) {
  const source = stripComments(readFileSync(file, 'utf8'));
  for (const rule of RULES) {
    for (const match of source.matchAll(rule.pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${file}:${line} [${rule.name}] "${match[0]}": ${rule.message}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  console.error(`${violations.length} design token violation(s).`);
  process.exit(1);
}
console.log(`Design tokens OK (${path.relative(process.cwd(), root) || '.'}).`);
