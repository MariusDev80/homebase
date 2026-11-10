import { TestBed } from '@angular/core/testing';
import {
  CLOCK,
  DASHBOARD_REPOSITORY,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
} from '../../data';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeNoteRepository } from '../testing/fake-note.repository';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeShortcutRepository } from '../testing/fake-shortcut.repository';
import { FakeTodoRepository } from '../testing/fake-todo.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { fixtureDefinition } from '../testing/fixture-definitions';
import { ManualClock } from '../time/testing/manual-clock';
import { provideWidget } from '../widgets';
import type { WidgetDefinition } from '../widgets';
import { BackupError, BackupService } from './backup.service';
import type { ImportOutcome } from './backup.types';
import { CONFIG_FORMAT } from './config-transfer';
import { ConfigTransferService } from './config-transfer.service';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

interface BackupDouble {
  isAvailable: ReturnType<typeof vi.fn<() => boolean>>;
  saveConfigFile: ReturnType<typeof vi.fn<(contents: string) => Promise<boolean>>>;
  pickConfigFile: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
  applyConfigImport: ReturnType<typeof vi.fn<(plan: unknown) => Promise<ImportOutcome>>>;
}

describe('ConfigTransferService', () => {
  let backup: BackupDouble;
  let dashboards: FakeDashboardRepository;
  let widgets: FakeWidgetInstanceRepository;
  let settings: FakeSettingsRepository;
  let notes: FakeNoteRepository;
  let todos: FakeTodoRepository;
  let shortcuts: FakeShortcutRepository;
  let service: ConfigTransferService;

  beforeEach(() => {
    backup = {
      isAvailable: vi.fn(() => true),
      saveConfigFile: vi.fn(() => Promise.resolve(true)),
      pickConfigFile: vi.fn(() => Promise.resolve(null)),
      applyConfigImport: vi.fn(() => Promise.resolve({ dashboards: 1, widgets: 1, settings: 0 })),
    };
    dashboards = new FakeDashboardRepository();
    widgets = new FakeWidgetInstanceRepository();
    settings = new FakeSettingsRepository();
    notes = new FakeNoteRepository();
    todos = new FakeTodoRepository(new ManualClock('2026-10-22T08:00:00.000Z'));
    shortcuts = new FakeShortcutRepository();
    TestBed.configureTestingModule({
      providers: [
        { provide: BackupService, useValue: backup },
        { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
        { provide: WIDGET_INSTANCE_REPOSITORY, useValue: widgets },
        { provide: SETTINGS_REPOSITORY, useValue: settings },
        { provide: CLOCK, useValue: new ManualClock('2026-10-22T08:00:00.000Z') },
        provideWidget(fixtureDefinition() as WidgetDefinition),
      ],
    });
    service = TestBed.inject(ConfigTransferService);
  });

  async function seed(): Promise<void> {
    const main = await dashboards.create({ id: uuid(1), name: 'Accueil' });
    const other = await dashboards.create({
      id: uuid(2),
      name: 'Second',
      icon: 'briefcase',
      theme: { cardBody: 'lavender', cardHeader: 'sky' },
      themeVersion: 1,
    });
    widgets.seed({
      id: uuid(11),
      dashboardId: main.id,
      widgetType: 'fixture',
      config: { label: 'a' },
      grid: { x: 0, y: 0, w: 2, h: 2 },
    });
    widgets.seed({
      id: uuid(12),
      dashboardId: other.id,
      widgetType: 'mystery',
      config: { any: 1 },
      configVersion: 4,
    });
    settings.values.set('time.zone', 'Europe/Paris');
    // Possible only through a direct write: the repository itself refuses such keys.
    settings.values.set('github.token', 'ghp_should_never_leave');
    // Data that must never be exported.
    await notes.create({
      widgetInstanceId: uuid(11),
      title: 'SECRET NOTE TITLE',
      body: 'NOTE BODY',
    });
    const list = await todos.createList({ widgetInstanceId: uuid(11), name: 'TODO LIST NAME' });
    await todos.create({ listId: list.id, title: 'TODO TITLE' });
    await shortcuts.create({ label: 'SHORTCUT LABEL', url: 'https://example.com/shortcut' });
  }

  it('reports availability from BackupService', () => {
    expect(service.isAvailable()).toBe(true);
    backup.isAvailable.mockReturnValue(false);
    expect(service.isAvailable()).toBe(false);
  });

  describe('exportToFile', () => {
    it('exports dashboards, widgets and non-secret settings only', async () => {
      await seed();
      await expect(service.exportToFile()).resolves.toBe(true);
      expect(backup.saveConfigFile).toHaveBeenCalledTimes(1);
      const text = backup.saveConfigFile.mock.calls[0][0];
      const doc = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(doc)).toEqual([
        'format',
        'formatVersion',
        'exportedAt',
        'dashboards',
        'settings',
      ]);
      expect(doc['format']).toBe(CONFIG_FORMAT);
      expect(doc['exportedAt']).toBe('2026-10-22T08:00:00.000Z');
      expect(doc['settings']).toEqual({ 'time.zone': 'Europe/Paris' });
      expect(doc['dashboards']).toEqual([
        {
          id: uuid(1),
          name: 'Accueil',
          sortOrder: 0,
          icon: 'th-large',
          theme: { version: 1, data: {} },
          widgets: [
            {
              id: uuid(11),
              widgetType: 'fixture',
              grid: { x: 0, y: 0, w: 2, h: 2 },
              config: { version: 1, data: { label: 'a' } },
            },
          ],
        },
        {
          id: uuid(2),
          name: 'Second',
          sortOrder: 1,
          icon: 'briefcase',
          theme: { version: 1, data: { cardBody: 'lavender', cardHeader: 'sky' } },
          widgets: [
            {
              id: uuid(12),
              widgetType: 'mystery',
              grid: { x: 0, y: 0, w: 3, h: 2 },
              config: { version: 4, data: { any: 1 } },
            },
          ],
        },
      ]);
      for (const leaked of [
        'SECRET NOTE',
        'NOTE BODY',
        'TODO',
        'SHORTCUT',
        'example.com',
        'ghp_',
        'github.token',
      ]) {
        expect(text, leaked).not.toContain(leaked);
      }
      expect(text).toContain('\n  "dashboards"');
    });

    it('exports the icons and never dashboard.last, and the file imports back as is', async () => {
      await seed();
      settings.values.set('dashboard.last', JSON.stringify(uuid(2)));
      await service.exportToFile();
      const text = backup.saveConfigFile.mock.calls[0][0];
      expect(text).not.toContain('dashboard.last');
      const analysis = await service.analyze(text);
      expect(analysis.ok).toBe(true);
      if (analysis.ok) {
        expect(analysis.plan.dashboards.map((d) => [d.id, d.name, d.sortOrder, d.icon])).toEqual([
          [uuid(1), 'Accueil', 0, 'th-large'],
          [uuid(2), 'Second', 1, 'briefcase'],
        ]);
        expect(analysis.plan.dashboards.map((d) => [d.theme, d.themeVersion])).toEqual([
          ['{"cardBody":"default","cardHeader":"default"}', 1],
          ['{"cardBody":"lavender","cardHeader":"sky"}', 1],
        ]);
        expect(analysis.preview.resetsThemes).toBe(false);
        expect(analysis.plan.dashboards[0].widgets[0].grid).toEqual({ x: 0, y: 0, w: 2, h: 2 });
      }
    });

    it('returns false when the dialog is cancelled', async () => {
      await seed();
      backup.saveConfigFile.mockResolvedValue(false);
      await expect(service.exportToFile()).resolves.toBe(false);
    });

    it('refuses an export over 1 MiB without calling Rust', async () => {
      const main = await dashboards.create({ id: uuid(1), name: 'Accueil' });
      for (let i = 0; i < 20; i++) {
        widgets.seed({
          id: uuid(100 + i),
          dashboardId: main.id,
          widgetType: 'mystery',
          config: { blob: 'x'.repeat(60_000) },
        });
      }
      await expect(service.exportToFile()).rejects.toMatchObject({ dto: { kind: 'too_large' } });
      expect(backup.saveConfigFile).not.toHaveBeenCalled();
    });

    it('rejects with unavailable, reading nothing, outside Tauri', async () => {
      backup.isAvailable.mockReturnValue(false);
      const listSpy = vi.spyOn(dashboards, 'list');
      const error: unknown = await service.exportToFile().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BackupError);
      expect((error as BackupError).dto).toEqual({ kind: 'unavailable' });
      expect(listSpy).not.toHaveBeenCalled();
      expect(backup.saveConfigFile).not.toHaveBeenCalled();
    });

    it('propagates the errors of Rust', async () => {
      await seed();
      backup.saveConfigFile.mockRejectedValue(
        new BackupError({ kind: 'io', code: 'bad_extension' }),
      );
      await expect(service.exportToFile()).rejects.toMatchObject({
        dto: { kind: 'io', code: 'bad_extension' },
      });
    });

    it('feeds an import that gives the same data back (export, then analyse)', async () => {
      await seed();
      await service.exportToFile();
      const text = backup.saveConfigFile.mock.calls[0][0];
      const analysis = await service.analyze(text);
      expect(analysis.ok).toBe(true);
      if (analysis.ok) {
        expect(analysis.preview).toMatchObject({
          dashboards: 2,
          widgets: 2,
          settings: 1,
          unknownTypes: ['mystery'],
          futureVersions: 0,
          removedDashboards: 0,
          removedWidgets: 0,
          replacedWidgets: 0,
        });
      }
    });
  });

  describe('import', () => {
    function file(change: (doc: Record<string, unknown>) => void = () => undefined): string {
      const doc: Record<string, unknown> = {
        format: CONFIG_FORMAT,
        formatVersion: 1,
        exportedAt: '2026-10-22T08:00:00.000Z',
        dashboards: [
          {
            id: uuid(1),
            name: 'Accueil',
            sortOrder: 0,
            widgets: [
              {
                id: uuid(11),
                widgetType: 'fixture',
                grid: { x: 0, y: 0, w: 2, h: 2 },
                config: { version: 1, data: { label: 'a' } },
              },
            ],
          },
        ],
        settings: {},
      };
      change(doc);
      return JSON.stringify(doc);
    }

    it('returns null when the file dialog is cancelled', async () => {
      backup.pickConfigFile.mockResolvedValue(null);
      await expect(service.pickAndAnalyze()).resolves.toBeNull();
    });

    it('analyses the picked file against the registry and the current data', async () => {
      await seed();
      backup.pickConfigFile.mockResolvedValue(file());
      const analysis = await service.pickAndAnalyze();
      expect(analysis?.ok).toBe(true);
      if (analysis?.ok) {
        expect(analysis.plan.dashboards[0].widgets[0].config).toBe('{"label":"a"}');
        expect(analysis.preview).toMatchObject({
          removedDashboards: 1,
          removedWidgets: 1,
          replacedWidgets: 0,
        });
      }
    });

    it('reports the type change of an existing instance as a replacement', async () => {
      await seed();
      const text = file((doc) => {
        const dash = (doc['dashboards'] as { widgets: { id: string }[] }[])[0];
        dash.widgets.push({
          id: uuid(12),
          widgetType: 'fixture',
          grid: { x: 0, y: 2, w: 2, h: 2 },
          config: { version: 1, data: { label: 'b' } },
        } as never);
      });
      const analysis = await service.analyze(text);
      expect(analysis.ok && analysis.preview).toMatchObject({
        removedDashboards: 1,
        removedWidgets: 0,
        replacedWidgets: 1,
      });
    });

    it('returns the problems of an invalid file without reading the data', async () => {
      const listSpy = vi.spyOn(dashboards, 'list');
      const analysis = await service.analyze(
        file((doc) => Reflect.deleteProperty(doc, 'settings')),
      );
      expect(analysis).toEqual({
        ok: false,
        issues: [{ code: 'missing_field', path: 'settings' }],
        truncated: false,
      });
      expect(listSpy).not.toHaveBeenCalled();
    });

    it('propagates the errors of the file dialog', async () => {
      backup.pickConfigFile.mockRejectedValue(
        new BackupError({ kind: 'invalid_import', problem: 'not_utf8' }),
      );
      await expect(service.pickAndAnalyze()).rejects.toMatchObject({
        dto: { kind: 'invalid_import', problem: 'not_utf8' },
      });
    });

    it('applies the plan through BackupService', async () => {
      const analysis = await service.analyze(file());
      if (!analysis.ok) throw new Error('expected a valid file');
      await expect(service.apply(analysis.plan)).resolves.toEqual({
        dashboards: 1,
        widgets: 1,
        settings: 0,
      });
      expect(backup.applyConfigImport).toHaveBeenCalledWith(analysis.plan);
    });

    it('propagates apply errors', async () => {
      backup.applyConfigImport.mockRejectedValue(new BackupError({ kind: 'busy' }));
      await expect(service.apply({ dashboards: [], settings: [] })).rejects.toMatchObject({
        dto: { kind: 'busy' },
      });
    });
  });
});
