// jsdom has no layout, so this guards the text of the rules that keep the grid inside its area:
// no forced width (setGridSize is off, the lib writes no inline size) and a clipped overflow;
// the vertical bar has no background nor border of its own.
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
// Drag handle: invisible at rest, visible on hover and keyboard focus of the header; resize corner
// transparent at rest and shown on hover of the card. Selectors keep the gridster-item prefix.
const handleRule = /app-dashboard gridster-item \.widget-drag-handle\s*\{([^}]*)\}/.exec(css);
if (!handleRule || !/opacity:\s*0\s*;/.test(handleRule[1])) {
  errors.push('.widget-drag-handle must be invisible at rest (opacity: 0)');
}
const visible = /([^{}]*)\{\s*opacity:\s*1\s*;?\s*\}/.exec(css);
if (
  !visible ||
  !/gridster-item \.box-header:hover \.widget-drag-handle/.test(visible[1]) ||
  !/gridster-item \.box-header:focus-within \.widget-drag-handle/.test(visible[1])
) {
  errors.push('.widget-drag-handle must be visible on header hover and focus-within');
}
const corner = /app-dashboard \.gridster-item-resizable-handler\.handle-se\s*\{([^}]*)\}/.exec(css);
if (!corner || !/border-color:\s*transparent\s*;/.test(corner[1])) {
  errors.push('the resize corner must be transparent at rest');
}
if (!/gridster-item:hover \.gridster-item-resizable-handler\.handle-se\s*\{/.test(css)) {
  errors.push('the resize corner must appear on hover of the card');
}
if (/dashboard-grid-editing/.test(css)) errors.push('no edit mode class must remain');
const themeCss = readFileSync(
  path.join(dir, '..', 'src', 'app', 'core', 'theme', 'components.css'),
  'utf8',
);
const sidebar = /(^|[\s,}])\.sidebar\s*\{([^}]*)\}/.exec(themeCss);
if (!sidebar) {
  errors.push('components.css: rule for .sidebar not found');
} else if (/(^|[;\s])(background|border)[\w-]*\s*:/.test(sidebar[2])) {
  errors.push('.sidebar must have no background nor border of its own');
}
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log('dashboard grid css: all checks passed');
