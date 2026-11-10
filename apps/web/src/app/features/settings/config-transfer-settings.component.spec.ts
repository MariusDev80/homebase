import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BackupError, BackupService, ConfigTransferService, RELOAD_PAGE } from '../../core/backup';
import type { ConfigImportAnalysis, ImportPreview } from '../../core/backup';
import { provideAppI18n } from '../../core/i18n';
import { AppLock, appUnlockedGuard } from '../../core/lock';
import { PendingWrites } from '../../core/widgets';
import { ConfigTransferSettingsComponent } from './config-transfer-settings.component';

const plan = { dashboards: [], settings: [] };
const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  dashboards: 2,
  widgets: 5,
  settings: 1,
  unknownTypes: [],
  futureVersions: 0,
  resetsThemes: false,
  removedDashboards: 1,
  removedWidgets: 3,
  replacedWidgets: 2,
  ...over,
});
const ok = (over: Partial<ImportPreview> = {}): ConfigImportAnalysis => ({
  ok: true,
  plan,
  preview: preview(over),
});

async function setup(available = true) {
  const transfer = {
    isAvailable: vi.fn().mockReturnValue(available),
    exportToFile: vi.fn().mockResolvedValue(true),
    pickAndAnalyze: vi.fn().mockResolvedValue(ok()),
    apply: vi.fn().mockResolvedValue({ dashboards: 2, widgets: 5, settings: 1 }),
  };
  const reload = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: ConfigTransferService, useValue: transfer },
      { provide: BackupService, useValue: { isAvailable: () => available } },
      { provide: RELOAD_PAGE, useValue: reload },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(ConfigTransferSettingsComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  fixture.detectChanges();
  await settle();
  const q = (id: string): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const text = (id: string): string => el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
  return { transfer, reload, el, q, text, settle };
}

