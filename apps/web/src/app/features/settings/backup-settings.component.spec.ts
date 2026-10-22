import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { BackupError, BackupService } from '../../core/backup';
import { AppLock } from '../../core/lock';
import { PendingWrites } from '../../core/widgets';
import type { ArchiveSummary, BackupInfo, BackupOverview } from '../../core/backup';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { CLOCK, SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { SETTINGS_REPOSITORY } from '../../data';
import { BackupSettingsComponent } from './backup-settings.component';

const info = (over: Partial<BackupInfo> = {}): BackupInfo => ({
  id: 'homebase-20261022T100000.000Z-manual.zip',
  kind: 'manual',
  createdAt: '2026-10-22T10:00:00.000Z',
  sizeBytes: 2048,
  includesImages: true,
  schemaVersion: 4,
  appVersion: '0.1.0',
  imageCount: 3,
  damaged: false,
  ...over,
});

const overviewOf = (
  backups: BackupInfo[],
  status: Partial<BackupOverview['status']> = {},
): BackupOverview => ({
  backups,
  status: {
    lastRestore: null,
    dbMissingAlert: false,
    preMigrationFailed: false,
    lastAutoError: null,
    ...status,
  },
  supportedSchemaVersion: 4,
});

const summary: ArchiveSummary = {
  kind: 'daily',
  createdAt: '2026-10-21T10:00:00.000Z',
  sizeBytes: 10,
  includesImages: false,
  schemaVersion: 4,
  appVersion: '0.1.0',
  imageCount: 0,
  token: 'ab'.repeat(32),
};

function fakeBackup(available: boolean, overview: BackupOverview) {
  return {
    isAvailable: vi.fn().mockReturnValue(available),
    overview: vi.fn().mockResolvedValue(overview),
    create: vi.fn().mockResolvedValue(info()),
    openFolder: vi.fn().mockResolvedValue(undefined),
    exportArchive: vi.fn().mockResolvedValue(true),
    pickExternal: vi.fn().mockResolvedValue(summary),
    restore: vi.fn().mockResolvedValue(undefined),
    acknowledge: vi.fn().mockResolvedValue(undefined),
  };
}

async function setup(
  available: boolean,
  overview: BackupOverview,
  firstLoad?: Promise<BackupOverview>,
) {
  const backup = fakeBackup(available, overview);
  if (firstLoad) backup.overview.mockReturnValueOnce(firstLoad);
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: BackupService, useValue: backup },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
      { provide: CLOCK, useValue: new ManualClock('2026-10-22T12:00:00.000Z') },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(BackupSettingsComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  fixture.detectChanges();
  if (!firstLoad) await settle();
  const q = (id: string): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  return { backup, fixture, el, q, settle };
}

const inBody = <T extends HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`);

async function dialogPart<T extends HTMLElement>(
  fixture: { detectChanges(): void },
  id: string,
): Promise<T> {
  let found: T | null = null;
  await vi.waitFor(() => {
    fixture.detectChanges();
    found = inBody<T>(id);
    expect(found).not.toBeNull();
  });
  return found as unknown as T;
}

async function acknowledge(fixture: { detectChanges(): void }): Promise<HTMLButtonElement> {
  const box = await dialogPart<HTMLInputElement>(fixture, 'restore-acknowledge');
  box.click();
  fixture.detectChanges();
  return await dialogPart<HTMLButtonElement>(fixture, 'restore-confirm');
}

describe('BackupSettingsComponent', () => {
  it('outside Tauri shows the unavailable message and calls nothing', async () => {
    const { backup, el, q } = await setup(false, overviewOf([]));
    expect(el.querySelector('[data-testid="backup-unavailable"]')?.textContent).toContain(
      "Disponible uniquement dans l'application Windows.",
    );
    expect(q('backup-create')).toBeNull();
    expect(backup.overview).not.toHaveBeenCalled();
  });

  it('lists backups with relative date, labels and size; damaged ones are not restorable', async () => {
    const { el, q } = await setup(
      true,
      overviewOf([
        info(),
        info({
          id: 'b.zip',
          kind: 'daily',
          includesImages: false,
          createdAt: '2026-10-20T10:00:00.000Z',
        }),
        info({ id: 'c.zip', damaged: true, includesImages: null, schemaVersion: null }),
        info({ id: 'd.zip', schemaVersion: 9 }),
      ]),
    );
    const rows = Array.from(el.querySelectorAll('[data-testid="backup-row"]'));
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('il y a 2 heures');
    expect(rows[0].textContent).toContain('Manuelle');
    expect(rows[0].textContent?.replaceAll(/\s/g, ' ')).toContain('2 Kio');
    expect(rows[1].textContent).toContain('Base seulement');
    expect(rows[1].textContent).toContain('il y a 2 jours');
    expect(rows[2].textContent).toContain('Endommagée');
    expect(rows[3].textContent).toContain('Version plus récente');
    const restores = Array.from(
      el.querySelectorAll<HTMLButtonElement>('[data-testid="backup-restore"]'),
    );
    expect(restores.map((b) => b.disabled)).toEqual([false, false, true, true]);
    expect(restores[0].getAttribute('aria-label')).toContain('Restaurer la sauvegarde du');
    expect(el.querySelector('[data-testid="backup-last"]')?.textContent).toContain(
      'il y a 2 heures',
    );
    expect(q('backup-create')?.disabled).toBe(false);
  });

  it('shows the empty state and the automatic backup error', async () => {
    const { el } = await setup(true, overviewOf([], { lastAutoError: { kind: 'disk_full' } }));
    expect(el.querySelector('[data-testid="backup-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="backup-auto-error"]')?.textContent).toContain(
      'Espace disque insuffisant.',
    );
  });

  it('creates a backup, refreshes and disables the buttons meanwhile', async () => {
    const { backup, q, settle, el, fixture } = await setup(true, overviewOf([]));
    let release!: () => void;
    backup.create.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    q('backup-create')?.click();
    await settle();
    expect(q('backup-create')?.disabled).toBe(true);
    expect(q('backup-open-folder')?.disabled).toBe(true);
    release();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="backup-success"]')?.textContent).toContain(
        'Sauvegarde créée.',
      );
    });
    expect(backup.overview).toHaveBeenCalledTimes(2);
    expect(q('backup-create')?.disabled).toBe(false);
  });

  it('says nothing when the export is cancelled', async () => {
    const { backup, el, settle } = await setup(true, overviewOf([info()]));
    backup.exportArchive.mockResolvedValue(false);
    el.querySelector<HTMLButtonElement>('[data-testid="backup-export"]')?.click();
    await settle();
    expect(backup.exportArchive).toHaveBeenCalledWith(info().id);
    expect(el.querySelector('[data-testid="backup-success"]')).toBeNull();
    expect(el.querySelector('[data-testid="backup-error"]')).toBeNull();
  });

  it.each([
    [new BackupError({ kind: 'busy' }), 'Une autre opération de sauvegarde est en cours.'],
    [
      new BackupError({ kind: 'restart_pending' }),
      'Homebase redémarre pour terminer une restauration.',
    ],
    [
      new BackupError({ kind: 'io', code: 'destination_in_data_root' }),
      'Choisissez un emplacement en dehors du dossier de données de Homebase.',
    ],
    ['raw secret text from nowhere', "L'opération a échoué."],
  ])('translates the error %#', async (failure, expected) => {
    const { backup, q, settle, el } = await setup(true, overviewOf([]));
    backup.create.mockRejectedValue(failure);
    q('backup-create')?.click();
    await settle();
    const text = el.querySelector('[data-testid="backup-error"]')?.textContent ?? '';
    expect(text).toContain(expected);
    expect(text).not.toContain('raw secret');
  });

  it('translates an invalid_archive problem when picking a file', async () => {
    const { backup, q, settle, el } = await setup(true, overviewOf([]));
    backup.pickExternal.mockRejectedValue(
      new BackupError({ kind: 'invalid_archive', problem: 'not_zip' }),
    );
    q('backup-restore-file')?.click();
    await settle();
    expect(el.querySelector('[data-testid="backup-error"]')?.textContent).toContain(
      "Ce fichier n'est pas une sauvegarde Homebase valide : ce n'est pas une archive zip.",
    );
  });

  it('restores an internal backup: mandatory box, focus on Annuler, flush first', async () => {
    const { backup, fixture, el, settle } = await setup(true, overviewOf([info()]));
    const order: string[] = [];
    TestBed.inject(PendingWrites).register(async () => {
      order.push('flush');
    });
    backup.restore.mockImplementation(async () => {
      order.push('restore');
      throw new BackupError({ kind: 'restart_pending' });
    });
    el.querySelector<HTMLButtonElement>('[data-testid="backup-restore"]')?.click();
    const cancel = await dialogPart<HTMLButtonElement>(fixture, 'restore-cancel');
    await vi.waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(inBody('restore-summary')?.textContent).toContain('Manuelle');
    expect(document.body.textContent).toContain('Homebase redémarre immédiatement');
    const confirm = await dialogPart<HTMLButtonElement>(fixture, 'restore-confirm');
    expect(confirm.classList.contains('btn-danger')).toBe(true);
    expect(confirm.disabled).toBe(true);
    expect(backup.restore).not.toHaveBeenCalled();
    (await acknowledge(fixture)).click();
    await vi.waitFor(() =>
      expect(backup.restore).toHaveBeenCalledWith({ kind: 'internal', id: info().id }),
    );
    expect(order).toEqual(['flush', 'restore']);
    await settle();
    // restart_pending keeps the "restarting" state; the global lock stays on.
    expect(inBody('restore-progress')?.textContent).toContain('Redémarrage de Homebase…');
    expect(TestBed.inject(AppLock).locked()).toBe('restore');
    expect(inBody<HTMLButtonElement>('restore-confirm')?.disabled).toBe(true);
    expect(inBody<HTMLButtonElement>('restore-cancel')?.disabled).toBe(true);
  });

  it('shows the progress then the restart text, and ignores Escape meanwhile', async () => {
    const { backup, fixture, el, settle } = await setup(true, overviewOf([info()]));
    let release!: () => void;
    backup.restore.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    el.querySelector<HTMLButtonElement>('[data-testid="backup-restore"]')?.click();
    (await acknowledge(fixture)).click();
    await vi.waitFor(() => expect(backup.restore).toHaveBeenCalled());
    await settle();
    expect(inBody('restore-progress')?.textContent).toContain('Restauration en cours…');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(inBody('restore-confirm')).not.toBeNull();
    release();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(inBody('restore-progress')?.textContent).toContain('Redémarrage de Homebase…');
    });
  });

  it('closes on Escape at rest, gives the focus back and does not restore', async () => {
    const { backup, fixture, el } = await setup(true, overviewOf([info()]));
    const button = el.querySelector<HTMLButtonElement>('[data-testid="backup-restore"]');
    button?.click();
    await dialogPart(fixture, 'restore-cancel');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(inBody('restore-cancel')).toBeNull();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
    expect(backup.restore).not.toHaveBeenCalled();
  });

  it('does not call restore when the confirmation is cancelled, and gives the focus back', async () => {
    const { backup, fixture, el } = await setup(true, overviewOf([info()]));
    const button = el.querySelector<HTMLButtonElement>('[data-testid="backup-restore"]');
    button?.click();
    (await dialogPart<HTMLButtonElement>(fixture, 'restore-cancel')).click();
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
    expect(backup.restore).not.toHaveBeenCalled();
  });

  it('restores an external archive with the token of the displayed summary', async () => {
    const { backup, fixture, q } = await setup(true, overviewOf([]));
    q('backup-restore-file')?.click();
    await dialogPart(fixture, 'restore-cancel');
    const summaryText = inBody('restore-summary')?.textContent ?? '';
    expect(summaryText).toContain('Quotidienne');
    expect(summaryText).toContain('0.1.0');
    expect(summaryText).toContain('Base seulement');
    (await acknowledge(fixture)).click();
    await vi.waitFor(() =>
      expect(backup.restore).toHaveBeenCalledWith({ kind: 'external', token: summary.token }),
    );
  });

  it('does nothing when the file picker is cancelled', async () => {
    const { backup, q, settle } = await setup(true, overviewOf([]));
    backup.pickExternal.mockResolvedValue(null);
    q('backup-restore-file')?.click();
    await settle();
    expect(backup.restore).not.toHaveBeenCalled();
    expect(inBody('restore-cancel')).toBeNull();
  });

  it('unblocks the page, shows a translated error and unchecks the box when it fails', async () => {
    const { backup, fixture, el, settle } = await setup(true, overviewOf([info()]));
    backup.restore.mockRejectedValue(new BackupError({ kind: 'io', code: 'token_mismatch' }));
    el.querySelector<HTMLButtonElement>('[data-testid="backup-restore"]')?.click();
    (await acknowledge(fixture)).click();
    await vi.waitFor(() => expect(backup.restore).toHaveBeenCalled());
    await settle();
    expect(TestBed.inject(AppLock).locked()).toBeNull();
    expect(inBody('restore-error')?.textContent).toContain(
      'Le fichier a changé depuis sa sélection',
    );
    expect(inBody<HTMLInputElement>('restore-acknowledge')?.checked).toBe(false);
    expect(inBody<HTMLButtonElement>('restore-confirm')?.disabled).toBe(true);
    expect(inBody<HTMLButtonElement>('restore-cancel')?.disabled).toBe(false);
  });

  it('shows a loading state, neither the empty state nor "no backup", during the first load', async () => {
    let release!: (overview: BackupOverview) => void;
    const pending = new Promise<BackupOverview>((resolve) => (release = resolve));
    const { backup, fixture, el } = await setup(true, overviewOf([]), pending);
    expect(backup.overview).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="backup-loading"]')?.textContent).toContain(
      'Chargement des sauvegardes',
    );
    expect(el.querySelector('[data-testid="backup-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="backup-last"]')).toBeNull();
    release(overviewOf([]));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="backup-empty"]')).not.toBeNull();
    });
    expect(el.querySelector('[data-testid="backup-loading"]')).toBeNull();
  });
});
