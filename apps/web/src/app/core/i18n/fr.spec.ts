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
  'nav.dashboard',
  'nav.settings',
  'theme.toggle',
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

describe('fr.json', () => {
  it.each([...SHELL_KEYS, ...WIDGET_KEYS])('defines a non-empty string for %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeGreaterThan(0);
  });

  it('uses Transloco interpolation for parameters', () => {
    expect(lookup('widgets.hello.greeting')).toContain('{{ name }}');
    expect(lookup('widgetHost.unknownType')).toContain('{{ type }}');
    expect(lookup('theme.toggle')).toContain('{{ mode }}');
  });
});
