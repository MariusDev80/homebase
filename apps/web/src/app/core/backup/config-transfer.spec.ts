import type { JsonValue } from '../../data';
import { fixtureDefinition, migratedDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from '../widgets';
import type { ImportIssue } from './backup.types';
import {
  CONFIG_FORMAT,
  CONFIG_LIMITS,
  MAX_REPORTED_ISSUES,
  SECRET_KEY_PATTERN,
  buildConfigExport,
  buildImportPreview,
  parseConfigImport,
  serializeConfigExport,
} from './config-transfer';
import type { ParsedConfigImport } from './config-transfer';

interface TestWidget {
  id: string;
  widgetType: string;
  grid: { x: number; y: number; w: number; h: number };
  config: { version: number; data: JsonValue };
  [key: string]: unknown;
}
interface TestDashboard {
  id: string;
  name: string;
  sortOrder: number;
  icon?: string;
  theme?: { version: number; data: unknown };
  widgets: TestWidget[];
  [key: string]: unknown;
}
interface TestDoc {
  format: string;
  formatVersion: number;
  exportedAt: string;
  dashboards: TestDashboard[];
  settings: Record<string, JsonValue>;
  [key: string]: unknown;
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const defaultTheme = () => ({
  version: 1,
  data: { cardBody: 'default', cardHeader: 'default' },
});
const DASH = uuid(1);
const DASH2 = uuid(2);

function widget(n: number, type = 'fixture', data: JsonValue = { label: 'x' }): TestWidget {
  return {
    id: uuid(100 + n),
    widgetType: type,
    grid: { x: 0, y: n, w: 2, h: 2 },
    config: { version: type === 'migrated' ? 3 : 1, data },
  };
}

function validDoc(): TestDoc {
  return {
    format: CONFIG_FORMAT,
    formatVersion: 3,
    exportedAt: '2026-10-22T08:00:00.000Z',
    dashboards: [
      {
        id: DASH,
        name: 'Accueil',
        sortOrder: 0,
        icon: 'star',
        theme: defaultTheme(),
        widgets: [widget(1), widget(2, 'migrated', { label: 'm' })],
      },
    ],
    settings: { 'time.zone': 'Europe/Paris', theme: 'dark' },
  };
}

const single = fixtureDefinition({ type: 'single', maxInstances: 1 });
const definitions: readonly WidgetDefinition[] = [
  fixtureDefinition() as WidgetDefinition,
  migratedDefinition as WidgetDefinition,
  single as WidgetDefinition,
];
const lookup = (type: string): WidgetDefinition | undefined =>
  definitions.find((d) => d.type === type);

function parse(doc: unknown) {
  return parseConfigImport(JSON.stringify(doc), lookup);
}

function mutated(change: (doc: TestDoc) => void): ReturnType<typeof parse> {
  const doc = validDoc();
  change(doc);
  return parse(doc);
}

function issuesOf(result: ReturnType<typeof parse>): string[] {
  return result.ok ? [] : result.issues.map((i: ImportIssue) => `${i.code}@${i.path}`);
}

function expectOk(result: ReturnType<typeof parse>): ParsedConfigImport {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.issues)}`);
  return result.value;
}

describe('buildConfigExport', () => {
  const input = {
    exportedAt: '2026-10-22T08:00:00.000Z',
    dashboards: [
      {
        id: DASH,
        name: 'Accueil',
        sortOrder: 0,
        icon: 'star',
        theme: { cardBody: 'default', cardHeader: 'default' },
        themeVersion: 1,
        widgets: [
          {
            id: uuid(101),
            widgetType: 'fixture',
            grid: { x: 1, y: 2, w: 3, h: 4 },
            config: { label: 'x' },
            configVersion: 1,
          },
        ],
      },
    ],
    settings: new Map<string, JsonValue>([
      ['theme', 'dark'],
      ['github.token', 'ghp_secret'],
      ['bank.apiKey', 'k'],
      ['a.setting', { nested: [1, 2] }],
      ['My.Password', 'p'],
    ]),
  };

  it('has the documented shape and key order', () => {
    const doc = buildConfigExport(input);
    expect(Object.keys(doc)).toEqual([
      'format',
      'formatVersion',
      'exportedAt',
      'dashboards',
      'settings',
    ]);
    expect(doc.format).toBe('homebase/dashboard-config');
    expect(doc.formatVersion).toBe(3);
    expect(doc.dashboards[0].icon).toBe('star');
    expect(doc.dashboards[0].theme).toEqual({
      version: 1,
      data: { cardBody: 'default', cardHeader: 'default' },
    });
    expect(doc.dashboards[0].widgets[0]).toEqual({
      id: uuid(101),
      widgetType: 'fixture',
      grid: { x: 1, y: 2, w: 3, h: 4 },
      config: { version: 1, data: { label: 'x' } },
    });
  });

  it('drops secret-like settings and sorts the others by key', () => {
    const doc = buildConfigExport(input);
    expect(Object.keys(doc.settings)).toEqual(['a.setting', 'theme']);
    expect(JSON.stringify(doc)).not.toMatch(/ghp_secret|apiKey|Password/);
  });

  it('never exports dashboard.last', () => {
    const doc = buildConfigExport({
      ...input,
      settings: new Map<string, JsonValue>([
        ['dashboard.last', 'abc'],
        ['theme', 'dark'],
      ]),
    });
    expect(Object.keys(doc.settings)).toEqual(['theme']);
  });

  it('serializes with two-space indentation', () => {
    expect(serializeConfigExport(buildConfigExport(input))).toContain('\n  "format"');
  });

  it('keeps a "__proto__" setting key as an own property, without touching the prototype', () => {
    const doc = buildConfigExport({
      ...input,
      settings: new Map<string, JsonValue>([['__proto__', { polluted: true }]]),
    });
    expect(Object.keys(doc.settings)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('SECRET_KEY_PATTERN', () => {
  it('matches the same keys as the settings repository and the Rust marker list', () => {
    for (const key of [
      'github.token',
      'bank.apiKey',
      'x.password',
      'My.SECRET',
      'passwd',
      'credentials',
      'api_key',
      'api-key',
      'api.key',
      'apikey',
      'API_KEY',
      'Hypixel.ApiKey',
    ]) {
      expect(SECRET_KEY_PATTERN.test(key), key).toBe(true);
    }
    for (const key of ['theme', 'locale', 'api', 'key', 'time.zone']) {
      expect(SECRET_KEY_PATTERN.test(key), key).toBe(false);
    }
  });
});

describe('parseConfigImport: accepted files', () => {
  it('parses a valid file into a plan with serialized configs', () => {
    const { plan, unknownTypes, futureVersions } = expectOk(parse(validDoc()));
    expect(unknownTypes).toEqual([]);
    expect(futureVersions).toBe(0);
    expect(plan.dashboards).toHaveLength(1);
    expect(plan.dashboards[0]).toEqual({
      id: DASH,
      name: 'Accueil',
      sortOrder: 0,
      icon: 'star',
      theme: '{"cardBody":"default","cardHeader":"default"}',
      themeVersion: 1,
      widgets: [
        {
          id: uuid(101),
          widgetType: 'fixture',
          grid: { x: 0, y: 1, w: 2, h: 2 },
          config: '{"label":"x"}',
          configVersion: 1,
        },
        {
          id: uuid(102),
          widgetType: 'migrated',
          grid: { x: 0, y: 2, w: 2, h: 2 },
          config: '{"label":"m"}',
          configVersion: 3,
        },
      ],
    });
    expect(plan.settings).toEqual([
      { key: 'time.zone', value: '"Europe/Paris"' },
      { key: 'theme', value: '"dark"' },
    ]);
  });

  it('round-trips an export built from registry fixtures', () => {
    const exported = buildConfigExport({
      exportedAt: '2026-10-22T08:00:00.000Z',
      dashboards: [
        {
          id: DASH,
          name: 'Accueil',
          sortOrder: 0,
          icon: 'star',
          theme: { cardBody: 'default', cardHeader: 'default' },
          themeVersion: 1,
          widgets: [
            { ...widget(1), config: { label: 'x' }, configVersion: 1 },
            { ...widget(2, 'migrated'), config: { label: 'm' }, configVersion: 3 },
          ],
        },
        {
          id: DASH2,
          name: 'Second',
          sortOrder: 1,
          icon: 'star',
          theme: { cardBody: 'default', cardHeader: 'default' },
          themeVersion: 1,
          widgets: [],
        },
      ],
      settings: new Map<string, JsonValue>([['theme', 'dark']]),
    });
    const first = expectOk(parseConfigImport(serializeConfigExport(exported), lookup));
    expect(first.plan.dashboards.map((d) => d.id)).toEqual([DASH, DASH2]);
    expect(first.plan.dashboards[0].widgets.map((w) => w.config)).toEqual([
      '{"label":"x"}',
      '{"label":"m"}',
    ]);
    expect(first.plan.settings).toEqual([{ key: 'theme', value: '"dark"' }]);
  });

  it('accepts an unknown widget type and keeps its config raw', () => {
    const result = expectOk(
      mutated((d) => d.dashboards[0].widgets.push(widget(3, 'mystery', { whatever: [1, 2] }))),
    );
    expect(result.unknownTypes).toEqual(['mystery']);
    const kept = result.plan.dashboards[0].widgets[2];
    expect(kept.config).toBe('{"whatever":[1,2]}');
    expect(kept.configVersion).toBe(1);
  });

  it('accepts a future config version of a known type and counts it', () => {
    const result = expectOk(
      mutated((d) => {
        d.dashboards[0].widgets[1].config = { version: 9, data: { shape: 'new' } };
      }),
    );
    expect(result.futureVersions).toBe(1);
    expect(result.plan.dashboards[0].widgets[1]).toMatchObject({
      config: '{"shape":"new"}',
      configVersion: 9,
    });
  });

  it('migrates a v1 config to the current version', () => {
    const result = expectOk(
      mutated((d) => {
        d.dashboards[0].widgets[1].config = { version: 1, data: { title: 'old' } };
      }),
    );
    expect(result.plan.dashboards[0].widgets[1]).toMatchObject({
      config: '{"label":"old"}',
      configVersion: 3,
    });
  });

  it('accepts 100 dashboards, 200 widgets in one, and 200 settings', () => {
    const doc = validDoc();
    doc.dashboards = Array.from({ length: 100 }, (_, i) => ({
      id: uuid(1000 + i),
      name: `D${i}`,
      sortOrder: i,
      icon: 'star',
      theme: defaultTheme(),
      widgets: [],
    }));
    doc.dashboards[0].widgets = Array.from({ length: 200 }, (_, i) => widget(i));
    doc.settings = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
    expect(parse(doc).ok).toBe(true);
  });

  it('ignores dashboard.last without error', () => {
    const result = mutated((d) => (d.settings = { 'dashboard.last': 'abc', theme: 'dark' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan.settings).toEqual([{ key: 'theme', value: '"dark"' }]);
    }
  });

  it('accepts an empty settings object', () => {
    expect(mutated((d) => (d.settings = {})).ok).toBe(true);
  });
});

describe('parseConfigImport: names (HB_TRIM and code points)', () => {
  const nameOf = (name: string) => expectOk(mutated((d) => (d.dashboards[0].name = name))).plan;

  it('normalises edge whitespace, U+0085 and U+FEFF once', () => {
    expect(nameOf(' \u0085Accueil﻿ ').dashboards[0].name).toBe('Accueil');
    // Re-exporting the normalised name and parsing it again changes nothing.
    const again = expectOk(
      mutated((d) => (d.dashboards[0].name = nameOf('\u0085Accueil').dashboards[0].name)),
    );
    expect(again.plan.dashboards[0].name).toBe('Accueil');
  });

  it('keeps inner whitespace', () => {
    expect(nameOf('a b c').dashboards[0].name).toBe('a b c');
  });

  it('accepts 100 accents or 100 emoji and refuses 101', () => {
    expect(mutated((d) => (d.dashboards[0].name = 'é'.repeat(100))).ok).toBe(true);
    expect(mutated((d) => (d.dashboards[0].name = '\u{1F600}'.repeat(100))).ok).toBe(true);
    for (const name of ['é'.repeat(101), '\u{1F600}'.repeat(101)]) {
      expect(issuesOf(mutated((d) => (d.dashboards[0].name = name)))).toEqual([
        'invalid_name@dashboards[0].name',
      ]);
    }
  });

  it('refuses empty and whitespace-only names', () => {
    for (const name of ['', '   ', '\u0085', '﻿　']) {
      expect(issuesOf(mutated((d) => (d.dashboards[0].name = name)))).toEqual([
        'invalid_name@dashboards[0].name',
      ]);
    }
  });

  it('counts the widget type in code points too', () => {
    expect(mutated((d) => d.dashboards[0].widgets.push(widget(9, '\u{1F600}'.repeat(64)))).ok).toBe(
      true,
    );
    expect(
      issuesOf(mutated((d) => d.dashboards[0].widgets.push(widget(9, '\u{1F600}'.repeat(65))))),
    ).toEqual(['invalid_value@dashboards[0].widgets[2].widgetType']);
  });
});

describe('parseConfigImport: dashboard themes (format 3)', () => {
  const setTheme = (d: TestDoc, theme: unknown): void => {
    d.dashboards[0].theme = theme as TestDashboard['theme'];
  };
  const themed = (theme: unknown) => mutated((d) => setTheme(d, theme));
  const DEFAULTS = '{"cardBody":"default","cardHeader":"default"}';

  it('keeps a valid theme and its version, and does not reset themes', () => {
    const value = expectOk(
      themed({ version: 1, data: { cardBody: 'lavender', cardHeader: 'default' } }),
    );
    expect(value.plan.dashboards[0].theme).toBe('{"cardBody":"lavender","cardHeader":"default"}');
    expect(value.plan.dashboards[0].themeVersion).toBe(1);
    expect(value.resetsThemes).toBe(false);
    expect(value.resetsIcons).toBe(false);
  });

  it('normalizes an empty object and keeps an unknown tint as is', () => {
    expect(expectOk(themed({ version: 1, data: {} })).plan.dashboards[0].theme).toBe(DEFAULTS);
    const coral = expectOk(themed({ version: 1, data: { cardBody: 'coral' } }));
    expect(coral.plan.dashboards[0].theme).toBe('{"cardBody":"coral","cardHeader":"default"}');
  });

  it('keeps the raw object of a future version, with its version', () => {
    const value = expectOk(themed({ version: 2, data: { shape: 'round', n: [1] } }));
    expect(value.plan.dashboards[0].theme).toBe('{"shape":"round","n":[1]}');
    expect(value.plan.dashboards[0].themeVersion).toBe(2);
  });

  it('gives formats 1 and 2 the default theme and announces it', () => {
    for (const format of [1, 2]) {
      const value = expectOk(
        mutated((d) => {
          d.formatVersion = format;
          Reflect.deleteProperty(d.dashboards[0], 'theme');
          if (format === 1) Reflect.deleteProperty(d.dashboards[0], 'icon');
        }),
      );
      expect(value.plan.dashboards[0].theme, String(format)).toBe(DEFAULTS);
      expect(value.plan.dashboards[0].themeVersion).toBe(1);
      expect(value.resetsThemes).toBe(true);
      expect(value.resetsIcons).toBe(format === 1);
    }
  });

  it('refuses a theme in formats 1 and 2', () => {
    expect(
      issuesOf(
        mutated((d) => {
          d.formatVersion = 2;
        }),
      ),
    ).toEqual(['unknown_field@dashboards[0].theme']);
  });

  it('refuses a missing theme in format 3', () => {
    expect(issuesOf(mutated((d) => Reflect.deleteProperty(d.dashboards[0], 'theme')))).toEqual([
      'missing_field@dashboards[0].theme',
    ]);
  });

  it('refuses a version outside the integers 1..10000', () => {
    for (const version of [0, 1.5, 10_001, -1]) {
      expect(issuesOf(themed({ version, data: {} })), String(version)).toEqual([
        'invalid_value@dashboards[0].theme.version',
      ]);
    }
  });

  it('refuses data that is not an object', () => {
    for (const data of [[], 'x', null, 1]) {
      expect(issuesOf(themed({ version: 1, data })), JSON.stringify(data)).toEqual([
        'invalid_value@dashboards[0].theme',
      ]);
    }
  });

  it('refuses a malformed tint or an extra key', () => {
    expect(issuesOf(themed({ version: 1, data: { cardBody: 'Rose' } }))).toEqual([
      'invalid_value@dashboards[0].theme',
    ]);
    expect(issuesOf(themed({ version: 1, data: { extra: 'x' } }))).toEqual([
      'invalid_value@dashboards[0].theme',
    ]);
  });

  it('refuses an unknown field of the theme envelope', () => {
    expect(issuesOf(themed({ version: 1, data: {}, x: 1 }))).toEqual([
      'unknown_field@dashboards[0].theme.x',
    ]);
  });

  it('counts the theme length in code points (C27)', () => {
    // {"k":"..."} is 8 characters around the payload.
    const raw = (chars: number) => ({ k: '😀'.repeat(chars - 8) });
    const ok = expectOk(themed({ version: 2, data: raw(4_096) }));
    expect([...ok.plan.dashboards[0].theme]).toHaveLength(4_096);
    expect(ok.plan.dashboards[0].theme.length).toBeGreaterThan(4_096);
    expect(issuesOf(themed({ version: 2, data: raw(4_097) }))).toEqual([
      'invalid_value@dashboards[0].theme',
    ]);
  });
});

describe('parseConfigImport: refused files', () => {
  it('refuses a version above 3, and only reports that for a future format', () => {
    expect(issuesOf(mutated((d) => (d.formatVersion = 4)))).toEqual([
      'unsupported_version@formatVersion',
    ]);
    expect(
      issuesOf(
        mutated((d) => {
          d.formatVersion = 4;
          d['futureField'] = 1;
          d.dashboards[0]['other'] = 2;
        }),
      ),
    ).toEqual(['unsupported_version@formatVersion']);
  });

  it('refuses other invalid versions and a wrong format', () => {
    expect(issuesOf(mutated((d) => (d.formatVersion = 0)))).toEqual([
      'invalid_value@formatVersion',
    ]);
    expect(issuesOf(mutated((d) => (d.formatVersion = 1.5)))).toEqual([
      'invalid_value@formatVersion',
    ]);
    expect(issuesOf(mutated((d) => (d.formatVersion = '1' as unknown as number)))).toEqual([
      'invalid_value@formatVersion',
    ]);
    expect(issuesOf(mutated((d) => (d.format = 'homebase/other')))).toEqual([
      'invalid_value@format',
    ]);
  });

  it('reports missing required fields', () => {
    for (const field of ['exportedAt', 'settings', 'dashboards', 'format', 'formatVersion']) {
      const doc = validDoc();
      Reflect.deleteProperty(doc, field);
      expect(issuesOf(parse(doc)), field).toEqual([`missing_field@${field}`]);
    }
    const doc = validDoc();
    Reflect.deleteProperty(doc.dashboards[0].widgets[0], 'grid');
    Reflect.deleteProperty(doc.dashboards[0], 'name');
    expect(issuesOf(parse(doc))).toEqual([
      'missing_field@dashboards[0].name',
      'missing_field@dashboards[0].widgets[0].grid',
    ]);
    const noData = validDoc();
    Reflect.deleteProperty(noData.dashboards[0].widgets[0].config, 'data');
    expect(issuesOf(parse(noData))).toEqual(['missing_field@dashboards[0].widgets[0].config.data']);
  });

  it('reports unknown fields at every level', () => {
    expect(issuesOf(mutated((d) => (d['extra'] = 1)))).toEqual(['unknown_field@extra']);
    expect(issuesOf(mutated((d) => (d.dashboards[0]['extra'] = 1)))).toEqual([
      'unknown_field@dashboards[0].extra',
    ]);
    expect(issuesOf(mutated((d) => (d.dashboards[0].widgets[0]['extra'] = 1)))).toEqual([
      'unknown_field@dashboards[0].widgets[0].extra',
    ]);
    expect(
      issuesOf(
        mutated((d) => ((d.dashboards[0].widgets[0].grid as Record<string, unknown>)['z'] = 1)),
      ),
    ).toEqual(['unknown_field@dashboards[0].widgets[0].grid.z']);
    expect(
      issuesOf(
        mutated((d) => ((d.dashboards[0].widgets[0].config as Record<string, unknown>)['x'] = 1)),
      ),
    ).toEqual(['unknown_field@dashboards[0].widgets[0].config.x']);
  });

  it('reads icons by format version', () => {
    const v1 = (change: (d: TestDoc) => void = () => undefined) =>
      mutated((d) => {
        d.formatVersion = 1;
        Reflect.deleteProperty(d.dashboards[0], 'icon');
        Reflect.deleteProperty(d.dashboards[0], 'theme');
        change(d);
      });
    expect(expectOk(v1()).plan.dashboards[0].icon).toBe('th-large');
    expect(issuesOf(v1((d) => (d.dashboards[0].icon = 'star')))).toEqual([
      'unknown_field@dashboards[0].icon',
    ]);
    expect(issuesOf(mutated((d) => Reflect.deleteProperty(d.dashboards[0], 'icon')))).toEqual([
      'missing_field@dashboards[0].icon',
    ]);
    for (const bad of ['pi pi-x', 'A', 'a'.repeat(33), '', '1a', 'a\n']) {
      expect(issuesOf(mutated((d) => (d.dashboards[0].icon = bad))), bad).toEqual([
        'invalid_value@dashboards[0].icon',
      ]);
    }
    expect(
      issuesOf(mutated((d) => ((d.dashboards[0] as Record<string, unknown>)['icon'] = 1))),
    ).toEqual(['invalid_value@dashboards[0].icon']);
  });

  it('accepts a well-formed icon outside the closed list and keeps it', () => {
    const value = expectOk(mutated((d) => (d.dashboards[0].icon = 'not-in-the-list')));
    expect(value.plan.dashboards[0].icon).toBe('not-in-the-list');
  });

  it('refuses a malformed exportedAt', () => {
    for (const value of [
      'yesterday',
      '2026-10-22',
      '2026-10-22T08:00:00',
      '2026-02-30T00:00:00.000Z',
    ]) {
      expect(issuesOf(mutated((d) => (d.exportedAt = value))), value).toEqual([
        'invalid_value@exportedAt',
      ]);
    }
  });

  it('refuses not-JSON and non-object roots', () => {
    expect(issuesOf(parseConfigImport('{nope', lookup))).toEqual(['invalid_json@']);
    expect(issuesOf(parseConfigImport('', lookup))).toEqual(['invalid_json@']);
    expect(parseConfigImport('[]', lookup).ok).toBe(false);
    expect(parseConfigImport('null', lookup).ok).toBe(false);
    expect(parseConfigImport('42', lookup).ok).toBe(false);
  });

  it('refuses ids that are not lowercase UUIDs, and duplicates', () => {
    expect(issuesOf(mutated((d) => (d.dashboards[0].id = uuid(255).toUpperCase())))).toEqual([
      'invalid_id@dashboards[0].id',
    ]);
    expect(issuesOf(mutated((d) => (d.dashboards[0].widgets[0].id = 'nope')))).toEqual([
      'invalid_id@dashboards[0].widgets[0].id',
    ]);
    expect(
      issuesOf(
        mutated((d) =>
          d.dashboards.push({
            id: DASH,
            name: 'Autre',
            sortOrder: 1,
            icon: 'star',
            theme: defaultTheme(),
            widgets: [],
          }),
        ),
      ),
    ).toEqual(['duplicate_id@dashboards[1].id']);
    expect(
      issuesOf(
        mutated((d) =>
          d.dashboards.push({
            id: DASH2,
            name: 'Autre',
            sortOrder: 1,
            icon: 'star',
            theme: defaultTheme(),
            widgets: [widget(1)],
          }),
        ),
      ),
    ).toEqual(['duplicate_id@dashboards[1].widgets[0].id']);
  });

  it('refuses 0 and 101 dashboards, 201 widgets, 1001 widgets and 201 settings', () => {
    expect(issuesOf(mutated((d) => (d.dashboards = [])))).toEqual(['no_dashboard@dashboards']);
    expect(
      issuesOf(
        mutated((d) => {
          d.dashboards = Array.from({ length: 101 }, (_, i) => ({
            id: uuid(1000 + i),
            name: 'D',
            sortOrder: i,
            icon: 'star',
            theme: defaultTheme(),
            widgets: [],
          }));
        }),
      ),
    ).toEqual(['too_many@dashboards']);
    expect(
      issuesOf(
        mutated(
          (d) => (d.dashboards[0].widgets = Array.from({ length: 201 }, (_, i) => widget(i))),
        ),
      ),
    ).toEqual(['too_many@dashboards[0].widgets']);
    expect(
      issuesOf(
        mutated((d) => {
          d.dashboards = Array.from({ length: 6 }, (_, i) => ({
            id: uuid(1000 + i),
            name: 'D',
            sortOrder: i,
            icon: 'star',
            theme: defaultTheme(),
            widgets: Array.from({ length: 200 }, (_, j) => widget(i * 200 + j)),
          }));
        }),
      ),
    ).toEqual(['too_many@dashboards']);
    expect(
      issuesOf(
        mutated(
          (d) =>
            (d.settings = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, i]))),
        ),
      ),
    ).toEqual(['too_many@settings']);
  });

  it('refuses out-of-range and non-integer numbers', () => {
    const grid = (patch: Partial<TestWidget['grid']>) =>
      mutated(
        (d) => (d.dashboards[0].widgets[0].grid = { ...d.dashboards[0].widgets[0].grid, ...patch }),
      );
    expect(issuesOf(grid({ w: 0 }))).toEqual(['invalid_value@dashboards[0].widgets[0].grid.w']);
    expect(issuesOf(grid({ h: 0 }))).toEqual(['invalid_value@dashboards[0].widgets[0].grid.h']);
    expect(issuesOf(grid({ x: 1.5 }))).toEqual(['invalid_value@dashboards[0].widgets[0].grid.x']);
    expect(issuesOf(grid({ y: -1 }))).toEqual(['invalid_value@dashboards[0].widgets[0].grid.y']);
    expect(issuesOf(grid({ x: 10_001 }))).toEqual([
      'invalid_value@dashboards[0].widgets[0].grid.x',
    ]);
    expect(grid({ x: 10_000, y: 0, w: 10_000, h: 1 }).ok).toBe(true);
    expect(issuesOf(mutated((d) => (d.dashboards[0].sortOrder = -1)))).toEqual([
      'invalid_value@dashboards[0].sortOrder',
    ]);
    expect(issuesOf(mutated((d) => (d.dashboards[0].sortOrder = 1_000_001)))).toEqual([
      'invalid_value@dashboards[0].sortOrder',
    ]);
    for (const version of [0, 10_001, 1.5]) {
      expect(
        issuesOf(mutated((d) => (d.dashboards[0].widgets[0].config.version = version))),
        String(version),
      ).toEqual(['invalid_value@dashboards[0].widgets[0].config.version']);
    }
  });

  it('refuses a config that is invalid for its widget, with its path', () => {
    expect(
      issuesOf(mutated((d) => (d.dashboards[0].widgets[1].config.data = { label: 5 }))),
    ).toEqual(['invalid_config@dashboards[0].widgets[1].config']);
    expect(
      issuesOf(mutated((d) => (d.dashboards[0].widgets[0].config.data = { label: '' }))),
    ).toEqual(['invalid_config@dashboards[0].widgets[0].config']);
  });

  it('refuses a config that is not an object, or too large, for known and unknown types', () => {
    for (const data of [[1], 'text', null, 7] as JsonValue[]) {
      expect(
        issuesOf(mutated((d) => (d.dashboards[0].widgets[0].config.data = data))),
        JSON.stringify(data),
      ).toEqual(['invalid_config@dashboards[0].widgets[0].config']);
    }
    expect(
      issuesOf(mutated((d) => d.dashboards[0].widgets.push(widget(3, 'mystery', [] as JsonValue)))),
    ).toEqual(['invalid_config@dashboards[0].widgets[2].config']);
    const big = { blob: 'x'.repeat(70_000) };
    expect(
      issuesOf(mutated((d) => d.dashboards[0].widgets.push(widget(3, 'mystery', big)))),
    ).toEqual(['invalid_config@dashboards[0].widgets[2].config']);
    expect(
      issuesOf(mutated((d) => (d.dashboards[0].widgets[1].config = { version: 9, data: big }))),
    ).toEqual(['invalid_config@dashboards[0].widgets[1].config']);
  });

  it('refuses a config version that is invalid for the registry', () => {
    // version 0 never reaches resolveConfig: refused by the range check.
    expect(issuesOf(mutated((d) => (d.dashboards[0].widgets[0].config.version = 0)))).toEqual([
      'invalid_value@dashboards[0].widgets[0].config.version',
    ]);
  });

  it('refuses more instances than maxInstances', () => {
    expect(
      issuesOf(
        mutated((d) => d.dashboards[0].widgets.push(widget(3, 'single'), widget(4, 'single'))),
      ),
    ).toEqual(['max_instances@dashboards[0].widgets[3]']);
    // The limit is per dashboard.
    expect(
      mutated((d) => {
        d.dashboards[0].widgets.push(widget(3, 'single'));
        d.dashboards.push({
          id: DASH2,
          name: 'B',
          sortOrder: 1,
          icon: 'star',
          theme: defaultTheme(),
          widgets: [widget(4, 'single')],
        });
      }).ok,
    ).toBe(true);
  });

  it('never shows a long or bidirectional key coming from the file', () => {
    const long = 'a'.repeat(300);
    const bidi = 'k‮evil';
    for (const key of [long, bidi, 'été']) {
      const result = mutated((d) => (d.settings = { [key]: 1 }));
      expect(issuesOf(result)).toEqual(['invalid_setting_key@settings']);
      expect(JSON.stringify(result)).not.toContain(key);
    }
    const unknownField = mutated((d) => Object.assign(d.dashboards[0], { [bidi]: 1 }));
    expect(JSON.stringify(unknownField)).not.toContain('‮');
    expect(issuesOf(mutated((d) => (d.settings = { ['a'.repeat(40)]: 1 })))).toEqual([]);
  });

  it('refuses secret-like and badly formed setting keys, and bad values', () => {
    expect(issuesOf(mutated((d) => (d.settings = { 'github.token': 'x' })))).toEqual([
      'secret_setting@settings',
    ]);
    expect(issuesOf(mutated((d) => (d.settings = { apiKey: 'x' })))).toEqual([
      'secret_setting@settings.apiKey',
    ]);
    expect(issuesOf(mutated((d) => (d.settings = { 'Bad Key': 1 })))).toEqual([
      'invalid_setting_key@settings',
    ]);
    expect(issuesOf(mutated((d) => (d.settings = { '1abc': 1 })))).toEqual([
      'invalid_setting_key@settings.1abc',
    ]);
    expect(issuesOf(mutated((d) => (d.settings = { a: 'x'.repeat(65_535) })))).toEqual([
      'invalid_setting_value@settings.a',
    ]);
    expect(mutated((d) => (d.settings = { a: 'x'.repeat(65_534) })).ok).toBe(true);
    // 65 534 emoji = 65 536 code points once quoted, but 131 070 UTF-16 units: accepted.
    expect(mutated((d) => (d.settings = { a: '\u{1F600}'.repeat(65_534) })).ok).toBe(true);
  });

  it('refuses settings that are not an object', () => {
    for (const value of [null, [], 'x', 1]) {
      expect(
        issuesOf(mutated((d) => (d.settings = value as unknown as Record<string, JsonValue>))),
      ).toEqual(['invalid_value@settings']);
    }
  });

  it('refuses lone surrogates, which are not valid UTF-8', () => {
    const text = JSON.stringify(validDoc()).replace('Accueil', 'Acc\\ud800ueil');
    expect(issuesOf(parseConfigImport(text, lookup))).toEqual(['invalid_value@']);
    const pair = JSON.stringify(validDoc()).replace('Accueil', 'Acc\\ud83d\\ude00ueil');
    expect(parseConfigImport(pair, lookup).ok).toBe(true);
  });

  it('refuses NUL in names and widget types', () => {
    expect(issuesOf(mutated((d) => (d.dashboards[0].name = 'Ac cueil')))).toEqual([
      'invalid_name@dashboards[0].name',
    ]);
    expect(issuesOf(mutated((d) => d.dashboards[0].widgets.push(widget(9, 'my type'))))).toEqual([
      'invalid_value@dashboards[0].widgets[2].widgetType',
    ]);
  });

  it('refuses what serde_json refuses: nesting over 127, 1e400', () => {
    const deep = (n: number): JsonValue => {
      let value: JsonValue = 1;
      for (let i = 0; i < n; i++) value = { a: value };
      return value;
    };
    // Depth of the whole document: dashboards(1) > [ (2) > { (3) > widgets [ (4) > { (5) > config (6) > data (7).
    const ok = mutated((d) => d.dashboards[0].widgets.push(widget(9, 'mystery', deep(120))));
    expect(ok.ok).toBe(true);
    // Limit: 127 nested containers (serde_json refuses 128).
    const atLimit = mutated((d) => d.dashboards[0].widgets.push(widget(9, 'mystery', deep(121))));
    expect(atLimit.ok).toBe(true);
    const tooDeep = mutated((d) => d.dashboards[0].widgets.push(widget(9, 'mystery', deep(122))));
    expect(issuesOf(tooDeep)).toEqual(['invalid_value@']);
    const huge = JSON.stringify(validDoc()).replace('"sortOrder":0', '"sortOrder":1e400');
    expect(issuesOf(parseConfigImport(huge, lookup))).toEqual(['invalid_value@']);
    const hugeSetting = JSON.stringify(validDoc()).replace('"theme":"dark"', '"theme":[1e400]');
    expect(issuesOf(parseConfigImport(hugeSetting, lookup))).toEqual(['invalid_value@']);
    const veryDeep = '['.repeat(100_000) + ']'.repeat(100_000);
    expect(parseConfigImport(veryDeep, lookup).ok).toBe(false);
  });

  it('reports at most 20 problems and flags the truncation', () => {
    const result = mutated((d) => {
      d.dashboards[0].widgets = Array.from({ length: 30 }, (_, i) => ({
        ...widget(i),
        id: 'bad',
      }));
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(MAX_REPORTED_ISSUES);
      expect(result.truncated).toBe(true);
    }
  });

  it('refuses a file of 1 MiB + 1 byte without parsing it', () => {
    const limit = CONFIG_LIMITS.maxFileBytes;
    expect(issuesOf(parseConfigImport('x'.repeat(limit + 1), lookup))).toEqual(['too_large@']);
    // 2 bytes per character: fewer characters than the limit, more bytes.
    const wide = 'é'.repeat(limit / 2 + 1);
    expect(wide.length).toBeLessThan(limit);
    expect(issuesOf(parseConfigImport(wide, lookup))).toEqual(['too_large@']);
    // Exactly at the limit it is parsed (and fails as JSON, not as too large).
    expect(issuesOf(parseConfigImport('x'.repeat(limit), lookup))).toEqual(['invalid_json@']);
  });
});

describe('parseConfigImport: prototype pollution', () => {
  const polluted = () => ({}) as Record<string, unknown>;

  afterEach(() => {
    expect(polluted()['polluted']).toBeUndefined();
  });

  it('refuses __proto__ at the root, in dashboards, widgets, grid and config', () => {
    const proto = '"__proto__":{"polluted":true}';
    const base = JSON.stringify(validDoc());
    const roots = [
      base.replace('{', `{${proto},`),
      base.replace('"sortOrder":0', `${proto},"sortOrder":0`),
      base.replace('"widgetType":"fixture"', `${proto},"widgetType":"fixture"`),
      base.replace('"grid":{', `"grid":{${proto},`),
      base.replace('"config":{"version":1', `"config":{${proto},"version":1`),
    ];
    for (const text of roots) {
      expect(text).not.toBe(base);
      const result = parseConfigImport(text, lookup);
      expect(result.ok, text).toBe(false);
      expect(issuesOf(result)[0]).toMatch(/^unknown_field@/);
    }
  });

  it('does not pollute through data of a known type (dropped by its schema)', () => {
    const text = JSON.stringify(validDoc()).replace(
      '"data":{"label":"x"}',
      '"data":{"label":"x","__proto__":{"polluted":true}}',
    );
    const result = parseConfigImport(text, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan.dashboards[0].widgets[0].config).toBe('{"label":"x"}');
    }
  });

  it('does not pollute through data of an unknown type (kept raw as a string)', () => {
    const doc = validDoc();
    doc.dashboards[0].widgets.push(widget(3, 'mystery', {}));
    const text = JSON.stringify(doc).replace(
      '"widgetType":"mystery","grid":{"x":0,"y":3,"w":2,"h":2},"config":{"version":1,"data":{}',
      '"widgetType":"mystery","grid":{"x":0,"y":3,"w":2,"h":2},"config":{"version":1,"data":{"__proto__":{"polluted":true}}',
    );
    const result = parseConfigImport(text, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan.dashboards[0].widgets[2].config).toBe(
        '{"__proto__":{"polluted":true}}',
      );
    }
  });

  it('refuses a __proto__ setting key', () => {
    const text = JSON.stringify(validDoc()).replace(
      '"settings":{',
      '"settings":{"__proto__":{"polluted":true},',
    );
    expect(issuesOf(parseConfigImport(text, lookup))).toEqual([
      'invalid_setting_key@settings.__proto__',
    ]);
  });
});

describe('buildImportPreview', () => {
  function planOf(
    dashboards: readonly { id: string; widgets: readonly { id: string; type: string }[] }[],
    settings = 0,
  ): ParsedConfigImport {
    return {
      plan: {
        dashboards: dashboards.map((d, i) => ({
          id: d.id,
          name: `D${i}`,
          sortOrder: i,
          icon: 'star',
          theme: '{"cardBody":"default","cardHeader":"default"}',
          themeVersion: 1,
          widgets: d.widgets.map((w) => ({
            id: w.id,
            widgetType: w.type,
            grid: { x: 0, y: 0, w: 1, h: 1 },
            config: '{}',
            configVersion: 1,
          })),
        })),
        settings: Array.from({ length: settings }, (_, i) => ({ key: `k${i}`, value: '1' })),
      },
      unknownTypes: ['mystery'],
      futureVersions: 2,
      resetsThemes: true,
      resetsIcons: true,
    };
  }

  it('counts the content of the file as is', () => {
    const preview = buildImportPreview(
      planOf(
        [
          {
            id: DASH,
            widgets: [
              { id: 'w1', type: 'a' },
              { id: 'w2', type: 'b' },
            ],
          },
        ],
        3,
      ),
      {
        dashboards: [{ id: DASH }],
        widgets: [
          { id: 'w1', widgetType: 'a' },
          { id: 'w2', widgetType: 'b' },
        ],
      },
    );
    expect(preview).toEqual({
      dashboards: 1,
      widgets: 2,
      settings: 3,
      unknownTypes: ['mystery'],
      futureVersions: 2,
      resetsThemes: true,
      resetsIcons: true,
      removedDashboards: 0,
      removedWidgets: 0,
      replacedWidgets: 0,
    });
  });

  it('reports the three warnings separately', () => {
    const preview = buildImportPreview(
      planOf([
        {
          id: DASH,
          widgets: [
            { id: 'kept', type: 'a' },
            { id: 'replaced', type: 'new-type' },
            { id: 'created', type: 'a' },
          ],
        },
      ]),
      {
        dashboards: [{ id: DASH }, { id: DASH2 }, { id: 'old-3' }],
        widgets: [
          { id: 'kept', widgetType: 'a' },
          { id: 'replaced', widgetType: 'old-type' },
          { id: 'gone-1', widgetType: 'a' },
          { id: 'gone-2', widgetType: 'b' },
          { id: 'gone-3', widgetType: 'b' },
        ],
      },
    );
    expect(preview.removedDashboards).toBe(2);
    expect(preview.removedWidgets).toBe(3);
    expect(preview.replacedWidgets).toBe(1);
  });

  it('counts the widgets of removed dashboards, except those moved to a kept dashboard', () => {
    const preview = buildImportPreview(
      planOf([{ id: DASH, widgets: [{ id: 'moved', type: 'a' }] }]),
      {
        dashboards: [{ id: DASH }, { id: DASH2 }],
        // 'moved' lived in DASH2 (removed) and survives in DASH: not counted.
        widgets: [
          { id: 'moved', widgetType: 'a' },
          { id: 'lost', widgetType: 'a' },
        ],
      },
    );
    expect(preview.removedDashboards).toBe(1);
    expect(preview.removedWidgets).toBe(1);
    expect(preview.replacedWidgets).toBe(0);
  });

  it('counts a moved instance of a different type as replaced, not removed', () => {
    const preview = buildImportPreview(planOf([{ id: DASH, widgets: [{ id: 'm', type: 'b' }] }]), {
      dashboards: [{ id: DASH }, { id: DASH2 }],
      widgets: [{ id: 'm', widgetType: 'a' }],
    });
    expect(preview.removedWidgets).toBe(0);
    expect(preview.replacedWidgets).toBe(1);
  });
});
