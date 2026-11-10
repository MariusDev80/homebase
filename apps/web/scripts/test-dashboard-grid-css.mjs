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
// Card theme (spec dashboard-theme 4.5): ten slots with the current Box rendering as default, the
// mapping inside .box and .box-header, and the resize corner reading the body slot.
const SLOTS = [
  ['body-bg', '--hb-bg'],
  ['body-muted', '--hb-fg-muted'],
  ['body-border', '--hb-border'],
  ['body-accent', '--hb-accent'],
  ['body-danger', '--hb-danger'],
  ['body-success', '--hb-success'],
  ['body-attention', '--hb-attention'],
  ['header-bg', '--hb-bg-subtle'],
  ['header-muted', '--hb-fg-muted'],
  ['header-border', '--hb-border'],
];
const scope = /(^|[\s,}])\.card-theme\s*\{([^}]*)\}/.exec(themeCss);
const onBox = /\.card-theme \.box\s*\{([^}]*)\}/.exec(themeCss);
const onHeader = /\.card-theme \.box-header\s*\{([^}]*)\}/.exec(themeCss);
if (!scope || !onBox || !onHeader) {
  errors.push('components.css: .card-theme, .card-theme .box and .card-theme .box-header needed');
} else {
  for (const [slot, token] of SLOTS) {
    const decl = new RegExp('--hb-card-' + slot + ':\\s*var\\(--hb-[a-z-]+\\)\\s*;');
    if (!decl.test(scope[2]))
      errors.push('.card-theme must declare --hb-card-' + slot + ' as var()');
    const target = slot.startsWith('body') ? onBox[1] : onHeader[1];
    const map = new RegExp(token + ':\\s*var\\(--hb-card-' + slot + '\\)\\s*;');
    if (!map.test(target)) errors.push(token + ' must read --hb-card-' + slot);
  }
  if ((scope[2].match(/--hb-card-[a-z-]+:/g) ?? []).length !== SLOTS.length) {
    errors.push('.card-theme must declare exactly ' + SLOTS.length + ' slots');
  }
}
const resizeHover =
  /gridster-item:hover \.gridster-item-resizable-handler\.handle-se\s*\{([^}]*)\}/.exec(css);
if (!resizeHover || !/var\(--hb-card-body-muted\)/.test(resizeHover[1])) {
  errors.push('the resize corner must read --hb-card-body-muted on hover of the card');
}
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log('dashboard grid css: all checks passed');
