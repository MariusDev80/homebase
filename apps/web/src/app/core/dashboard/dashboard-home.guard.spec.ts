import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import {
  DASHBOARD_REPOSITORY,
  DataError,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
} from '../../data';
import { provideAppI18n } from '../i18n';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { LAST_DASHBOARD_SETTING } from './dashboard-list.store';
import { dashboardHomeGuard } from './dashboard-home.guard';

async function setup() {
  const dashboards = new FakeDashboardRepository();
  const settings = new FakeSettingsRepository();
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      provideRouter([]),
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: SETTINGS_REPOSITORY, useValue: settings },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: new FakeWidgetInstanceRepository() },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const run = () =>
    TestBed.runInInjectionContext(() =>
      dashboardHomeGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  return { dashboards, settings, run };
}

describe('dashboardHomeGuard', () => {
  it('redirects to the first dashboard, creating it on a fresh database', async () => {
    const { dashboards, run } = await setup();
    const result = await run();
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      `/dashboards/${dashboards.items[0].id}`,
    );
    expect(dashboards.items[0].name).toBe('Accueil');
  });

  it('redirects to the last opened dashboard', async () => {
    const { dashboards, settings, run } = await setup();
    await dashboards.createIfNone({ name: 'Accueil' });
    const other = await dashboards.create({ name: 'Autre' });
    settings.values.set(LAST_DASHBOARD_SETTING, other.id);
    const result = await run();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(`/dashboards/${other.id}`);
  });

  it('lets the navigation through on a data error', async () => {
    const { dashboards, run } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dashboards.failNext(new DataError('unavailable', 'no db'));
    await expect(run()).resolves.toBe(true);
  });

  it('lets the navigation through when anything throws', async () => {
    const { dashboards, run } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(dashboards, 'createIfNone').mockImplementation(() => {
      throw new Error('sync boom');
    });
    await expect(run()).resolves.toBe(true);
  });
});
