import { TestBed } from '@angular/core/testing';
import { BackupStatusStore } from './backup-status.store';
import { BackupError, BackupService } from './backup.service';
import type { BackupOverview } from './backup.types';

const overview: BackupOverview = {
  backups: [],
  status: {
    lastRestore: null,
    dbMissingAlert: true,
    preMigrationFailed: true,
    lastAutoError: null,
    rawSafetyCopies: [],
  },
  supportedSchemaVersion: 4,
};

function setup(available = true) {
  const backup = {
    isAvailable: vi.fn().mockReturnValue(available),
    overview: vi.fn().mockResolvedValue(overview),
    acknowledge: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({ providers: [{ provide: BackupService, useValue: backup }] });
  return { backup, store: TestBed.inject(BackupStatusStore) };
}

describe('BackupStatusStore', () => {
  it('loads once', async () => {
    const { backup, store } = setup();
    await Promise.all([store.load(), store.load()]);
    await store.load();
    expect(backup.overview).toHaveBeenCalledTimes(1);
    expect(store.status()?.dbMissingAlert).toBe(true);
  });

  it('calls nothing outside Tauri', async () => {
    const { backup, store } = setup(false);
    await store.load();
    expect(backup.overview).not.toHaveBeenCalled();
    expect(store.status()).toBeNull();
  });

  it('keeps a translated-ready error when the load fails', async () => {
    const { backup, store } = setup();
    backup.overview.mockRejectedValue(new BackupError({ kind: 'busy' }));
    await store.refresh();
    expect(store.error()?.kind).toBe('busy');
  });

  it('clears the three markers locally after acknowledge, and rejects on failure', async () => {
    const { backup, store } = setup();
    await store.load();
    await store.acknowledge();
    expect(store.status()).toMatchObject({ dbMissingAlert: false, preMigrationFailed: false });
    backup.acknowledge.mockRejectedValue('raw');
    await expect(store.acknowledge()).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('locks and unlocks the exclusive operation', () => {
    const { store } = setup();
    store.lock('restore');
    expect(store.exclusive()).toBe('restore');
    store.unlock();
    expect(store.exclusive()).toBeNull();
  });
});
