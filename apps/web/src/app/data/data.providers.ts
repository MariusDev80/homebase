import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { isTauriRuntime } from '../tauri-runtime';
import { Clock, randomUuid, systemClock } from './clock';
import type { SqlExecutor } from './sql-executor';
import { DataError } from './data-error';
import { DashboardRepository, SettingsRepository, WidgetInstanceRepository } from './repositories';
import { DataLayerHealth, GuardedSqlExecutor } from './sqlite/guarded-sql-executor';
import { TauriDashboardRepository } from './tauri/tauri-dashboard.repository';
import { TauriSettingsRepository } from './tauri/tauri-settings.repository';
import { TauriWidgetInstanceRepository } from './tauri/tauri-widget-instance.repository';
import { TauriSqlExecutor } from './sqlite/tauri-sql-executor';

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
 * The guarded SQL executor shared by every SQLite repository. Provided by provideDataLayer();
 * the lazy content repositories (data/content.tokens.ts) build on it.
 */
export const SQL_EXECUTOR = new InjectionToken<SqlExecutor>('SQL_EXECUTOR');

/**
 * Wires the Rust-command repositories (settings, dashboards, widget instances). The guarded SQL
 * executor stays, without initialiser (the Rust side owns migrations and WAL), until the content
 * repositories move to commands (lot TC3). Outside Tauri it rejects with DataError('unavailable').
 */
export function provideDataLayer(): EnvironmentProviders {
  // Created lazily: Database.get() needs the Tauri IPC bridge.
  let executor: TauriSqlExecutor | undefined;
  const getExecutor = (): TauriSqlExecutor => {
    if (!isTauriRuntime()) {
      throw new DataError('unavailable', 'Homebase doit être lancé via Tauri');
    }
    return (executor ??= new TauriSqlExecutor());
  };
  const guarded = new GuardedSqlExecutor(new DataLayerHealth(), getExecutor);

  return makeEnvironmentProviders([
    { provide: SETTINGS_REPOSITORY, useFactory: () => new TauriSettingsRepository(randomUuid) },
    { provide: DASHBOARD_REPOSITORY, useFactory: () => new TauriDashboardRepository(randomUuid) },
    {
      provide: WIDGET_INSTANCE_REPOSITORY,
      useFactory: () => new TauriWidgetInstanceRepository(randomUuid),
    },
    { provide: SQL_EXECUTOR, useValue: guarded },
  ]);
}
