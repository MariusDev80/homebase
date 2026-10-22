import { Injectable, computed, inject, signal } from '@angular/core';
import { AppLock } from '../lock';
import { BackupError, BackupService, toBackupError } from './backup.service';
import type { BackupInfo, BackupOverview, BackupStatus } from './backup.types';

export type ExclusiveOperation = 'restore' | 'import';

/**
 * Last known overview of the backups (list + status). One source for the Settings card and the
 * global banner. Outside Tauri it never calls the commands.
 */
@Injectable({ providedIn: 'root' })
export class BackupStatusStore {
  private readonly backup = inject(BackupService);

  private readonly overviewState = signal<BackupOverview | null>(null);
  private readonly errorState = signal<BackupError | null>(null);
  private readonly loadingState = signal(false);
  private loaded: Promise<void> | null = null;
  private sequence = 0;

  readonly overview = this.overviewState.asReadonly();
  readonly status = computed<BackupStatus | null>(() => this.overviewState()?.status ?? null);
  readonly backups = computed<readonly BackupInfo[]>(() => this.overviewState()?.backups ?? []);
  /** Error of the last load or refresh (null when it worked). */
  readonly error = this.errorState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  private readonly appLock = inject(AppLock);
  /**
   * Operation that replaces the data (restoration, import). The freeze itself (inert layout,
   * overlay, refused navigation) is the `AppLock` service; this store only exposes it to the cards.
   */
  readonly exclusive = this.appLock.locked;

  lock(operation: ExclusiveOperation): void {
    this.appLock.lock(operation);
  }

  setStatus(key: string | null): void {
    this.appLock.setStatus(key);
  }

  unlock(): void {
    this.appLock.unlock();
  }

  isAvailable(): boolean {
    return this.backup.isAvailable();
  }

  /** First call loads; the next ones return the same promise (single load). */
  load(): Promise<void> {
    this.loaded ??= this.refresh();
    return this.loaded;
  }

  /** Reads the overview again. Never rejects: the failure is in `error`. */
  async refresh(): Promise<void> {
    if (!this.backup.isAvailable()) return;
    // A slow, older response must not overwrite a more recent one.
    const mine = ++this.sequence;
    this.loadingState.set(true);
    try {
      const overview = await this.backup.overview();
      if (mine !== this.sequence) return;
      this.overviewState.set(overview);
      this.errorState.set(null);
    } catch (error) {
      if (mine === this.sequence) this.errorState.set(toBackupError(error));
    } finally {
      if (mine === this.sequence) this.loadingState.set(false);
    }
  }

  /**
   * Deletes the restoration report, the "missing database" alert and the pre-migration marker
   * (one command for all three) and clears them locally. Rejects with a BackupError.
   */
  async acknowledge(): Promise<void> {
    try {
      await this.backup.acknowledge();
    } catch (error) {
      throw toBackupError(error);
    }
    this.overviewState.update((overview) =>
      overview === null
        ? null
        : {
            ...overview,
            status: {
              ...overview.status,
              lastRestore: null,
              dbMissingAlert: false,
              preMigrationFailed: false,
            },
          },
    );
  }
}
