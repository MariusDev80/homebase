// Runs the PrimeNG preset checker on its fixtures: "ok" must pass, "ko" must fail with 1 missing preset.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(dir, 'check-primeng-presets.mjs');
const run = (name) => {
  const root = path.join(dir, 'fixtures', 'primeng-presets', name);
  return spawnSync(
    process.execPath,
    [checker, path.join(root, 'src'), path.join(root, 'preset.ts')],
    { encoding: 'utf8' },
  );
};

const failures = [];
const ok = run('ok');
if (ok.status !== 0) failures.push(`ok fixture: expected exit 0, got ${ok.status}\n${ok.stderr}`);

const ko = run('ko');
if (ko.status !== 1) failures.push(`ko fixture: expected exit 1, got ${ko.status}`);
if (!/1 missing PrimeNG preset/.test(ko.stderr) || !/primeng\/select /.test(ko.stderr))
  failures.push(`ko fixture: expected select to be reported missing\n${ko.stderr}`);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('PrimeNG preset checker fixtures OK.');
