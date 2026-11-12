// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettier = require('eslint-config-prettier');

/** Builds the no-restricted-imports options (test-only modules are always restricted). */
function restrict({ plugin, internals, temporal = true }) {
  const paths = [
    { name: 'better-sqlite3', message: 'Test-only dependency (data/testing).' },
    {
      name: '@angular/common',
      importNames: ['DatePipe', 'formatDate', 'CommonModule'],
      message: 'ADR-003 : TimeDisplay (CommonModule apporte | date).',
    },
  ];
  if (temporal) {
    paths.push({ name: 'temporal-polyfill', message: 'Importer Temporal depuis core/time.' });
  }
  if (plugin) {
    paths.push({
      name: '@tauri-apps/plugin-sql',
      message: 'Only data/sqlite/tauri-sql-executor.ts may import the SQL plugin.',
    });
  }
  const patterns = [{ group: ['node:*'], message: 'Node built-ins are test-only.' }];
  if (temporal) {
    patterns.push({
      group: ['temporal-polyfill', 'temporal-polyfill/*'],
      message: 'Importer Temporal depuis core/time.',
    });
  }
  if (internals) {
    patterns.push({
      group: ['**/data/sqlite/**', '**/data/testing/**'],
      message: 'Import from the data layer public API (data/index.ts) instead.',
    });
  }
  return { paths, patterns };
}

// ADR-003 section 8.3. Only one option list is effective per file: build the merged lists here.
const DATE_RULES = [
  {
    selector:
      "Identifier[name='Date']:not([parent.type='TSTypeReference']):not([parent.type='TSTypeQuery'])",
    message: 'ADR-003 : utiliser core/time (Temporal) et CLOCK.',
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(get|set)(UTC)?(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|Time)$/]',
    message: 'ADR-003 : pas de calcul de date à la main.',
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(getTimezoneOffset|toLocaleDateString|toLocaleTimeString)$/]',
    message: 'ADR-003 : passer par TimeDisplay.',
  },
  {
    selector:
      "MemberExpression[object.name='Intl'][property.name='DateTimeFormat'], MemberExpression[object.name='Intl'][property.value='DateTimeFormat'], VariableDeclarator[init.name='Intl']",
    message: 'ADR-003 : passer par TimeDisplay.',
  },
];
const TEMPORAL_IMPORT_RULE = {
  selector: 'ImportExpression[source.value=/^temporal-polyfill/]',
  message: 'Importer Temporal depuis core/time.',
};
const TEMPORAL_USAGE_RULES = [
  {
    selector:
      "MemberExpression[object.name='Temporal'][property.name='Now'], MemberExpression[object.name='Temporal'][property.value='Now'], MemberExpression[property.name='Now'][object.type='MemberExpression'][object.property.name='Temporal'], VariableDeclarator[init.name='Temporal']",
    message: 'ADR-003 : utiliser CLOCK.',
  },
  {
    selector: "ImportSpecifier[imported.name='Temporal'][local.name!='Temporal']",
    message: "ADR-003 : pas d'alias pour Temporal.",
  },
];
const TEMPORAL_RULES = [TEMPORAL_IMPORT_RULE, ...TEMPORAL_USAGE_RULES];
const DATE_RULES_EXEMPT = [
  'src/app/core/time/**',
  'src/app/data/clock.ts',
  'src/**/*.spec.ts',
  'src/**/testing/**',
];

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
      // The dialog plugin injects a script replacing window.alert/confirm (backup spec 7).
      'no-alert': 'error',
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
    // The only file that may load temporal-polyfill, lazily (ADR-003 section 3.4, amended).
    files: ['src/app/core/time/temporal.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        restrict({ plugin: true, internals: true, temporal: false }),
      ],
    },
  },
  {
    // Test setup: installs the polyfill as a global because Node 24 has no native Temporal.
    files: ['src/test-setup.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // ADR-003 section 8.3: no hand-made date arithmetic, one clock, one formatter.
  {
    files: ['src/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...TEMPORAL_RULES] },
  },
  {
    files: ['src/**/*.ts'],
    ignores: DATE_RULES_EXEMPT,
    rules: { 'no-restricted-syntax': ['error', ...DATE_RULES, ...TEMPORAL_RULES] },
  },
  {
    files: ['src/app/core/time/temporal.ts', 'src/test-setup.ts'],
    rules: { 'no-restricted-syntax': ['error', ...TEMPORAL_USAGE_RULES] },
  },
  {
    files: ['src/app/core/time/clock.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
  prettier,
]);
