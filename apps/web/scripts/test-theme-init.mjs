// Checks public/theme-init.js (first-paint theme) in a fake browser environment.
// The storage key and class name must match core/theme/theme.service.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Single source of truth for the key: the exported constant in the Angular service.
const serviceSource = readFileSync(
  new URL('../src/app/core/theme/theme.service.ts', import.meta.url),
  'utf8',
);
const key = /export const THEME_MIRROR_KEY = '([^']+)'/.exec(serviceSource)?.[1];
assert.ok(key, 'THEME_MIRROR_KEY not found in theme.service.ts');

const source = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');

function isDark({ stored, systemDark, storageThrows = false, noMatchMedia = false }) {
  const classes = new Set();
  const window = {
    localStorage: {
      getItem(k) {
        if (storageThrows) throw new Error('denied');
        assert.equal(k, key);
        return stored ?? null;
      },
    },
    matchMedia: noMatchMedia ? undefined : () => ({ matches: systemDark }),
  };
  const document = {
    documentElement: {
      classList: {
        toggle(name, force) {
          assert.equal(name, 'app-dark');
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
    },
  };
  runInNewContext(source, { window, document });
  return classes.has('app-dark');
}

assert.equal(isDark({ stored: 'dark', systemDark: false }), true);
assert.equal(isDark({ stored: 'light', systemDark: true }), false);
assert.equal(isDark({ stored: 'system', systemDark: true }), true);
assert.equal(isDark({ stored: 'system', systemDark: false }), false);
assert.equal(isDark({ stored: undefined, systemDark: true }), true);
assert.equal(isDark({ stored: 'garbage', systemDark: false }), false);
assert.equal(isDark({ stored: undefined, noMatchMedia: true }), false);
// Storage unavailable: must not throw, falls back to the system theme.
assert.equal(isDark({ storageThrows: true, systemDark: true }), true);

console.log('theme-init.js: all checks passed');
