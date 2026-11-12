import {
  ChangeDetectionStrategy,
  Component,
  ViewContainerRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { isTauriRuntime } from '../../tauri-runtime';
import { DashboardListStore } from '../dashboard/dashboard-list.store';
import { AppLock } from '../lock';
import type { AppLockKind } from '../lock';
import { SidebarComponent } from './sidebar.component';

const LOCK_TEXT: Record<AppLockKind, string> = {
  restore: 'backup.restore.inProgress',
  import: 'configTransfer.working',
  delete: 'dashboards.remove.inProgress',
};

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, SidebarComponent],
  templateUrl: './layout.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutComponent {
  protected readonly lock = inject(AppLock);
  private readonly transloco = inject(TranslocoService);
  private readonly dashboards = inject(DashboardListStore);
  /** Text of the freeze overlay (null: nothing is running). */
  protected readonly lockText = computed(() => {
    const kind = this.lock.locked();
    if (kind === null) return null;
    return this.transloco.translate(this.lock.statusKey() ?? LOCK_TEXT[kind]);
  });

  /** Anchor of the backup banner: its chunk is only loaded inside the desktop shell. */
  private readonly alertHost = viewChild.required('alertHost', { read: ViewContainerRef });

  constructor() {
    void this.dashboards.load(this.transloco.translate('dashboard.defaultName'));
    if (isTauriRuntime()) {
      effect(() => {
        const host = this.alertHost();
        untracked(() => {
          void import('../backup/backup-alert.component')
            .then((m) => host.createComponent(m.BackupAlertComponent))
            .catch((error: unknown) => console.error('Backup banner unavailable', error));
        });
      });
    }
  }
}
