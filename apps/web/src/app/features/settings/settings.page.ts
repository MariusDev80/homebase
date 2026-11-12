import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BackupSettingsComponent } from './backup-settings.component';
import { ConfigTransferSettingsComponent } from './config-transfer-settings.component';
import { SPIKE_TOOLS_ENABLED, SystemService } from '../../core/system';
import { THEME_MODES, ThemeService } from '../../core/theme';
import { UserTimeZone } from '../../core/time';

const TEST_NOTIFICATION_DELAY_SECS = 10;

@Component({
  selector: 'app-settings-page',
  imports: [TranslocoPipe, BackupSettingsComponent, ConfigTransferSettingsComponent],
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
      <section class="box mt-4" aria-labelledby="timezone-heading">
        <header class="box-header">
          <i class="pi pi-clock" aria-hidden="true"></i>
          <h2 id="timezone-heading">{{ 'settings.timeZone.label' | transloco }}</h2>
        </header>
        <div class="box-body flex flex-col items-start gap-3">
          <p data-testid="timezone-effective">
            {{ 'settings.timeZone.effective' | transloco: { zone: timeZone.id() } }}
            <span class="text-xs text-fg-muted">({{ sourceKey() | transloco }})</span>
          </p>
          <label class="flex flex-col items-start gap-1">
            {{ 'settings.timeZone.label' | transloco }}
            <select class="field" data-testid="timezone-select" (change)="selectTimeZone($event)">
              <option value="" [selected]="timeZone.preference() === null">
                {{ 'settings.timeZone.followSystem' | transloco: { zone: timeZone.systemId() } }}
              </option>
              @for (zone of zones(); track zone) {
                <option [value]="zone" [selected]="zone === timeZone.preference()">
                  {{ zone }}
                </option>
              }
            </select>
          </label>
          @if (timeZone.invalidPreference() !== null) {
            <p role="alert" class="flash flash-attention" data-testid="timezone-invalid">
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              {{
                'settings.timeZone.invalidStored'
                  | transloco: { value: timeZone.invalidPreference() }
              }}
            </p>
          }
          @if (timeZone.source() === 'fallback-utc') {
            <p role="alert" class="flash flash-attention" data-testid="timezone-fallback">
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              {{ 'settings.timeZone.fallbackUtc' | transloco }}
            </p>
          }
          @if (timeZoneError()) {
            <p role="alert" class="flash flash-danger" data-testid="timezone-error">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              {{ 'settings.timeZone.error' | transloco }}
            </p>
          }
        </div>
      </section>
      <app-backup-settings />
      <app-config-transfer-settings />
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
            @if (spikeTools) {
              <button
                type="button"
                data-testid="test-notification"
                [disabled]="!available"
                (click)="sendTestNotification()"
                class="btn"
              >
                {{ 'settings.system.testNotification' | transloco }}
              </button>
            }
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
  protected readonly timeZone = inject(UserTimeZone);
  protected readonly modes = THEME_MODES;
  protected readonly timeZoneError = signal(false);
  protected readonly zones = computed(() => this.timeZone.availableTimeZones());
  protected readonly sourceKey = computed(() => {
    const source = this.timeZone.source();
    if (source === 'setting') return 'settings.timeZone.sourceSetting';
    return source === 'system'
      ? 'settings.timeZone.sourceSystem'
      : 'settings.timeZone.sourceFallback';
  });
  protected readonly spikeTools = inject(SPIKE_TOOLS_ENABLED);

  protected readonly available = this.system.isAvailable();
  protected readonly autostart = signal(false);
  protected readonly autostartBusy = signal(false);
  protected readonly error = signal(false);

  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  constructor() {
    // Anchor links (`/settings#backups`): done here rather than with the router's scrolling option.
    const subscription = this.route.fragment.subscribe((fragment) => {
      if (fragment === null) return;
      setTimeout(() => this.document.getElementById(fragment)?.scrollIntoView?.());
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  ngOnInit(): void {
    if (!this.available) {
      return;
    }
    this.system.getAutostart().then(
      (enabled) => this.autostart.set(enabled),
      () => this.error.set(true),
    );
  }

  protected selectTimeZone(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    this.timeZoneError.set(false);
    this.timeZone.setPreference(value === '' ? null : value).catch(() => {
      this.timeZoneError.set(true);
      select.value = this.timeZone.preference() ?? '';
    });
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
