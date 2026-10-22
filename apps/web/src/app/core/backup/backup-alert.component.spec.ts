import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAppI18n } from '../i18n';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER } from '../time';
import { SETTINGS_REPOSITORY } from '../../data';
import { BackupAlertComponent } from './backup-alert.component';
import { BackupService } from './backup.service';
import type { BackupOverview, BackupStatus } from './backup.types';

const base: BackupStatus = {
  lastRestore: null,
  dbMissingAlert: false,
  preMigrationFailed: false,
  lastAutoError: null,
  rawSafetyCopies: [],
};

async function setup(available: boolean, status: Partial<BackupStatus>) {
  const overview: BackupOverview = {
    backups: [
      {
        id: 'a.zip',
        kind: 'daily',
        createdAt: '2026-10-20T10:00:00.000Z',
        sizeBytes: 1,
        includesImages: true,
        schemaVersion: 4,
        appVersion: '0.1.0',
        imageCount: 0,
        damaged: false,
      },
    ],
    status: { ...base, ...status },
    supportedSchemaVersion: 4,
  };
  const backup = {
    isAvailable: vi.fn().mockReturnValue(available),
    overview: vi.fn().mockResolvedValue(overview),
    acknowledge: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      provideRouter([]),
      { provide: BackupService, useValue: backup },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(BackupAlertComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  fixture.detectChanges();
  await settle();
  const text = (id: string): string => el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
  return { backup, el, text, settle };
}

describe('BackupAlertComponent', () => {
  it('shows nothing and calls nothing outside Tauri', async () => {
    const { backup, el } = await setup(false, { dbMissingAlert: true });
    expect(el.querySelector('[data-testid="backup-alert"]')).toBeNull();
    expect(backup.overview).not.toHaveBeenCalled();
  });

  it('shows nothing when there is nothing to report', async () => {
    const { el } = await setup(true, {});
    expect(el.querySelector('[data-testid="backup-alert"]')).toBeNull();
  });

  it.each([
    [
      {
        outcome: 'applied',
        at: '2026-10-22T09:00:00.000Z',
        backupCreatedAt: '2026-10-20T10:00:00.000Z',
        backupKind: 'daily',
      },
      'Restauration effectuée (sauvegarde du 20 oct. 2026',
    ],
    [
      {
        outcome: 'rolled-back',
        at: '2026-10-22T09:00:00.000Z',
        backupCreatedAt: null,
        backupKind: null,
      },
      "l'état précédent a été rétabli",
    ],
    [
      {
        outcome: 'failed',
        at: '2026-10-22T09:00:00.000Z',
        backupCreatedAt: null,
        backupKind: null,
      },
      'La restauration a échoué',
    ],
  ] as const)('shows the restoration outcome %#', async (lastRestore, expected) => {
    const { text } = await setup(true, { lastRestore });
    expect(text('alert-restore')).toContain(expected);
  });

  it('shows the missing database alert with the date of the newest backup and a link', async () => {
    const { text, el } = await setup(true, { dbMissingAlert: true });
    expect(text('alert-db-missing')).toContain('la plus récente : 20 oct. 2026');
    const link = el.querySelector('[data-testid="alert-db-missing"] a');
    expect(link?.getAttribute('href')).toBe('/settings#backups');
  });

  it('shows the failed pre-migration backup', async () => {
    const { text } = await setup(true, { preMigrationFailed: true });
    expect(text('alert-pre-migration')).toContain('avant mise à jour a échoué');
  });

  it('mentions the raw copy of the old database after an applied restoration only', async () => {
    const raw = ['homebase-20261021T081500.123Z-pre-restore-raw'];
    const applied = {
      outcome: 'applied',
      at: '2026-10-22T09:00:00.000Z',
      backupCreatedAt: null,
      backupKind: null,
    } as const;
    const withCopy = await setup(true, { lastRestore: applied, rawSafetyCopies: raw });
    expect(withCopy.text('alert-raw-copy')).toContain("copie brute de l'ancienne base");
    TestBed.resetTestingModule();
    const without = await setup(true, { lastRestore: applied });
    expect(without.el.querySelector('[data-testid="alert-raw-copy"]')).toBeNull();
    TestBed.resetTestingModule();
    const failed = await setup(true, {
      lastRestore: { ...applied, outcome: 'failed' },
      rawSafetyCopies: raw,
    });
    expect(failed.el.querySelector('[data-testid="alert-raw-copy"]')).toBeNull();
  });

  it('acknowledges on "Ignorer" and hides the banner', async () => {
    const { backup, el, settle } = await setup(true, { preMigrationFailed: true });
    el.querySelector<HTMLButtonElement>('[data-testid="alert-dismiss"]')?.click();
    await settle();
    expect(backup.acknowledge).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="backup-alert"]')).toBeNull();
  });

  it('keeps the banner and tells when the acknowledgement fails', async () => {
    const { backup, el, text, settle } = await setup(true, { preMigrationFailed: true });
    backup.acknowledge.mockRejectedValue('boom');
    el.querySelector<HTMLButtonElement>('[data-testid="alert-dismiss"]')?.click();
    await settle();
    expect(text('alert-dismiss-error')).toContain("Impossible d'ignorer");
    expect(el.querySelector('[data-testid="backup-alert"]')).not.toBeNull();
  });
});
