// jsdom has no layout, so this guards the text of the rule that stops the grid from widening at each
// move: without it, gridster's inline width (setGridSize) grows by 2 * margin at every layout.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  path.join(dir, '..', 'src', 'app', 'core', 'dashboard', 'dashboard.component.css'),
  'utf8',
);

const rule = /gridster\.dashboard-grid\s*\{[^}]*width:\s*100%\s*!important/;
if (!rule.test(css)) {
  console.error(
    'dashboard.component.css: gridster.dashboard-grid must force width: 100% !important',
  );
  process.exit(1);
}
console.log('dashboard grid css: all checks passed');
