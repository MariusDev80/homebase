import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  BackupStatusStore,
  ConfigTransferService,
  RELOAD_PAGE,
  backupErrorText,
  importIssueText,
  toBackupError,
} from '../../core/backup';
import type { BackupErrorDto, ConfigImportAnalysis } from '../../core/backup';
import { PendingWrites } from '../../core/widgets';

type Operation = 'export' | 'pick' | 'apply';
type ReadyAnalysis = Extract<ConfigImportAnalysis, { ok: true }>;
type InvalidAnalysis = Extract<ConfigImportAnalysis, { ok: false }>;

@Component({
  selector: 'app-config-transfer-settings',
  imports: [TranslocoPipe],
  template: `
    <section id="configuration" class="box mt-4" aria-labelledby="config-transfer-heading">
      <header class="box-header">
        <i class="pi pi-sliders-h" aria-hidden="true"></i>
        <h2 id="config-transfer-heading">{{ 'configTransfer.title' | transloco }}</h2>
      </header>
      <div
        class="box-body flex flex-col items-start gap-3"
        [attr.inert]="locked() ? '' : null"
        [attr.aria-busy]="operation() !== null"
      >
        @if (!available) {
          <p class="text-fg-muted" data-testid="config-unavailable">
            {{ 'configTransfer.unavailable' | transloco }}
          </p>
        } @else {
          <p class="text-fg-muted">{{ 'configTransfer.intro' | transloco }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn"
              data-testid="config-export"
              [disabled]="actionsDisabled()"
              (click)="exportConfig()"
            >
              {{ 'configTransfer.export' | transloco }}
            </button>
            <button
              type="button"
              #importButton
              class="btn"
              data-testid="config-import"
              [disabled]="actionsDisabled()"
              [attr.aria-busy]="operation() === 'pick'"
              (click)="pickFile()"
            >
              {{ 'configTransfer.import' | transloco }}
            </button>
          </div>

          @if (errorText(); as text) {
            <p role="alert" class="flash flash-danger" data-testid="config-error">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              {{ text }}
            </p>
          }
          <!-- Permanent live region: only its content changes, so that the change is announced. -->
          <div role="status" class="w-full empty:hidden">
            @if (exported()) {
              <p class="flash" data-testid="config-exported">
                <i class="pi pi-check" aria-hidden="true"></i>
                {{ 'configTransfer.exported' | transloco }}
              </p>
            }
            @if (operation() === 'apply') {
              <p data-testid="config-working">
                <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
                {{ 'configTransfer.working' | transloco }}
              </p>
            }
          </div>

          @if (invalid(); as problems) {
            <div
              class="flash flash-danger w-full flex-col items-start"
              data-testid="config-invalid"
              role="alert"
            >
              <p>
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                {{ 'configTransfer.invalid' | transloco }}
              </p>
              <ul class="list-disc pl-6">
                @for (text of issueTexts(); track $index) {
                  <li data-testid="config-issue">{{ text }}</li>
                }
              </ul>
              @if (problems.truncated) {
                <p class="text-xs" data-testid="config-truncated">
                  {{ 'configTransfer.truncated' | transloco }}
                </p>
              }
            </div>
          }

          @if (ready(); as analysis) {
            <div
              role="region"
              aria-live="polite"
              class="flex w-full flex-col gap-3"
              data-testid="config-preview"
              [attr.aria-label]="'configTransfer.previewLabel' | transloco"
            >
              <p>
                {{
                  'configTransfer.preview'
                    | transloco
                      : {
                          dashboards: analysis.preview.dashboards,
                          widgets: analysis.preview.widgets,
                          settings: analysis.preview.settings,
                        }
                }}
              </p>
              <ul class="flex flex-col gap-2">
                @if (analysis.preview.removedDashboards > 0) {
                  <li class="flash flash-danger" data-testid="warn-removed-dashboards">
                    <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                    {{
                      'configTransfer.removedDashboards'
                        | transloco: { count: analysis.preview.removedDashboards }
                    }}
                  </li>
                }
                @if (analysis.preview.removedWidgets > 0) {
                  <li class="flash flash-danger" data-testid="warn-removed-widgets">
                    <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                    {{
                      'configTransfer.removedWidgets'
                        | transloco: { count: analysis.preview.removedWidgets }
                    }}
                  </li>
                }
                @if (analysis.preview.replacedWidgets > 0) {
                  <li class="flash flash-attention" data-testid="warn-replaced-widgets">
                    <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                    {{
                      'configTransfer.replacedWidgets'
                        | transloco: { count: analysis.preview.replacedWidgets }
                    }}
                  </li>
                }
                @if (analysis.preview.unknownTypes.length > 0) {
                  <li class="flash" data-testid="info-unknown-types">
                    <i class="pi pi-info-circle" aria-hidden="true"></i>
                    {{
                      'configTransfer.unknownTypes'
                        | transloco: { types: analysis.preview.unknownTypes.join(', ') }
                    }}
                  </li>
                }
                @if (analysis.preview.futureVersions > 0) {
                  <li class="flash" data-testid="info-future-versions">
                    <i class="pi pi-info-circle" aria-hidden="true"></i>
                    {{
                      'configTransfer.futureVersions'
                        | transloco: { count: analysis.preview.futureVersions }
                    }}
                  </li>
                }
                @if (analysis.preview.resetsThemes) {
                  <li class="flash" data-testid="info-themes-reset">
                    <i class="pi pi-info-circle" aria-hidden="true"></i>
                    {{ 'configTransfer.themesReset' | transloco }}
                  </li>
                }
                @if (analysis.preview.resetsIcons) {
                  <li class="flash" data-testid="info-icons-reset">
                    <i class="pi pi-info-circle" aria-hidden="true"></i>
                    {{ 'configTransfer.iconsReset' | transloco }}
                  </li>
                }
              </ul>
              <p class="text-fg-muted">{{ 'configTransfer.safetyBackup' | transloco }}</p>
              <p>{{ 'configTransfer.confirmMessage' | transloco }}</p>
              <div class="flex gap-2">
                <button
                  type="button"
                  #cancelButton
                  class="btn"
                  data-testid="config-cancel"
                  [disabled]="actionsDisabled()"
                  (click)="cancel()"
                >
                  {{ 'configTransfer.cancel' | transloco }}
                </button>
                <button
                  type="button"
                  class="btn btn-danger"
                  data-testid="config-confirm"
                  [disabled]="actionsDisabled()"
                  (click)="apply()"
                >
                  {{ 'configTransfer.confirm' | transloco }}
                </button>
              </div>
            </div>
          }
        }
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigTransferSettingsComponent {
  private readonly transfer = inject(ConfigTransferService);
  private readonly store = inject(BackupStatusStore);
  private readonly pendingWrites = inject(PendingWrites);
  private readonly reloadPage = inject(RELOAD_PAGE);
  private readonly transloco = inject(TranslocoService);

  protected readonly available = this.transfer.isAvailable();
  protected readonly operation = signal<Operation | null>(null);
  protected readonly exported = signal(false);
  private readonly error = signal<BackupErrorDto | null>(null);
  private readonly analysis = signal<ConfigImportAnalysis | null>(null);

  private readonly importButton = viewChild<ElementRef<HTMLButtonElement>>('importButton');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  protected readonly locked = computed(() => this.store.exclusive() !== null);
  protected readonly actionsDisabled = computed(() => this.operation() !== null || this.locked());
  protected readonly errorText = computed(() => {
    const dto = this.error();
    return dto === null ? null : backupErrorText(this.transloco, dto);
  });
  protected readonly ready = computed<ReadyAnalysis | null>(() => {
    const analysis = this.analysis();
    return analysis?.ok ? analysis : null;
  });
  protected readonly invalid = computed<InvalidAnalysis | null>(() => {
    const analysis = this.analysis();
    return analysis !== null && !analysis.ok ? analysis : null;
  });
  protected readonly issueTexts = computed(() =>
    (this.invalid()?.issues ?? []).map((issue) => importIssueText(this.transloco, issue)),
  );

  constructor() {
    // Safe default of a destructive confirmation: the focus lands on "Annuler".
    effect(() => {
      this.cancelButton()?.nativeElement.focus();
    });
  }

  protected async exportConfig(): Promise<void> {
    this.reset();
    this.operation.set('export');
    try {
      // `false`: the user cancelled the save dialog.
      this.exported.set(await this.transfer.exportToFile());
    } catch (cause) {
      this.error.set(toBackupError(cause).dto);
    } finally {
      this.operation.set(null);
    }
  }

  protected async pickFile(): Promise<void> {
    this.reset();
    this.operation.set('pick');
    try {
      // `null`: the user cancelled the open dialog.
      this.analysis.set(await this.transfer.pickAndAnalyze());
    } catch (cause) {
      this.error.set(toBackupError(cause).dto);
    } finally {
      this.operation.set(null);
    }
  }

  protected cancel(): void {
    this.analysis.set(null);
    setTimeout(() => this.importButton()?.nativeElement.focus());
  }

  protected async apply(): Promise<void> {
    const analysis = this.ready();
    if (analysis === null || this.operation() !== null) return;
    this.error.set(null);
    this.operation.set('apply');
    this.store.lock('import');
    try {
      // No deferred write (notes, layout) may reach a row the import is about to delete.
      await this.pendingWrites.flushAll();
      await this.transfer.apply(analysis.plan);
    } catch (cause) {
      this.error.set(toBackupError(cause).dto);
      this.operation.set(null);
      this.store.unlock();
      return;
    }
    // Success: the page stays frozen until it reloads with the imported configuration.
    this.reloadPage();
  }

  private reset(): void {
    this.error.set(null);
    this.exported.set(false);
    this.analysis.set(null);
  }
}
