// jsdom has no layout, so this guards the text of the rules that keep the grid inside its area:
// no forced width (setGridSize is off, the lib writes no inline size) and a clipped overflow.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  path.join(dir, '..', 'src', 'app', 'core', 'dashboard', 'dashboard.component.css'),
  'utf8',
);

const block = /gridster\.dashboard-grid\s*\{([^}]*)\}/.exec(css);
const errors = [];
if (!block) {
  errors.push('dashboard.component.css: rule for gridster.dashboard-grid not found');
} else {
  if (/(^|[;\s])width:\s*[^;]*(!important|\d+(px|%|rem|vw))/.test(block[1])) {
    errors.push('gridster.dashboard-grid must not force a width');
  }
  if (!/overflow:\s*clip/.test(block[1])) {
    errors.push('gridster.dashboard-grid must use overflow: clip');
  }
}
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log('dashboard grid css: all checks passed');
