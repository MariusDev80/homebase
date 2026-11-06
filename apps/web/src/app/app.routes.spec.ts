import { TestBed } from '@angular/core/testing';
import { NavigationError, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideAppI18n } from './core/i18n';
import { LAST_DASHBOARD_SETTING } from './core/dashboard/dashboard-list.store';
import { FakeDashboardRepository } from './core/testing/fake-dashboard.repository';
import { FakeSettingsRepository } from './core/testing/fake-settings.repository';
import { FakeWidgetInstanceRepository } from './core/testing/fake-widget-instance.repository';
import {
  DASHBOARD_REPOSITORY,
  DataError,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
} from './data';
import { routes } from './app.routes';
import { provideAllWidgets } from './widgets/widgets.providers';

describe('routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideAppI18n(),
        provideRouter(routes),
        ...provideAllWidgets(),
        { provide: DASHBOARD_REPOSITORY, useClass: FakeDashboardRepository },
        { provide: SETTINGS_REPOSITORY, useClass: FakeSettingsRepository },
        { provide: WIDGET_INSTANCE_REPOSITORY, useClass: FakeWidgetInstanceRepository },
      ],
    });
  });

  const dashboards = () => TestBed.inject(DASHBOARD_REPOSITORY) as FakeDashboardRepository;
  const settings = () => TestBed.inject(SETTINGS_REPOSITORY) as FakeSettingsRepository;

  it('redirects unknown paths to the first dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/does/not/exist');
    expect(TestBed.inject(Router).url).toBe('/dashboards/dashboard-1');
  });

  it('redirects the root path to the dashboard and renders it', async () => {
    const harness = await RouterTestingHarness.create('/');
    expect(TestBed.inject(Router).url).toBe('/dashboards/dashboard-1');
    await vi.waitFor(() => {
      harness.detectChanges();
      expect((harness.routeNativeElement as HTMLElement).textContent).toContain(
        "Aucun widget pour l'instant.",
      );
    });
  });

  it('sends an unknown id to the first dashboard when nothing was opened', async () => {
    await dashboards().createIfNone({ name: 'Accueil' });
    await dashboards().create({ name: 'Autre' });
    await RouterTestingHarness.create('/dashboards/unknown');
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/dashboards/dashboard-1'));
  });

  it('sends the root path and an unknown id to the last opened dashboard', async () => {
    await dashboards().createIfNone({ name: 'Accueil' });
    const other = await dashboards().create({ name: 'Autre' });
    settings().values.set(LAST_DASHBOARD_SETTING, other.id);
    await RouterTestingHarness.create('/');
    expect(TestBed.inject(Router).url).toBe(`/dashboards/${other.id}`);
    await TestBed.inject(Router).navigateByUrl('/dashboards/unknown');
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe(`/dashboards/${other.id}`));
  });

  it('opens the dashboard of the URL (reload) and remembers it', async () => {
    await dashboards().createIfNone({ name: 'Accueil' });
    const other = await dashboards().create({ name: 'Autre' });
    await RouterTestingHarness.create(`/dashboards/${other.id}`);
    expect(TestBed.inject(Router).url).toBe(`/dashboards/${other.id}`);
    await vi.waitFor(() => expect(settings().values.get(LAST_DASHBOARD_SETTING)).toBe(other.id));
  });

  it('shows the error page on a data error, without a NavigationError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repository = dashboards();
    const error = new DataError('unavailable', 'no db');
    vi.spyOn(repository, 'createIfNone').mockRejectedValue(error);
    vi.spyOn(repository, 'list').mockRejectedValue(error);
    vi.spyOn(repository, 'get').mockRejectedValue(error);
    const failures: unknown[] = [];
    TestBed.inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationError) failures.push(event.error);
    });
    const harness = await RouterTestingHarness.create('/');
    await vi.waitFor(() => {
      harness.detectChanges();
      expect((harness.routeNativeElement as HTMLElement).textContent).toContain(
        'Impossible de charger le tableau de bord.',
      );
    });
    expect(failures).toEqual([]);
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('serves the settings page', async () => {
    const harness = await RouterTestingHarness.create('/settings');
    await vi.waitFor(() =>
      expect((harness.routeNativeElement as HTMLElement).textContent).toContain('Réglages'),
    );
  });
});
