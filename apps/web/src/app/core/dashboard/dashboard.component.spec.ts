import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DASHBOARD_REPOSITORY, DataError, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { provideAppI18n } from '../i18n';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from '../widgets/widget-definition';
import { provideWidget } from '../widgets/widget-registry';
import { DashboardComponent } from './dashboard.component';

async function render(configure?: (dashboards: FakeDashboardRepository) => void) {
  const dashboards = new FakeDashboardRepository();
  const instances = new FakeWidgetInstanceRepository();
  configure?.(dashboards);
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      provideWidget(fixtureDefinition({ type: 'fixture' }) as WidgetDefinition),
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(DashboardComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, dashboards, instances };
}

describe('DashboardComponent', () => {
  it('creates the default dashboard and shows the empty state', async () => {
    const { el, dashboards } = await render();
    expect(dashboards.items.map((d) => d.name)).toEqual(['Accueil']);
    expect(el.querySelector('[data-testid="dashboard-empty"]')?.textContent).toContain(
      "Aucun widget pour l'instant.",
    );
  });

  it('adds a widget from the menu and places it on the grid', async () => {
    const { fixture, el } = await render();
    (el.querySelector('[data-testid="add-widget"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="add-fixture"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    await vi.waitFor(() => {
      fixture.detectChanges();
      const host = el.querySelector('app-widget-host') as HTMLElement;
      expect(host.style.gridColumn).toContain('1 / span 2');
      expect(host.style.gridRow).toContain('1 / span 2');
    });
  });

  it('shows a translated error when adding fails, without an unhandled rejection', async () => {
    const { fixture, el, instances } = await render();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (el.querySelector('[data-testid="add-widget"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    instances.failNext(new DataError('busy', 'locked'));
    (el.querySelector('[data-testid="add-fixture"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="dashboard-add-error"]')?.textContent).toContain(
        "Impossible d'ajouter ce widget.",
      );
    });
  });

  it('shows the load error', async () => {
    const { el } = await render((dashboards) =>
      dashboards.failNext(new DataError('unavailable', 'no db')),
    );
    expect(el.querySelector('[data-testid="dashboard-error"]')?.textContent).toContain(
      'Impossible de charger le tableau de bord.',
    );
  });
});
