import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Dialog } from 'primeng/dialog';
import type { Dashboard } from '../../data';
import { BackupService, isBackupError } from '../backup/backup.service';
import { DashboardListStore } from '../dashboard/dashboard-list.store';
import { DashboardStore } from '../dashboard/dashboard.store';
import { AppLock } from '../lock/app-lock';

/**
 * Strong confirmation before deleting a dashboard (spec dashboards-sidebar D10, 4.8). The
 * deletion itself, with its `pre-delete` backup, is done by the Rust command behind
 * `BackupService.deleteDashboard`, under the `delete` application lock.
 */
@Component({
  selector: 'app-dashboard-delete-dialog',
  imports: [TranslocoPipe, Dialog],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <p-dialog
      [visible]="true"
      [modal]="true"
      [closable]="false"
      [closeOnEscape]="false"
      [focusOnShow]="false"
      appendTo="body"
      [header]="'dashboards.remove.header' | transloco"
      [style]="{ width: '32rem', maxWidth: '92vw' }"
      data-testid="dashboard-delete-dialog"
    >
      <div class="flex flex-col items-start gap-3" [attr.aria-busy]="busy()">
        <p data-testid="dashboard-delete-summary">
          {{ 'dashboards.remove.question' | transloco: { name: dashboard().name } }}
        </p>
        @if (countFailed()) {
          <p role="alert" class="flash flash-danger" data-testid="dashboard-delete-count-error">
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
            {{ 'dashboards.remove.countError' | transloco }}
          </p>
        } @else if (widgetCount() !== null) {
          <p class="flash flash-attention" data-testid="dashboard-delete-warning">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            @if (widgetCount() === 0) {
              {{ 'dashboards.remove.warningEmpty' | transloco }}
            } @else {
              {{
                (widgetCount() === 1 ? 'dashboards.remove.warningOne' : 'dashboards.remove.warning')
                  | transloco: { count: widgetCount() }
              }}
            }
          </p>
          <p data-testid="dashboard-delete-safety">
            {{ 'dashboards.remove.safety' | transloco }}
          </p>
        }
        @if (needsAcknowledge()) {
          <label class="flex items-start gap-2">
            <input
              #acknowledgeBox
              type="checkbox"
              data-testid="dashboard-delete-acknowledge"
              [checked]="acknowledged()"
              [disabled]="busy()"
              (change)="acknowledged.set(acknowledgeBox.checked)"
            />
            <span>{{ 'dashboards.remove.acknowledge' | transloco }}</span>
          </label>
        }
        @if (errorKey(); as key) {
          <p role="alert" class="flash flash-danger" data-testid="dashboard-delete-error">
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
            {{ key | transloco }}
          </p>
        }
        <div class="flex gap-2 self-end">
          <button
            #cancelButton
            type="button"
            class="btn"
            data-testid="dashboard-delete-cancel"
            [disabled]="busy()"
            (click)="cancel()"
          >
            {{ 'dashboards.remove.cancel' | transloco }}
          </button>
          <button
            type="button"
            class="btn btn-danger"
            data-testid="dashboard-delete-confirm"
            [disabled]="!canConfirm()"
            (click)="confirm()"
          >
            {{ 'dashboards.remove.confirm' | transloco }}
          </button>
        </div>
      </div>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardDeleteDialogComponent {
  private readonly list = inject(DashboardListStore);
  private readonly store = inject(DashboardStore);
  private readonly backup = inject(BackupService);
  private readonly lock = inject(AppLock);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  readonly dashboard = input.required<Dashboard>();
  /** `true` when the dashboard was deleted (or already gone); `false` when dismissed. */
  readonly closed = output<boolean>();

  protected readonly widgetCount = signal<number | null>(null);
  protected readonly countFailed = signal(false);
  protected readonly acknowledged = signal(false);
  protected readonly busy = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  protected readonly needsAcknowledge = computed(() => (this.widgetCount() ?? 0) > 0);
  protected readonly canConfirm = computed(
    () =>
      !this.busy() &&
      !this.countFailed() &&
      this.widgetCount() !== null &&
      (!this.needsAcknowledge() || this.acknowledged()),
  );

  constructor() {
    afterNextRender(() => this.cancelButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
    afterNextRender(() => void this.loadCount(), { injector: this.injector });
  }

  private async loadCount(): Promise<void> {
    try {
      this.widgetCount.set(await this.list.countWidgets(this.dashboard().id));
    } catch (error: unknown) {
      console.error('Could not count the widgets of the dashboard', error);
      this.countFailed.set(true);
    }
  }

  /** Escape closes the dialog at rest; ignored during the deletion. */
  protected onEscape(): void {
    if (!this.busy()) this.closed.emit(false);
  }

  protected cancel(): void {
    if (!this.busy()) this.closed.emit(false);
  }

  /** The neighbour shown if the current dashboard goes away: the next one, else the previous. */
  private neighbourId(id: string): string | null {
    const sorted = [...this.list.dashboards()].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = sorted.findIndex((d) => d.id === id);
    return (sorted[index + 1] ?? sorted[index - 1])?.id ?? null;
  }

  /** The store is empty while a dashboard loads or failed: the URL tells which one is shown. */
  private isCurrent(id: string): boolean {
    if (this.store.dashboard()?.id === id) return true;
    const path = this.router.url.split(/[?#]/)[0];
    return path === `/dashboards/${id}`;
  }

  protected async confirm(): Promise<void> {
    if (!this.canConfirm()) return;
    const id = this.dashboard().id;
    this.errorKey.set(null);
    this.busy.set(true);
    let deleted = false;
    try {
      // 1. Leave the dashboard before the lock (the navigation is refused once it is taken).
      if (this.isCurrent(id)) {
        const target = this.neighbourId(id);
        let navigated = false;
        try {
          navigated = target !== null && (await this.router.navigate(['/dashboards', target]));
        } catch {
          navigated = false;
        }
        if (!navigated) {
          this.errorKey.set('dashboards.remove.error');
          return;
        }
      }
      // 2. to 5. under the lock; it is always released.
      this.lock.lock('delete');
      try {
        await this.list.prepareRemoval();
        try {
          await this.backup.deleteDashboard(id);
        } catch (error: unknown) {
          if (!isBackupError(error) || error.kind !== 'not_found') {
            this.errorKey.set(this.errorKeyOf(error));
            return;
          }
          // Already deleted: the list is reread below.
        }
        try {
          await this.list.afterRemoval();
        } catch (error: unknown) {
          // The dashboard is gone; only the reread failed: forget it locally and carry on.
          console.error('Could not reread the dashboards after the deletion', error);
          this.list.forget(id);
        }
        deleted = true;
      } catch (error: unknown) {
        console.error('Could not delete the dashboard', error);
        this.errorKey.set('dashboards.remove.error');
      } finally {
        this.lock.unlock();
      }
    } finally {
      this.busy.set(false);
    }
    if (deleted) this.closed.emit(true);
  }

  private errorKeyOf(error: unknown): string {
    if (!isBackupError(error)) return 'dashboards.remove.error';
    switch (error.kind) {
      case 'last_dashboard':
        return 'dashboards.remove.last';
      case 'busy':
        return 'dashboards.remove.busy';
      case 'unavailable':
        return 'dashboards.remove.unavailable';
      default:
        return 'dashboards.remove.error';
    }
  }
}
