import { ApplicationInitStatus, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DASHBOARD_REPOSITORY, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import type { WidgetInstanceRecord } from '../../data';
import { DashboardStore } from '../dashboard/dashboard.store';
import { provideAppI18n } from '../i18n';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { FixtureWidgetComponent, fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from './widget-definition';
import { WidgetHostComponent } from './widget-host.component';
import { provideWidget } from './widget-registry';

@Component({
  imports: [WidgetHostComponent],
  template: '<app-widget-host [instance]="instance" />',
})
class TestHostComponent {
  instance!: WidgetInstanceRecord;
}

async function setup(definition: WidgetDefinition = fixtureDefinition() as WidgetDefinition) {
  const dashboards = new FakeDashboardRepository();
  const instances = new FakeWidgetInstanceRepository();
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      provideWidget(definition),
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const store = TestBed.inject(DashboardStore);
  await store.load('Accueil');
  const dashboardId = store.dashboard()?.id as string;

  async function render(partial: Partial<WidgetInstanceRecord>) {
    const record = instances.seed({ dashboardId, widgetType: 'fixture', ...partial });
    await store.load('Accueil');
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.instance = record;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, record };
  }
  return { render, store, instances };
}

describe('WidgetHostComponent', () => {
  it('renders the widget component with its context', async () => {
    const { render } = await setup();
    const { el } = await render({ config: { label: 'hello there' } });
    expect(el.querySelector('[data-testid="fixture-label"]')?.textContent).toBe('hello there');
    expect(el.textContent).toContain('Bonjour');
  });

  it('shows a placeholder for an unknown type', async () => {
    const { render } = await setup();
    const { el } = await render({ widgetType: 'ghost', config: {} });
    expect(el.querySelector('[data-testid="widget-unknown"]')?.textContent).toContain(
      'Widget inconnu : ghost',
    );
  });

  it('shows an invalid config placeholder and resets it', async () => {
    const { render, store } = await setup();
    const reset = vi.spyOn(store, 'resetConfig');
    const { el, record } = await render({ config: { label: 42 } });
    expect(el.querySelector('[data-testid="widget-invalid"]')?.textContent).toContain(
      'Configuration invalide',
    );
    (el.querySelector('[data-testid="widget-reset"]') as HTMLButtonElement).click();
    expect(reset).toHaveBeenCalledWith(record.id);
  });

  it('shows a translated error when removing fails', async () => {
    const { render, instances } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture, el } = await render({ config: { label: 'x' } });
    instances.failNext(new Error('db down'));
    (el.querySelector('[data-testid="widget-remove"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="widget-action-error"]')?.textContent).toContain(
        "L'opération a échoué.",
      );
    });
  });

  it('offers no reset for a future config version', async () => {
    const { render } = await setup();
    const { el } = await render({ configVersion: 99, config: { label: 'x' } });
    expect(el.textContent).toContain('version plus récente');
    expect(el.querySelector('[data-testid="widget-reset"]')).toBeNull();
  });

  it('shows a load error and retries', async () => {
    const loadComponent = vi
      .fn<WidgetDefinition['loadComponent']>()
      .mockRejectedValueOnce(new Error('chunk'))
      .mockResolvedValue(FixtureWidgetComponent);
    const { render } = await setup(fixtureDefinition({ loadComponent }) as WidgetDefinition);
    const { fixture, el } = await render({ config: { label: 'back' } });
    expect(el.querySelector('[data-testid="widget-load-error"]')).not.toBeNull();
    (el.querySelector('[data-testid="widget-retry"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="fixture-label"]')?.textContent).toBe('back');
    });
    expect(loadComponent).toHaveBeenCalledTimes(2);
  });
});
