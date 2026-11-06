import { ApplicationInitStatus, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DASHBOARD_REPOSITORY, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import type { WidgetInstanceRecord } from '../../data';
import { DashboardStore } from '../dashboard/dashboard.store';
import { WidgetFocus } from '../dashboard/widget-focus';
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
      provideRouter([]),
      provideWidget(definition),
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const store = TestBed.inject(DashboardStore);
  await store.open(null, 'Accueil');
  const dashboardId = store.dashboard()?.id as string;

  async function render(partial: Partial<WidgetInstanceRecord>) {
    const record = instances.seed({ dashboardId, widgetType: 'fixture', ...partial });
    await store.open(null, 'Accueil');
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

/** The confirm dialog is rendered in an overlay (document.body), not inside the host. */
async function confirmDialogButton(
  fixture: { detectChanges(): void },
  label: string,
): Promise<HTMLButtonElement> {
  let found: HTMLButtonElement | undefined;
  await vi.waitFor(() => {
    fixture.detectChanges();
    found = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button, [role="dialog"] button',
      ),
    ).find((b) => b.textContent?.trim() === label);
    expect(found).toBeDefined();
  });
  return found as HTMLButtonElement;
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
    await confirmDialogButton(fixture, 'Supprimer').then((button) => button.click());
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="widget-action-error"]')?.textContent).toContain(
        "L'opération a échoué.",
      );
    });
  });

  it('asks for confirmation before removing and removes on accept', async () => {
    const { render, store } = await setup();
    const remove = vi.spyOn(store, 'remove');
    const { fixture, el, record } = await render({ config: { label: 'x' } });
    (el.querySelector('[data-testid="widget-remove"]') as HTMLButtonElement).click();
    await confirmDialogButton(fixture, 'Annuler');
    expect(document.body.textContent).toContain('Supprimer ce widget ?');
    expect(document.body.querySelector('.p-dialog-close-button')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    (await confirmDialogButton(fixture, 'Supprimer')).click();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(record.id));
  });

  it('uses the definition removeConfirmKey as confirmation message', async () => {
    const { render } = await setup(
      fixtureDefinition({ removeConfirmKey: 'widgets.notes.removeConfirm' }) as WidgetDefinition,
    );
    const { fixture, el } = await render({ config: { label: 'x' } });
    (el.querySelector('[data-testid="widget-remove"]') as HTMLButtonElement).click();
    await confirmDialogButton(fixture, 'Annuler');
    expect(document.body.textContent).toContain('Supprimer ce widget et sa note ?');
  });

  it('returns the focus to the trash button on cancel and on Escape', async () => {
    const { render } = await setup();
    const { fixture, el } = await render({ config: { label: 'x' } });
    const trash = el.querySelector('[data-testid="widget-remove"]') as HTMLButtonElement;
    trash.click();
    (await confirmDialogButton(fixture, 'Annuler')).click();
    await vi.waitFor(() => expect(document.activeElement).toBe(trash));

    document.body.focus();
    trash.click();
    const cancel = await confirmDialogButton(fixture, 'Annuler');
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(document.activeElement).toBe(trash));
  });

  it('does nothing when the removal is cancelled', async () => {
    const { render, store, instances } = await setup();
    const remove = vi.spyOn(store, 'remove');
    const { fixture, el, record } = await render({ config: { label: 'x' } });
    (el.querySelector('[data-testid="widget-remove"]') as HTMLButtonElement).click();
    (await confirmDialogButton(fixture, 'Annuler')).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(remove).not.toHaveBeenCalled();
    expect(await instances.get(record.id)).not.toBeNull();
    expect(el.querySelector('[data-testid="widget-action-error"]')).toBeNull();
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

describe('WidgetHostComponent focus request', () => {
  afterEach(() => vi.useRealTimers());

  it('scrolls to, focuses and briefly highlights the requested instance only', async () => {
    const { render, store } = await setup();
    const { fixture, el, record } = await render({ config: { label: 'x' } });
    const scroll = vi.fn();
    document.body.appendChild(el);
    (el.querySelector('app-widget-host') as HTMLElement).scrollIntoView = scroll;
    const card = el.querySelector('[data-testid="widget-card"]') as HTMLElement;
    const focus = TestBed.inject(WidgetFocus);

    expect(focus.focusInstance('ghost')).toBe('not-found');
    fixture.detectChanges();
    expect(card.classList.contains('is-highlighted')).toBe(false);

    vi.useFakeTimers();
    expect(focus.focusInstance(record.id)).toBe('focused');
    expect(store.instances().some((i) => i.id === record.id)).toBe(true);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(card);
    expect(card.classList.contains('is-highlighted')).toBe(true);

    await vi.advanceTimersByTimeAsync(2100);
    fixture.detectChanges();
    expect(card.classList.contains('is-highlighted')).toBe(false);
  });
});
