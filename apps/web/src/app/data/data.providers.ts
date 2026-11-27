import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { Clock, randomUuid, systemClock } from './clock';
import { DashboardRepository, SettingsRepository, WidgetInstanceRepository } from './repositories';
import { TauriDashboardRepository } from './tauri/tauri-dashboard.repository';
import { TauriSettingsRepository } from './tauri/tauri-settings.repository';
import { TauriWidgetInstanceRepository } from './tauri/tauri-widget-instance.repository';

/**
 * The single source of "now" for display and front-side calculations. The stored created_at /
 * updated_at come from the Rust clock (spec typed-data-commands 4.9).
 */
export const CLOCK = new InjectionToken<Clock>('CLOCK', {
  providedIn: 'root',
  factory: () => systemClock,
});

export const SETTINGS_REPOSITORY = new InjectionToken<SettingsRepository>('SETTINGS_REPOSITORY');
export const DASHBOARD_REPOSITORY = new InjectionToken<DashboardRepository>('DASHBOARD_REPOSITORY');
export const WIDGET_INSTANCE_REPOSITORY = new InjectionToken<WidgetInstanceRepository>(
  'WIDGET_INSTANCE_REPOSITORY',
);

/**
 * Wires the Rust-command repositories (settings, dashboards, widget instances). The content
 * repositories (todo, note, shortcut) are lazy: see data/content.tokens.ts. Outside Tauri every
 * call rejects with DataError('unavailable').
 */
export function provideDataLayer(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: SETTINGS_REPOSITORY, useFactory: () => new TauriSettingsRepository(randomUuid) },
    { provide: DASHBOARD_REPOSITORY, useFactory: () => new TauriDashboardRepository(randomUuid) },
    {
      provide: WIDGET_INSTANCE_REPOSITORY,
      useFactory: () => new TauriWidgetInstanceRepository(randomUuid),
    },
  ]);
}
