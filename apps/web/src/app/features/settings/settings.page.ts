import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SystemService } from '../../core/system';
import { THEME_MODES, ThemeService } from '../../core/theme';

const TEST_NOTIFICATION_DELAY_SECS = 10;

@Component({
  selector: 'app-settings-page',
  imports: [TranslocoPipe],
  template: `
    <h1 class="mb-4 text-xl font-semibold">{{ 'settings.heading' | transloco }}</h1>
    <section [attr.aria-labelledby]="'theme-heading'">
      <h2 id="theme-heading" class="mb-2 font-medium">{{ 'settings.theme.label' | transloco }}</h2>
      <div role="group" [attr.aria-labelledby]="'theme-heading'" class="flex gap-2">
        @for (mode of modes; track mode) {
          <button
            type="button"
            [attr.data-testid]="'theme-' + mode"
            [attr.aria-pressed]="theme.mode() === mode"
            (click)="theme.setMode(mode)"
            class="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 aria-pressed:bg-slate-200 dark:border-slate-600 dark:hover:bg-slate-700 dark:focus-visible:outline-blue-400 dark:aria-pressed:bg-slate-600"
          >
            {{ 'theme.mode.' + mode | transloco }}
          </button>
        }
      </div>
    </section>
    <section class="mt-6" aria-labelledby="system-heading">
      <h2 id="system-heading" class="mb-2 font-medium">
        {{ 'settings.system.label' | transloco }}
      </h2>
      @if (!available) {
        <p class="mb-2 text-sm text-slate-600 dark:text-slate-400">
          {{ 'settings.system.unavailable' | transloco }}
        </p>
      }
      <div class="flex flex-col items-start gap-3">
        <button
          type="button"
          data-testid="test-notification"
          [disabled]="!available"
          (click)="sendTestNotification()"
          class="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700 dark:focus-visible:outline-blue-400"
        >
          {{ 'settings.system.testNotification' | transloco }}
        </button>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            data-testid="autostart-toggle"
            [checked]="autostart()"
            [disabled]="!available || autostartBusy()"
            (change)="toggleAutostart($event)"
          />
          {{ 'settings.system.autostart' | transloco }}
        </label>
        @if (error()) {
          <p role="alert" class="text-sm text-red-700 dark:text-red-400">
            {{ 'settings.system.error' | transloco }}
          </p>
        }
      </div>
    </section>
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
