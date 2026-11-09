// WCAG contrast check of core/theme/tokens.css: the essential text/background pairs
// (docs/DESIGN.md section 6) and, per card tint, the pairs of the dashboard theme
// (docs/specs/dashboard-theme.md 4.2). Pure Node, no dependency.
// Usage: node scripts/check-contrast.mjs [tokensCssPath] [dashboardThemeTsPath]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(
  process.argv[2] ?? path.join(scriptDir, '..', 'src', 'app', 'core', 'theme', 'tokens.css'),
);
const themeFile = path.resolve(
  process.argv[3] ??
    path.join(scriptDir, '..', 'src', 'app', 'core', 'dashboard', 'dashboard-theme.ts'),
);
for (const f of [file, themeFile]) {
  if (!existsSync(f)) {
    console.error(`File not found: ${f}`);
    process.exit(2);
  }
}

const TEXT = 4.5; // WCAG AA, normal text
const GRAPHIC = 3; // WCAG 1.4.11: icons, focus ring
const SEPARATOR = 1.3; // card frame and header separator: not below the default design (1.34:1)

const PAIRS = [
  ['fg', 'bg', TEXT],
  ['fg', 'bg-subtle', TEXT],
  ['fg-muted', 'bg', TEXT],
  ['fg-muted', 'bg-subtle', TEXT],
  ['accent', 'bg', TEXT],
  ['danger', 'bg', TEXT],
  ['success', 'bg', TEXT],
  ['fg-on-emphasis', 'success-emphasis', TEXT],
  ['fg-on-emphasis', 'accent-emphasis', TEXT],
  ['fg-on-emphasis', 'bg-emphasis', TEXT],
];

const MEANINGS = ['accent', 'danger', 'success', 'attention'];
const ROLES = ['body', 'header', 'muted', 'border'];

const tintPairs = (t) => [
  ['fg', `tint-${t}-body`, TEXT],
  ['fg', `tint-${t}-header`, TEXT],
  [`tint-${t}-muted`, `tint-${t}-body`, TEXT],
  [`tint-${t}-muted`, `tint-${t}-header`, TEXT],
  [`tint-${t}-muted`, 'bg-subtle', TEXT], // buttons, flash banners inside a tinted body
  [`tint-${t}-muted`, 'bg-inset', TEXT], // fields (placeholder) inside a tinted body
  ...MEANINGS.map((m) => [`on-tint-${m}`, `tint-${t}-body`, TEXT]),
  ['focus', `tint-${t}-body`, GRAPHIC],
  ['focus', `tint-${t}-header`, GRAPHIC],
  [`tint-${t}-border`, `tint-${t}-header`, SEPARATOR],
  [`tint-${t}-border`, `tint-${t}-body`, SEPARATOR],
  [`tint-${t}-border`, 'page-bg', SEPARATOR],
  // Mixed cases (D5): the border of the tint present next to a default body or header.
  [`tint-${t}-border`, 'bg', SEPARATOR],
  [`tint-${t}-border`, 'bg-subtle', SEPARATOR],
];

const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations (`--hb-name: #hex;` or `--hb-name: var(--hb-other);`) of the blocks matching `selector`. */
function collect(selector) {
  const tokens = {};
  const blocks = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, sel, body] of blocks) {
    if (!sel.split(',').some((s) => s.trim() === selector)) continue;
    for (const m of body.matchAll(
      /--hb-([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|var\(\s*--hb-([\w-]+)\s*\))\s*;/g,
    )) {
      tokens[m[1]] = m[3] ? { alias: m[3] } : m[2];
    }
  }
  return tokens;
}

/** Resolves aliases iteratively (depth 5); a cycle or a missing target leaves the token out. */
function resolve(tokens) {
  const out = {};
  for (const name of Object.keys(tokens)) {
    let value = tokens[name];
    for (let depth = 0; depth < 5 && typeof value === 'object'; depth++) {
      value = tokens[value.alias];
    }
    if (typeof value === 'string') out[name] = value;
  }
  return out;
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

const failures = [];

const lightRaw = collect(':root');
const darkRaw = collect('.app-dark');
const themes = {
  light: resolve(lightRaw),
  dark: resolve({ ...lightRaw, ...darkRaw }),
};

// Tints found in :root, each declared with its 4 roles in :root and in .app-dark.
const tints = [
  ...new Set(
    [...css.matchAll(/--hb-tint-([a-z]+)-(?:body|header|muted|border)\s*:/g)].map((m) => m[1]),
  ),
];
const requiredDeclarations = [
  ...tints.flatMap((t) => ROLES.map((r) => `tint-${t}-${r}`)),
  ...MEANINGS.map((m) => `on-tint-${m}`),
];
for (const name of requiredDeclarations) {
  if (!(name in lightRaw)) failures.push(`missing declaration --hb-${name} in :root`);
  if (!(name in darkRaw)) failures.push(`missing declaration --hb-${name} in .app-dark`);
}
if (tints.length === 0) failures.push('no card tint (--hb-tint-<id>-<role>) found in :root');
for (const t of tints) {
  if (t === 'default') failures.push(`tint id "default" is reserved (--hb-tint-default-*)`);
}

// CARD_TINTS (front) must list exactly the tints of tokens.css.
const themeSource = readFileSync(themeFile, 'utf8');
const literal = /CARD_TINTS\s*=\s*\[([\s\S]*?)\]/.exec(themeSource);
if (!literal) {
  failures.push(`CARD_TINTS literal not found in ${themeFile}`);
} else {
  const listed = [...literal[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  for (const id of listed) {
    if (id === 'default') failures.push(`CARD_TINTS contains the reserved id "default"`);
  }
  for (const id of listed.filter((id) => !tints.includes(id))) {
    failures.push(`CARD_TINTS lists "${id}" but tokens.css declares no tint "${id}"`);
  }
  for (const id of tints.filter((id) => !listed.includes(id))) {
    failures.push(`tokens.css declares tint "${id}" but CARD_TINTS does not list it`);
  }
}

for (const [theme, tokens] of Object.entries(themes)) {
  const pairs = [
    ...PAIRS,
    ...tints.flatMap(tintPairs),
    ...MEANINGS.flatMap((m) => [
      [`on-tint-${m}`, 'bg-subtle', TEXT],
      [`on-tint-${m}`, 'bg-inset', TEXT],
    ]),
  ];
  for (const [fg, bg, min] of pairs) {
    if (!tokens[fg] || !tokens[bg]) {
      failures.push(`${theme}: missing token --hb-${tokens[fg] ? bg : fg}`);
      continue;
    }
    const ratio = contrast(tokens[fg], tokens[bg]);
    const line = `${theme}: --hb-${fg} on --hb-${bg} = ${ratio.toFixed(2)}:1`;
    if (ratio < min) failures.push(`${line} (< ${min}:1)`);
    else console.log(`ok   ${line} (min ${min})`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((f) => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log('Contrast OK.');
