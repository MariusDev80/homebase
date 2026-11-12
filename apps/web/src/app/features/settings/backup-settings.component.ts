import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Dialog } from 'primeng/dialog';
import {
  BackupService,
  BackupStatusStore,
  backupErrorText,
  formatBytes,
  rawSafetyCopyInstant,
  toBackupError,
} from '../../core/backup';
import type { BackupErrorDto, BackupInfo, RestoreSource } from '../../core/backup';
import { CLOCK, TimeDisplay, TimeError } from '../../core/time';
import { PendingWrites } from '../../core/widgets';

type Operation = 'create' | 'folder' | 'export' | 'pick';
type RestorePhase = 'idle' | 'running' | 'restarting';

/** Refresh of the relative ages. */
const AGE_REFRESH_MS = 60_000;

interface RestoreRequest {
  readonly summary: string;
  readonly source: RestoreSource;
}

interface BackupRow {
  readonly info: BackupInfo;
  readonly date: string;
  readonly age: string;
  readonly kind: string;
  readonly size: string;
  readonly dbOnly: boolean;
  readonly tooNew: boolean;
  readonly canRestore: boolean;
}

@Component({
  selector: 'app-backup-settings',
  imports: [TranslocoPipe, Dialog],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <section id="backups" class="box mt-4" aria-labelledby="backups-heading">
      <header class="box-header">
        <i class="pi pi-database" aria-hidden="true"></i>
        <h2 id="backups-heading">{{ 'backup.title' | transloco }}</h2>
      </header>
      <div
        class="box-body flex flex-col items-start gap-3"
        [attr.inert]="locked() ? '' : null"
        [attr.aria-busy]="operation() !== null"
      >
        @if (!available) {
          <p class="text-fg-muted" data-testid="backup-unavailable">
            {{ 'backup.unavailable' | transloco }}
          </p>
        } @else {
          <p class="text-fg-muted">{{ 'backup.intro' | transloco }}</p>

          @if (store.error(); as loadError) {
            <p role="alert" class="flash flash-danger" data-testid="backup-load-error">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              {{ 'backup.loadError' | transloco }}
              <button type="button" class="btn btn-compact" (click)="reload()">
                {{ 'backup.retry' | transloco }}
              </button>
            </p>
          }
          @if (store.status(); as status) {
            @if (status.lastAutoError; as autoError) {
              <p class="flash flash-attention" data-testid="backup-auto-error">
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                {{ autoErrorText(autoError) }}
              </p>
            }
            @if (status.preMigrationFailed) {
              <p class="flash flash-attention" data-testid="backup-pre-migration-failed">
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                {{ 'backup.alert.preMigrationFailed' | transloco }}
              </p>
            }
          }

          @if (rawCopyText(); as rawText) {
            <p class="flash flash-attention" data-testid="backup-raw-copy">
              <i class="pi pi-folder-open" aria-hidden="true"></i>
              {{ rawText }}
            </p>
          }

          @if (store.overview() === null) {
            @if (store.loading()) {
              <p class="text-fg-muted" data-testid="backup-loading">
                <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
                {{ 'backup.loading' | transloco }}
              </p>
            }
          } @else if (rows().length > 0) {
            <p data-testid="backup-last">{{ lastText() }}</p>
          }

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary"
              data-testid="backup-create"
              [disabled]="actionsDisabled()"
              [attr.aria-busy]="operation() === 'create'"
              (click)="create()"
            >
              {{ (operation() === 'create' ? 'backup.creating' : 'backup.create') | transloco }}
            </button>
            <button
              type="button"
              class="btn"
              data-testid="backup-restore-file"
              [disabled]="actionsDisabled()"
              [attr.aria-busy]="operation() === 'pick'"
              (click)="restoreFromFile($event)"
            >
              {{ 'backup.restoreFromFile' | transloco }}
            </button>
            <button
              type="button"
              class="btn"
              data-testid="backup-open-folder"
              [disabled]="actionsDisabled()"
              (click)="openFolder()"
            >
              {{ 'backup.openFolder' | transloco }}
            </button>
          </div>

          @if (errorText(); as text) {
            <p role="alert" class="flash flash-danger" data-testid="backup-error">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              {{ text }}
            </p>
          }
          <!-- Permanent live region: only its content changes, so that the change is announced. -->
          <div role="status" class="w-full empty:hidden">
            @if (successKey(); as key) {
              <p class="flash" data-testid="backup-success">
                <i class="pi pi-check" aria-hidden="true"></i>
                {{ key | transloco }}
              </p>
            }
          </div>

          @if (rows().length === 0) {
            @if (store.overview() !== null) {
              <div class="empty-state w-full" data-testid="backup-empty">
                <i class="pi pi-database" aria-hidden="true"></i>
                <p>{{ 'backup.empty' | transloco }}</p>
              </div>
            }
          } @else {
            <ul class="w-full" [attr.aria-label]="'backup.listLabel' | transloco">
              @for (row of rows(); track row.info.id) {
                <li
                  class="box-row flex flex-wrap items-center gap-x-3 gap-y-1"
                  data-testid="backup-row"
                >
                  <span class="min-w-0 flex-1">
                    <span class="font-semibold">{{ row.date }}</span>
                    <span class="text-fg-muted"> ({{ row.age }})</span>
                    <span class="block text-xs text-fg-muted">
                      {{ row.kind }} · {{ row.size }}
                      @if (row.dbOnly) {
                        · {{ 'backup.label.dbOnly' | transloco }}
                      }
                      @if (row.info.damaged) {
                        ·
                        <strong class="text-danger">{{
                          'backup.label.damaged' | transloco
                        }}</strong>
                      }
                      @if (row.tooNew) {
                        · {{ 'backup.label.tooNew' | transloco }}
                      }
                    </span>
                  </span>
                  <button
                    type="button"
                    class="btn btn-compact"
                    data-testid="backup-export"
                    [disabled]="actionsDisabled()"
                    [attr.aria-label]="'backup.exportLabel' | transloco: { date: row.date }"
                    (click)="exportBackup(row.info.id)"
                  >
                    {{ 'backup.export' | transloco }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-compact"
                    data-testid="backup-restore"
                    [disabled]="actionsDisabled() || !row.canRestore"
                    [attr.aria-label]="'backup.restore.actionLabel' | transloco: { date: row.date }"
                    (click)="restoreInternal(row, $event)"
                  >
                    {{ 'backup.restore.action' | transloco }}
                  </button>
                </li>
              }
            </ul>
          }
        }
      </div>
    </section>

    @if (request(); as pending) {
      <p-dialog
        [visible]="true"
        [modal]="true"
        [closable]="false"
        [closeOnEscape]="false"
        [focusOnShow]="false"
        [header]="'backup.restore.header' | transloco"
        [style]="{ width: '32rem', maxWidth: '92vw' }"
        data-testid="restore-dialog"
      >
        <div class="flex flex-col items-start gap-3" [attr.aria-busy]="busy()">
          <p data-testid="restore-summary">{{ pending.summary }}</p>
          <p class="flash flash-attention">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            {{ 'backup.restore.warning' | transloco }}
          </p>
          <label class="flex items-start gap-2">
            <input
              #acknowledgeBox
              type="checkbox"
              data-testid="restore-acknowledge"
              [checked]="acknowledged()"
              [disabled]="busy()"
              (change)="acknowledged.set(acknowledgeBox.checked)"
            />
            <span>{{ 'backup.restore.acknowledge' | transloco }}</span>
          </label>
          @if (restoreError(); as text) {
            <p role="alert" class="flash flash-danger" data-testid="restore-error">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              {{ text }}
            </p>
          }
          @if (restorePhase() !== 'idle') {
            <p class="flex items-center gap-2" data-testid="restore-progress">
              <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
              {{
                (restorePhase() === 'restarting'
                  ? 'backup.restore.restarting'
                  : 'backup.restore.inProgress'
                ) | transloco
              }}
            </p>
          }
          <div class="flex gap-2 self-end">
            <button
              #cancelButton
              type="button"
              class="btn"
              data-testid="restore-cancel"
              [disabled]="busy()"
              (click)="cancelRestore()"
            >
              {{ 'backup.restore.cancel' | transloco }}
            </button>
            <button
              type="button"
              class="btn btn-danger"
              data-testid="restore-confirm"
              [disabled]="!acknowledged() || busy()"
              (click)="runRestore()"
            >
              {{ 'backup.restore.confirm' | transloco }}
            </button>
          </div>
        </div>
      </p-dialog>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupSettingsComponent implements OnInit {
  protected readonly store = inject(BackupStatusStore);
  private readonly backup = inject(BackupService);
  private readonly transloco = inject(TranslocoService);
  private readonly display = inject(TimeDisplay);
  private readonly clock = inject(CLOCK);
  private readonly pendingWrites = inject(PendingWrites);

  protected readonly available = this.backup.isAvailable();
  protected readonly operation = signal<Operation | null>(null);
  protected readonly restorePhase = signal<RestorePhase>('idle');
  private readonly error = signal<BackupErrorDto | null>(null);
  protected readonly successKey = signal<string | null>(null);
  protected readonly request = signal<RestoreRequest | null>(null);
  protected readonly acknowledged = signal(false);
  private readonly restoreFailure = signal<BackupErrorDto | null>(null);
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  /** Bumped every minute so that the relative ages stay current. */
  private readonly ageTick = signal(0);

  protected readonly busy = computed(() => this.restorePhase() !== 'idle');
  protected readonly restoreError = computed(() => {
    const dto = this.restoreFailure();
    return dto === null ? null : backupErrorText(this.transloco, dto);
  });
  protected readonly locked = computed(() => this.store.exclusive() !== null);
  protected readonly actionsDisabled = computed(() => this.operation() !== null || this.locked());
  protected readonly errorText = computed(() => {
    const dto = this.error();
    return dto === null ? null : backupErrorText(this.transloco, dto);
  });

  protected readonly rows = computed<readonly BackupRow[]>(() => {
    this.ageTick();
    const supported = this.store.overview()?.supportedSchemaVersion ?? Number.MAX_SAFE_INTEGER;
    return this.store.backups().map((info) => {
      const tooNew = info.schemaVersion !== null && info.schemaVersion > supported;
      return {
        info,
        date: this.formatDate(info.createdAt),
        age: this.formatAge(info.createdAt),
        kind: this.transloco.translate(`backup.kind.${info.kind}`),
        size: formatBytes(info.sizeBytes),
        dbOnly: info.includesImages === false,
        tooNew,
        canRestore: !info.damaged && !tooNew,
      };
    });
  });

  /** Reminder while a raw safety copy of an old database sits in the backups folder. */
  protected readonly rawCopyText = computed(() => {
    this.ageTick();
    const newest = this.store.status()?.rawSafetyCopies[0];
    if (newest === undefined) return null;
    const instant = rawSafetyCopyInstant(newest);
    return this.transloco.translate('backup.status.rawCopy', {
      age:
        instant === null ? this.transloco.translate('backup.unknownDate') : this.formatAge(instant),
    });
  });

  protected readonly lastText = computed(() => {
    this.ageTick();
    const newest = this.store.backups().find((b) => !b.damaged);
    return newest === undefined
      ? this.transloco.translate('backup.status.none')
      : this.transloco.translate('backup.status.last', { age: this.formatAge(newest.createdAt) });
  });

  /** Element that opened the current dialog or operation: gets the focus back afterwards. */
  private trigger: HTMLElement | null = null;

  constructor() {
    // Safe default of a destructive confirmation: the focus lands on "Annuler".
    effect(() => {
      this.cancelButton()?.nativeElement.focus();
    });
    if (this.available) {
      const timer = setInterval(() => this.ageTick.update((n) => n + 1), AGE_REFRESH_MS);
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
  }

  ngOnInit(): void {
    if (this.available) void this.store.load();
  }

  protected reload(): void {
    void this.store.refresh();
  }

  protected autoErrorText(dto: BackupErrorDto): string {
    return this.transloco.translate('backup.status.autoError', {
      reason: backupErrorText(this.transloco, dto),
    });
  }

  protected async create(): Promise<void> {
    await this.run('create', async () => {
      await this.backup.create();
      await this.store.refresh();
      this.successKey.set('backup.created');
    });
  }

  protected async openFolder(): Promise<void> {
    await this.run('folder', () => this.backup.openFolder());
  }

  protected async exportBackup(id: string): Promise<void> {
    await this.run('export', async () => {
      // `false`: the user cancelled the save dialog; nothing to say.
      if (await this.backup.exportArchive(id)) this.successKey.set('backup.exported');
    });
  }

  protected restoreInternal(row: BackupRow, event: Event): void {
    if (!row.canRestore) return;
    this.trigger = event.currentTarget as HTMLElement;
    const info = row.info;
    this.askRestore(
      this.summaryText({
        createdAt: info.createdAt,
        kind: info.kind,
        appVersion: info.appVersion,
        includesImages: info.includesImages,
        imageCount: info.imageCount,
      }),
      { kind: 'internal', id: info.id },
    );
  }

  /** Picks an archive (native dialog, run by Rust), shows what it holds, then asks to restore. */
  protected async restoreFromFile(event: Event): Promise<void> {
    this.trigger = event.currentTarget as HTMLElement;
    // `null`: cancelled; `undefined`: failed (the error is shown).
    const picked = await this.run('pick', () => this.backup.pickExternal());
    if (!picked) return;
    this.askRestore(
      this.summaryText({
        createdAt: picked.createdAt,
        kind: picked.kind,
        appVersion: picked.appVersion,
        includesImages: picked.includesImages,
        imageCount: picked.imageCount,
      }),
      // The token of the summary on screen: Rust refuses the restoration if the file changed.
      { kind: 'external', token: picked.token },
    );
  }

  private askRestore(summary: string, source: RestoreSource): void {
    this.acknowledged.set(false);
    this.restoreFailure.set(null);
    this.request.set({ summary, source });
  }

  /** Escape closes the dialog at rest; it is ignored while the restoration runs. */
  protected onEscape(): void {
    if (this.request() !== null && !this.busy()) this.cancelRestore();
  }

  protected cancelRestore(): void {
    if (this.busy()) return;
    this.request.set(null);
    this.restoreFailure.set(null);
    this.restoreFocus();
  }

  protected async runRestore(): Promise<void> {
    const request = this.request();
    if (request === null || !this.acknowledged() || this.busy()) return;
    this.error.set(null);
    this.successKey.set(null);
    this.restoreFailure.set(null);
    this.store.lock('restore');
    this.restorePhase.set('running');
    try {
      // No deferred write (notes, layout) may be lost or reach the restored database.
      await this.pendingWrites.flushAll();
      await this.backup.restore(request.source);
      // The application restarts by itself; the page stays frozen until then.
      this.markRestarting();
    } catch (cause) {
      const dto = toBackupError(cause).dto;
      if (dto.kind === 'restart_pending') {
        this.markRestarting();
        return;
      }
      // The dialog stays open with the translated error; the box is unchecked to confirm again.
      this.restoreFailure.set(dto);
      this.acknowledged.set(false);
      this.restorePhase.set('idle');
      this.store.unlock();
    }
  }

  private markRestarting(): void {
    this.restorePhase.set('restarting');
    this.store.setStatus('backup.restore.restarting');
  }

  private summaryText(archive: {
    readonly createdAt: string;
    readonly kind: string;
    readonly appVersion: string | null;
    readonly includesImages: boolean | null;
    readonly imageCount: number | null;
  }): string {
    const params = {
      date: this.formatDate(archive.createdAt),
      kind: this.transloco.translate(`backup.kind.${archive.kind}`),
      version: archive.appVersion,
    };
    const head = this.transloco.translate(
      archive.appVersion === null ? 'backup.restore.summaryNoVersion' : 'backup.restore.summary',
      params,
    );
    if (archive.includesImages === null) return head;
    const images = archive.includesImages
      ? this.transloco.translate('backup.restore.images', { count: archive.imageCount ?? 0 })
      : this.transloco.translate('backup.restore.dbOnly');
    return `${head} ${images}`;
  }

  /** One cancellable operation at a time; the error (translated) or the success is shown. */
  private async run<T>(operation: Operation, action: () => Promise<T>): Promise<T | undefined> {
    if (this.operation() !== null) return undefined;
    this.error.set(null);
    this.successKey.set(null);
    this.operation.set(operation);
    try {
      return await action();
    } catch (cause) {
      this.error.set(toBackupError(cause).dto);
      return undefined;
    } finally {
      this.operation.set(null);
    }
  }

  private restoreFocus(): void {
    const element = this.trigger;
    this.trigger = null;
    // The button may be disabled for a moment (state just changed): focus on the next frame.
    if (element?.isConnected) setTimeout(() => element.focus());
  }

  private formatDate(iso: string): string {
    try {
      return this.display.formatInstant(iso, 'date-time');
    } catch (cause) {
      if (cause instanceof TimeError) return this.transloco.translate('backup.unknownDate');
      throw cause;
    }
  }

  private formatAge(iso: string): string {
    try {
      return this.display.formatRelative(iso, this.clock.nowIso());
    } catch (cause) {
      if (cause instanceof TimeError) return this.transloco.translate('backup.unknownDate');
      throw cause;
    }
  }
}
