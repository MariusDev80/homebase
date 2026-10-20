// Fails when a PrimeNG component imported in src/**/*.ts (specs excluded) has no Aura preset
// declared in core/theme/homebase-preset.ts (`const components = { ... }`). The preset only loads
// the Aura component presets in use, to keep the initial bundle small. Pure Node, no dependency.
// Usage: node scripts/check-primeng-presets.mjs [srcDir] [presetFile]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(process.argv[2] ?? path.join(scriptDir, '..', 'src'));
const presetFile = path.resolve(
  process.argv[3] ?? path.join(src, 'app', 'core', 'theme', 'homebase-preset.ts'),
);

// primeng/* entry points that are not themed components.
const NON_COMPONENTS = new Set(['config', 'api', 'base', 'basecomponent', 'utils', 'dom', 'icons']);

for (const target of [src, presetFile]) {
  if (!existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(2);
  }
}

function listTs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listTs(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(full);
  }
  return files;
}

const declared = /const components\s*=\s*\{([^}]*)\}/.exec(readFileSync(presetFile, 'utf8'));
if (!declared) {
  console.error(`No "const components = { ... }" found in ${presetFile}`);
  process.exit(2);
}
const presets = new Set(
  declared[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

const used = new Map();
for (const file of listTs(src)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/from\s+['"]primeng\/([a-z0-9-]+)['"]/g)) {
    const name = match[1].replaceAll('-', '');
    if (NON_COMPONENTS.has(name)) continue;
    used.set(name, used.get(name) ?? path.relative(src, file));
  }
}

const missing = [...used].filter(([name]) => !presets.has(name));
if (missing.length > 0) {
  for (const [name, file] of missing) {
    console.error(
      `${file}: primeng/${name} is used but has no Aura preset; add "${name}" (from '@primeuix/themes/aura/${name}') to homebase-preset.ts`,
    );
  }
  console.error(`${missing.length} missing PrimeNG preset(s).`);
  process.exit(1);
}
console.log(
  `PrimeNG presets OK (${used.size} component(s) used, ${presets.size} preset(s) loaded).`,
);
