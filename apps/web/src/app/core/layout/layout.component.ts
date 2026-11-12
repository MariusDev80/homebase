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
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { isTauriRuntime } from '../../tauri-runtime';
import { AppLock } from '../lock';
import type { AppLockKind } from '../lock';
import { ThemeMode, ThemeService } from '../theme';

const THEME_ICONS: Record<ThemeMode, string> = {
  system: 'pi pi-desktop',
  light: 'pi pi-sun',
  dark: 'pi pi-moon',
};

const LOCK_TEXT: Record<AppLockKind, string> = {
  restore: 'backup.restore.inProgress',
  import: 'configTransfer.working',
};

@Component({
  selector: 'app-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslocoPipe],
  templateUrl: './layout.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly lock = inject(AppLock);
  private readonly transloco = inject(TranslocoService);
  protected readonly themeIcon = computed(() => THEME_ICONS[this.theme.mode()]);
  /** Text of the freeze overlay (null: nothing is running). */
  protected readonly lockText = computed(() => {
    const kind = this.lock.locked();
    if (kind === null) return null;
    return this.transloco.translate(this.lock.statusKey() ?? LOCK_TEXT[kind]);
  });

  /** Anchor of the backup banner: its chunk is only loaded inside the desktop shell. */
  private readonly alertHost = viewChild.required('alertHost', { read: ViewContainerRef });

  constructor() {
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
