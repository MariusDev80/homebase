// Runs check-contrast.mjs on its fixtures: "ok" must pass, every other case must fail (exit 1)
// with a FAIL line naming the token or the tint at fault.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(dir, 'check-contrast.mjs');
const run = (name) => {
  const base = path.join(dir, 'fixtures', 'contrast', name);
  return spawnSync(
    process.execPath,
    [checker, path.join(base, 'tokens.css'), path.join(base, 'dashboard-theme.ts')],
    { encoding: 'utf8' },
  );
};

const EXPECTED_FAILURES = {
  'missing-dark': /FAIL missing declaration --hb-tint-sky-border in \.app-dark/,
  'tint-mismatch': /FAIL CARD_TINTS lists "mint"/,
  'low-ratio': /FAIL light: --hb-tint-rose-muted on --hb-tint-rose-header = [\d.]+:1 \(< 4\.5:1\)/,
  'default-id': /FAIL tint id "default" is reserved/,
};

const failures = [];
const ok = run('ok');
if (ok.status !== 0) failures.push(`ok fixture: expected exit 0, got ${ok.status}\n${ok.stderr}`);

for (const [name, message] of Object.entries(EXPECTED_FAILURES)) {
  const result = run(name);
  if (result.status !== 1) failures.push(`${name} fixture: expected exit 1, got ${result.status}`);
  if (!message.test(result.stderr)) {
    failures.push(`${name} fixture: expected ${message}, got\n${result.stderr}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Contrast checker fixtures OK.');
