import {
  EnvironmentProviders,
  InjectionToken,
  isDevMode,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { isTauriRuntime } from '../tauri-runtime';
import { randomUuid, systemClock } from './clock';
import { DataError } from './data-error';
import {
  DashboardRepository,
  NoteRepository,
  SettingsRepository,
  ShortcutRepository,
  WidgetInstanceRepository,
} from './repositories';
import { DataLayerHealth, GuardedSqlExecutor } from './sqlite/guarded-sql-executor';
import { initDatabase } from './sqlite/database-bootstrap';
import { SqliteDashboardRepository } from './sqlite/sqlite-dashboard.repository';
import { SqliteNoteRepository } from './sqlite/sqlite-note.repository';
import { SqliteSettingsRepository } from './sqlite/sqlite-settings.repository';
import { SqliteShortcutRepository } from './sqlite/sqlite-shortcut.repository';
import { SqliteWidgetInstanceRepository } from './sqlite/sqlite-widget-instance.repository';
import { TauriSqlExecutor } from './sqlite/tauri-sql-executor';

export const SETTINGS_REPOSITORY = new InjectionToken<SettingsRepository>('SETTINGS_REPOSITORY');
export const DASHBOARD_REPOSITORY = new InjectionToken<DashboardRepository>('DASHBOARD_REPOSITORY');
export const WIDGET_INSTANCE_REPOSITORY = new InjectionToken<WidgetInstanceRepository>(
  'WIDGET_INSTANCE_REPOSITORY',
);

export const NOTE_REPOSITORY = new InjectionToken<NoteRepository>('NOTE_REPOSITORY');
export const SHORTCUT_REPOSITORY = new InjectionToken<ShortcutRepository>('SHORTCUT_REPOSITORY');

/**
 * Wires the SQLite repositories on top of tauri-plugin-sql and runs the bootstrap
 * (WAL) at application start. The initializer never rejects: a failure (outside Tauri
 * `DataError('unavailable')`, WAL error...) is memorised and rethrown by the repositories
 * on every call, so the application still starts and shows an error.
 */
export function provideDataLayer(): EnvironmentProviders {
  // Created lazily: Database.get() needs the Tauri IPC bridge.
  let executor: TauriSqlExecutor | undefined;
  const getExecutor = (): TauriSqlExecutor => (executor ??= new TauriSqlExecutor());
  const health = new DataLayerHealth();
  const guarded = new GuardedSqlExecutor(health, getExecutor);

  return makeEnvironmentProviders([
    {
      provide: SETTINGS_REPOSITORY,
      useFactory: () => new SqliteSettingsRepository(guarded, systemClock, randomUuid),
    },
    {
      provide: DASHBOARD_REPOSITORY,
      useFactory: () => new SqliteDashboardRepository(guarded, systemClock, randomUuid),
    },
    {
      provide: WIDGET_INSTANCE_REPOSITORY,
      useFactory: () => new SqliteWidgetInstanceRepository(guarded, systemClock, randomUuid),
    },
    {
      provide: NOTE_REPOSITORY,
      useFactory: () => new SqliteNoteRepository(guarded, systemClock, randomUuid),
    },
    {
      provide: SHORTCUT_REPOSITORY,
      useFactory: () => new SqliteShortcutRepository(guarded, systemClock, randomUuid),
    },
    provideAppInitializer(() =>
      health.initialize(() => {
        if (!isTauriRuntime()) {
          throw new DataError('unavailable', 'Homebase doit être lancé via Tauri');
        }
        return initDatabase(guarded, isDevMode());
      }),
    ),
  ]);
}
