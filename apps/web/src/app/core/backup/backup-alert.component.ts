import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TimeDisplay, TimeError } from '../time';
import { BackupStatusStore } from './backup-status.store';

/**
 * Global banner (above the page content): outcome of the last restoration, "database missing"
 * alert, failed pre-migration backup. One dismissal acknowledges all of them (a single Rust
 * command deletes the three markers). Shows nothing outside Tauri.
 */
@Component({
  selector: 'app-backup-alert',
  imports: [TranslocoPipe, RouterLink],
  template: `
    <!-- Permanent live region: only its content changes, so that the change is announced. -->
    <div role="status" data-testid="backup-alert-region">
      @if (visible()) {
        <div class="mb-4 flex flex-col items-start gap-2" data-testid="backup-alert">
          @if (restore(); as report) {
            <p
              class="flash"
              [class.flash-danger]="report.outcome === 'failed'"
              [class.flash-attention]="report.outcome === 'rolled-back'"
              data-testid="alert-restore"
            >
              <i class="pi pi-history" aria-hidden="true"></i>
              {{ restoreText() }}
            </p>
          }
          @if (dbMissing()) {
            <p class="flash flash-danger" data-testid="alert-db-missing">
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              <span>
                {{ dbMissingText() }}
                <a routerLink="/settings" fragment="backups" class="font-semibold underline">{{
                  'backup.alert.seeBackups' | transloco
                }}</a>
              </span>
            </p>
          }
          @if (preMigrationFailed()) {
            <p class="flash flash-attention" data-testid="alert-pre-migration">
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              {{ 'backup.alert.preMigrationFailed' | transloco }}
            </p>
          }
          <button
            type="button"
            class="btn btn-compact"
            data-testid="alert-dismiss"
            (click)="dismiss()"
          >
            {{ 'backup.alert.dismiss' | transloco }}
          </button>
          @if (dismissFailed()) {
            <p role="alert" class="flash flash-danger" data-testid="alert-dismiss-error">
              {{ 'backup.alert.dismissError' | transloco }}
            </p>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupAlertComponent implements OnInit {
  private readonly store = inject(BackupStatusStore);
  private readonly transloco = inject(TranslocoService);
  private readonly display = inject(TimeDisplay);

  protected readonly dismissFailed = signal(false);

  protected readonly restore = computed(() => this.store.status()?.lastRestore ?? null);
  protected readonly dbMissing = computed(() => this.store.status()?.dbMissingAlert === true);
  protected readonly preMigrationFailed = computed(
    () => this.store.status()?.preMigrationFailed === true,
  );
  protected readonly visible = computed(
    () => this.restore() !== null || this.dbMissing() || this.preMigrationFailed(),
  );

  protected readonly restoreText = computed(() => {
    const report = this.restore();
    if (report === null) return '';
    if (report.outcome !== 'applied') {
      return this.transloco.translate(`backup.alert.restore.${report.outcome}`);
    }
    const date = report.backupCreatedAt === null ? null : this.formatDate(report.backupCreatedAt);
    return date === null
      ? this.transloco.translate('backup.alert.restore.appliedNoDate')
      : this.transloco.translate('backup.alert.restore.applied', { date });
  });

  protected readonly dbMissingText = computed(() => {
    const newest = this.store.backups().find((b) => !b.damaged);
    const date = newest === undefined ? null : this.formatDate(newest.createdAt);
    return date === null
      ? this.transloco.translate('backup.alert.dbMissingNoDate')
      : this.transloco.translate('backup.alert.dbMissing', { date });
  });

  ngOnInit(): void {
    // Single load; outside Tauri the store calls nothing.
    void this.store.load();
  }

  protected async dismiss(): Promise<void> {
    this.dismissFailed.set(false);
    try {
      await this.store.acknowledge();
    } catch {
      this.dismissFailed.set(true);
    }
  }

  private formatDate(iso: string): string | null {
    try {
      return this.display.formatInstant(iso, 'date-time');
    } catch (cause) {
      if (cause instanceof TimeError) return null;
      throw cause;
    }
  }
}
