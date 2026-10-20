// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettier = require('eslint-config-prettier');

/** Builds the no-restricted-imports options (test-only modules are always restricted). */
function restrict({ plugin, internals }) {
  const paths = [{ name: 'better-sqlite3', message: 'Test-only dependency (data/testing).' }];
  if (plugin) {
    paths.push({
      name: '@tauri-apps/plugin-sql',
      message: 'Only data/sqlite/tauri-sql-executor.ts may import the SQL plugin.',
    });
  }
  const patterns = [{ group: ['node:*'], message: 'Node built-ins are test-only.' }];
  if (internals) {
    patterns.push({
      group: ['**/data/sqlite/**', '**/data/testing/**'],
      message: 'Import from the data layer public API (data/index.ts) instead.',
    });
  }
  return { paths, patterns };
}

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // ADR-002 §6.8: confine the SQL plugin, the native test driver and data internals.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', restrict({ plugin: true, internals: true })],
    },
  },
  {
    files: ['src/app/data/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', restrict({ plugin: true, internals: false })],
    },
  },
  {
    files: ['src/app/data/sqlite/tauri-sql-executor.ts'],
    rules: {
      'no-restricted-imports': ['error', restrict({ plugin: false, internals: false })],
    },
  },
  {
    files: ['src/app/data/testing/**/*.ts', 'src/app/data/**/*.spec.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
  prettier,
]);
