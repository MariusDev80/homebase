// Runs the boundary checker on its fixtures: "ok" must pass, "ko" must fail with exactly 5 violations.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(dir, 'check-widget-boundaries.mjs');
const run = (name) =>
  spawnSync(process.execPath, [checker, path.join(dir, 'fixtures', 'boundaries', name)], {
    encoding: 'utf8',
  });

const failures = [];
const ok = run('ok');
if (ok.status !== 0) failures.push(`ok fixture: expected exit 0, got ${ok.status}\n${ok.stderr}`);

const ko = run('ko');
const count = /(\d+) boundary violation/.exec(ko.stderr)?.[1];
if (ko.status !== 1) failures.push(`ko fixture: expected exit 1, got ${ko.status}`);
if (count !== '5') failures.push(`ko fixture: expected 5 violations, got ${count}\n${ko.stderr}`);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Boundary checker fixtures OK.');
