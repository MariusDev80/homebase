import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SystemService } from '../../core/system';
import { THEME_MODES, ThemeService } from '../../core/theme';

const TEST_NOTIFICATION_DELAY_SECS = 10;

@Component({
  selector: 'app-settings-page',
  imports: [TranslocoPipe],
  template: `
    <div class="max-w-3xl">
      <div class="page-header">
        <h1 class="page-title">{{ 'settings.heading' | transloco }}</h1>
      </div>
      <section class="box" aria-labelledby="theme-heading">
        <header class="box-header">
          <i class="pi pi-palette" aria-hidden="true"></i>
          <h2 id="theme-heading">{{ 'settings.theme.label' | transloco }}</h2>
        </header>
        <div class="box-body">
          <div role="group" aria-labelledby="theme-heading" class="flex gap-2">
            @for (mode of modes; track mode) {
              <button
                type="button"
                [attr.data-testid]="'theme-' + mode"
                [attr.aria-pressed]="theme.mode() === mode"
                (click)="theme.setMode(mode)"
                class="btn"
              >
                {{ 'theme.mode.' + mode | transloco }}
              </button>
            }
          </div>
        </div>
      </section>
      <section class="box mt-4" aria-labelledby="system-heading">
        <header class="box-header">
          <i class="pi pi-desktop" aria-hidden="true"></i>
          <h2 id="system-heading">{{ 'settings.system.label' | transloco }}</h2>
        </header>
        <div class="box-body">
          @if (!available) {
            <p class="mb-3 text-xs text-fg-muted">
              {{ 'settings.system.unavailable' | transloco }}
            </p>
          }
          <div class="flex flex-col items-start gap-3">
            <button
              type="button"
              data-testid="test-notification"
              [disabled]="!available"
              (click)="sendTestNotification()"
              class="btn"
            >
              {{ 'settings.system.testNotification' | transloco }}
            </button>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                role="switch"
                class="switch"
                data-testid="autostart-toggle"
                [checked]="autostart()"
                [disabled]="!available || autostartBusy()"
                (change)="toggleAutostart($event)"
              />
              {{ 'settings.system.autostart' | transloco }}
            </label>
            @if (error()) {
              <p role="alert" class="flash flash-danger">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                {{ 'settings.system.error' | transloco }}
              </p>
            }
          </div>
        </div>
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage implements OnInit {
  protected readonly theme = inject(ThemeService);
  private readonly system = inject(SystemService);
  protected readonly modes = THEME_MODES;

  protected readonly available = this.system.isAvailable();
  protected readonly autostart = signal(false);
  protected readonly autostartBusy = signal(false);
  protected readonly error = signal(false);

  ngOnInit(): void {
    if (!this.available) {
      return;
    }
    this.system.getAutostart().then(
      (enabled) => this.autostart.set(enabled),
      () => this.error.set(true),
    );
  }

  protected sendTestNotification(): void {
    this.error.set(false);
    this.system.scheduleTestNotification(TEST_NOTIFICATION_DELAY_SECS).catch(() => {
      this.error.set(true);
    });
  }

  protected toggleAutostart(event: Event): void {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    this.error.set(false);
    this.autostartBusy.set(true);
    this.system
      .setAutostart(enabled)
      .then(() => this.autostart.set(enabled))
      .catch(() => {
        input.checked = !enabled;
        this.error.set(true);
      })
      .finally(() => this.autostartBusy.set(false));
  }
}