describe('ConfigTransferSettingsComponent', () => {
  it('outside Tauri shows the unavailable message without any button', async () => {
    const { q, text, transfer } = await setup(false);
    expect(text('config-unavailable')).toContain(
      "Disponible uniquement dans l'application Windows.",
    );
    expect(q('config-import')).toBeNull();
    expect(transfer.pickAndAnalyze).not.toHaveBeenCalled();
  });

  it('exports the configuration, and says nothing when the dialog is cancelled', async () => {
    const { q, text, transfer, settle, el } = await setup();
    q('config-export')?.click();
    await settle();
    expect(text('config-exported')).toContain('Configuration exportée.');
    transfer.exportToFile.mockResolvedValue(false);
    q('config-export')?.click();
    await settle();
    expect(el.querySelector('[data-testid="config-exported"]')).toBeNull();
    expect(el.querySelector('[data-testid="config-error"]')).toBeNull();
  });

  it('shows a translated error when the export fails', async () => {
    const { q, text, transfer, settle } = await setup();
    transfer.exportToFile.mockRejectedValue(new BackupError({ kind: 'too_large' }));
    q('config-export')?.click();
    await settle();
    expect(text('config-error')).toContain('Fichier trop volumineux.');
  });

  it('previews the three distinct warnings with their counts', async () => {
    const { q, text, settle } = await setup();
    q('config-import')?.click();
    await settle();
    expect(text('config-preview')).toContain(
      'Le fichier contient 2 tableau(x) de bord, 5 widget(s) et 1 réglage(s).',
    );
    expect(text('warn-removed-dashboards')).toContain('1 tableau(x) de bord actuel(s)');
    expect(text('warn-removed-widgets')).toContain('3 widget(s) actuel(s)');
    expect(text('warn-removed-widgets')).toContain('notes, tâches');
    expect(text('warn-replaced-widgets')).toContain('2 widget(s) changent de type');
    expect(text('config-preview')).toContain('sauvegarde de sécurité');
  });

  it('shows the themes-reset line only when the file predates themes', async () => {
    const { q, settle, el } = await setup();
    q('config-import')?.click();
    await settle();
    expect(el.querySelector('[data-testid="info-themes-reset"]')).toBeNull();
    q('config-cancel')?.click();
    await settle();
  });

  it('announces that themes will be reset for a format 1 or 2 file', async () => {
    const { q, text, transfer, settle } = await setup();
    transfer.pickAndAnalyze.mockResolvedValue(ok({ resetsThemes: true }));
    q('config-import')?.click();
    await settle();
    expect(text('info-themes-reset')).toContain('les thèmes des tableaux seront remis par défaut');
  });

  it('lists the validation problems, signals truncation, and offers no confirmation', async () => {
    const { q, text, transfer, settle, el } = await setup();
    transfer.pickAndAnalyze.mockResolvedValue({
      ok: false,
      issues: [
        { code: 'secret_setting', path: 'settings[0]' },
        { code: 'invalid_json', path: '' },
      ],
      truncated: true,
    });
    q('config-import')?.click();
    await settle();
    const issues = Array.from(el.querySelectorAll('[data-testid="config-issue"]')).map(
      (li) => li.textContent,
    );
    expect(issues).toEqual(['réglage secret interdit. (settings[0])', 'JSON invalide.']);
    expect(text('config-truncated')).toContain('ne sont pas affichés');
    expect(q('config-confirm')).toBeNull();
  });

  it('does nothing when the file dialog is cancelled', async () => {
    const { q, transfer, settle, el } = await setup();
    transfer.pickAndAnalyze.mockResolvedValue(null);
    q('config-import')?.click();
    await settle();
    expect(el.querySelector('[data-testid="config-preview"]')).toBeNull();
    expect(transfer.apply).not.toHaveBeenCalled();
  });

  it('flushes deferred writes before apply, then reloads the page', async () => {
    const { q, transfer, reload, settle } = await setup();
    const order: string[] = [];
    TestBed.inject(PendingWrites).register(async () => {
      order.push('flush');
    });
    transfer.apply.mockImplementation(async () => {
      order.push('apply');
      return { dashboards: 1, widgets: 1, settings: 0 };
    });
    reload.mockImplementation(() => order.push('reload'));
    q('config-import')?.click();
    await settle();
    q('config-confirm')?.click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['flush', 'apply', 'reload']);
    expect(transfer.apply).toHaveBeenCalledWith(plan);
  });

  it('waits for a slow flush before applying, with the application locked meanwhile', async () => {
    const { q, transfer, reload, settle } = await setup();
    let release!: () => void;
    TestBed.inject(PendingWrites).register(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    q('config-import')?.click();
    await settle();
    q('config-confirm')?.click();
    await settle();
    expect(TestBed.inject(AppLock).locked()).toBe('import');
    expect(
      TestBed.runInInjectionContext(() =>
        appUnlockedGuard(null, null as never, null as never, null as never),
      ),
    ).toBe(false);
    expect(transfer.apply).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(transfer.apply).toHaveBeenCalledTimes(1);
  });

  it('never reloads when apply fails, and unblocks the page', async () => {
    const { q, text, transfer, reload, settle } = await setup();
    transfer.apply.mockRejectedValue(new BackupError({ kind: 'busy' }));
    q('config-import')?.click();
    await settle();
    q('config-confirm')?.click();
    await settle();
    await vi.waitFor(() => expect(text('config-error')).toContain('Une autre opération'));
    expect(reload).not.toHaveBeenCalled();
    expect(q('config-cancel')?.disabled).toBe(false);
  });

  it('cancel closes the preview without applying', async () => {
    const { q, transfer, settle, el } = await setup();
    q('config-import')?.click();
    await settle();
    q('config-cancel')?.click();
    await settle();
    expect(el.querySelector('[data-testid="config-preview"]')).toBeNull();
    expect(transfer.apply).not.toHaveBeenCalled();
  });
});
