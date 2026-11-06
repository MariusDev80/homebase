// WCAG AA contrast check of the essential text/background pairs of core/theme/tokens.css
// (docs/DESIGN.md section 6). Pure Node, no dependency.
// Usage: node scripts/check-contrast.mjs [tokensCssPath]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(
  process.argv[2] ?? path.join(scriptDir, '..', 'src', 'app', 'core', 'theme', 'tokens.css'),
);
if (!existsSync(file)) {
  console.error(`Tokens file not found: ${file}`);
  process.exit(2);
}

const MIN_RATIO = 4.5;
const PAIRS = [
  ['fg', 'bg'],
  ['fg', 'bg-subtle'],
  ['fg-muted', 'bg'],
  ['fg-muted', 'bg-subtle'],
  ['accent', 'bg'],
  ['danger', 'bg'],
  ['success', 'bg'],
  ['fg-on-emphasis', 'success-emphasis'],
  ['fg-on-emphasis', 'accent-emphasis'],
  ['fg-on-emphasis', 'bg-emphasis'],
];

const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Merges the `--hb-name: #hex;` declarations of every block whose selector matches. */
function collect(selector) {
  const tokens = {};
  const blocks = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, sel, body] of blocks) {
    if (!sel.split(',').some((s) => s.trim() === selector)) continue;
    for (const m of body.matchAll(/--hb-([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      tokens[m[1]] = m[2];
    }
  }
  return tokens;
}

/** Parses #rgb / #rrggbb / #rrggbbaa. The alpha channel is ignored (separator tokens only). */
function parseHex(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = [...h].map((c) => c + c).join('');
  }
  if (h.length !== 6 && h.length !== 8) throw new Error(`Invalid hex color: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = collect(':root');
const themes = { light, dark: { ...light, ...collect('.app-dark') } };

const failures = [];
for (const [theme, tokens] of Object.entries(themes)) {
  for (const [fg, bg] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) {
      failures.push(`${theme}: missing token --hb-${tokens[fg] ? bg : fg}`);
      continue;
    }
    const ratio = contrast(tokens[fg], tokens[bg]);
    const line = `${theme}: --hb-${fg} on --hb-${bg} = ${ratio.toFixed(2)}:1`;
    if (ratio < MIN_RATIO) failures.push(`${line} (< ${MIN_RATIO}:1)`);
    else console.log(`ok   ${line}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((f) => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log('Contrast OK.');
