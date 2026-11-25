import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import {
  DASHBOARD_REPOSITORY,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
  provideDataLayer,
} from './data.providers';
import { TauriDashboardRepository } from './tauri/tauri-dashboard.repository';
import { TauriSettingsRepository } from './tauri/tauri-settings.repository';
import { TauriWidgetInstanceRepository } from './tauri/tauri-widget-instance.repository';

vi.mock('../tauri-runtime', () => ({ isTauriRuntime: () => false }));

function injector(): EnvironmentInjector {
  return createEnvironmentInjector(
    [provideDataLayer()],
    // Root-less parent: the environment injector only needs the providers above.
    undefined as unknown as EnvironmentInjector,
  );
}

describe('provideDataLayer', () => {
  it('provides the Rust-command repositories for settings, dashboards and widget instances', () => {
    const di = injector();
    expect(di.get(SETTINGS_REPOSITORY)).toBeInstanceOf(TauriSettingsRepository);
    expect(di.get(DASHBOARD_REPOSITORY)).toBeInstanceOf(TauriDashboardRepository);
    expect(di.get(WIDGET_INSTANCE_REPOSITORY)).toBeInstanceOf(TauriWidgetInstanceRepository);
  });

  it('repositories are unavailable outside Tauri', async () => {
    await expect(injector().get(SETTINGS_REPOSITORY).get('a')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
