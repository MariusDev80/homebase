import { ARCHIVE_PROBLEMS, IMPORT_ISSUE_CODES, IMPORT_PROBLEMS } from '../backup/backup.types';
import fr from './fr.json';

function lookup(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      fr,
    );
}

const SHELL_KEYS = [
  'app.name',
  'pages.dashboard.title',
  'pages.settings.title',
  'layout.mainNav',
  'layout.dashboardsNav',
  'nav.settings',
  'theme.mode.system',
  'theme.mode.light',
  'theme.mode.dark',
  'settings.heading',
  'settings.theme.label',
];

// ADR-001 section 8.6
const WIDGET_KEYS = [
  'widgets.hello.title',
  'widgets.hello.description',
  'widgets.hello.greeting',
  'widgets.hello.nameLabel',
  'widgets.hello.save',
  'widgets.hello.invalidName',
  'widgets.notes.title',
  'widgets.notes.saved',
  'widgets.notes.missing',
  'widgets.notes.removeConfirm',
  'widgets.todo.title',
  'widgets.todo.removeConfirm',
  'widgets.todo.empty',
  'widgets.search.title',
  'widgets.search.webSearch',
  'widgets.search.partialError',
  'widgets.weather.title',
  'widgets.weather.description',
  'widgets.weather.errors.network',
  'widgets.weather.conditions.c0',
  'widgets.weather.conditions.unknown',
  'widgets.shortcuts.title',
  'widgets.shortcuts.errors.urlProtocol',
  'dashboard.defaultName',
  'dashboard.loadError',
  'dashboard.addWidget',
  'dashboard.empty',
  'widgetHost.remove',
  'widgetHost.unknownType',
  'widgetHost.invalidConfig',
  'widgetHost.futureVersion',
  'widgetHost.resetConfig',
  'widgetHost.loadError',
  'widgetHost.retry',
];

const BACKUP_KEYS = [
  'time.justNow',
  'backup.title',
  'backup.create',
  'backup.restore.confirm',
  'backup.restore.inProgress',
  'backup.alert.dismiss',
  'backup.alert.restore.applied',
  'backup.alert.restore.rolled-back',
  'backup.alert.restore.failed',
  'backup.errors.unknown',
  'backup.errors.busy',
  'backup.errors.restart_pending',
  'backup.errors.bad_extension',
  'backup.errors.destination_in_data_root',
  'backup.errors.token_mismatch',
  'configTransfer.title',
  'configTransfer.removedWidgets',
  'configTransfer.confirm',
];
const KINDS = ['manual', 'daily', 'pre-migration', 'pre-restore', 'pre-import'];
const ERROR_KINDS = [
  'busy',
  'restart_pending',
  'not_found',
  'invalid_id',
  'no_database',
  'too_large',
  'disk_full',
  'invalid_archive',
  'schema_too_new',
  'invalid_import',
  'io',
  'database',
  'unavailable',
  'unknown',
];

describe('fr.json backup keys', () => {
  it.each([
    ...BACKUP_KEYS,
    ...KINDS.map((k) => `backup.kind.${k}`),
    ...ERROR_KINDS.map((k) => `backup.errors.${k}`),
    ...ARCHIVE_PROBLEMS.map((k) => `backup.archiveProblems.${k}`),
    ...IMPORT_PROBLEMS.map((k) => `backup.importProblems.${k}`),
    ...IMPORT_ISSUE_CODES.map((k) => `configTransfer.issues.${k}`),
  ])('defines %s', (key) => {
    expect(typeof lookup(key)).toBe('string');
    expect((lookup(key) as string).length).toBeGreaterThan(0);
  });
});

describe('fr.json', () => {
  it.each([...SHELL_KEYS, ...WIDGET_KEYS])('defines a non-empty string for %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeGreaterThan(0);
  });

  it('uses Transloco interpolation for parameters', () => {
    expect(lookup('widgets.hello.greeting')).toContain('{{ name }}');
    expect(lookup('widgetHost.unknownType')).toContain('{{ type }}');
  });
});
