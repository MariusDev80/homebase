import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideAppI18n } from './core/i18n';
import { FakeDashboardRepository } from './core/testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from './core/testing/fake-widget-instance.repository';
import { DASHBOARD_REPOSITORY, WIDGET_INSTANCE_REPOSITORY } from './data';
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
        { provide: WIDGET_INSTANCE_REPOSITORY, useClass: FakeWidgetInstanceRepository },
      ],
    });
  });

  it('redirects unknown paths to the dashboard', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/does/not/exist');
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('renders the dashboard on the root path', async () => {
    const harness = await RouterTestingHarness.create('/');
    await vi.waitFor(() => {
      harness.detectChanges();
      expect((harness.routeNativeElement as HTMLElement).textContent).toContain(
        "Aucun widget pour l'instant.",
      );
    });
  });

  it('serves the settings page', async () => {
    const harness = await RouterTestingHarness.create('/settings');
    await vi.waitFor(() =>
      expect((harness.routeNativeElement as HTMLElement).textContent).toContain('Réglages'),
    );
  });
});
