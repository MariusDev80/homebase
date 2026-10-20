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

async function render(
  configure?: (dashboards: FakeDashboardRepository) => void,
  definitions: WidgetDefinition[] = [fixtureDefinition({ type: 'fixture' }) as WidgetDefinition],
) {
  const dashboards = new FakeDashboardRepository();
  const instances = new FakeWidgetInstanceRepository();
  configure?.(dashboards);
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      ...definitions.map((d) => provideWidget(d)),
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
  document.body.appendChild(fixture.nativeElement);
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

  describe('add widget menu', () => {
    const key = (el: HTMLElement, name: string): void => {
      (document.activeElement ?? el).dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
      );
    };
    const trigger = (el: HTMLElement) =>
      el.querySelector('[data-testid="add-widget"]') as HTMLButtonElement;
    const items = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

    const three = [
      fixtureDefinition({ type: 'aa' }),
      fixtureDefinition({ type: 'bb', maxInstances: 1 }),
      fixtureDefinition({ type: 'cc' }),
    ] as WidgetDefinition[];

    /** Renders with 'bb' already added, so its menu entry is disabled; the menu is left closed. */
    const renderWithLimit = async () => {
      const ctx = await render(undefined, three);
      trigger(ctx.el).click();
      ctx.fixture.detectChanges();
      (ctx.el.querySelector('[data-testid="add-bb"]') as HTMLButtonElement).click();
      await vi.waitFor(() => {
        ctx.fixture.detectChanges();
        expect(ctx.el.querySelector('[role="menu"]')).toBeNull();
      });
      return ctx;
    };

    it('exposes ARIA roles and state', async () => {
      const { fixture, el } = await renderWithLimit();
      expect(trigger(el).getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
      trigger(el).click();
      fixture.detectChanges();
      expect(trigger(el).getAttribute('aria-expanded')).toBe('true');
      expect(el.querySelector('[role="menu"]')).not.toBeNull();
      expect(items(el)).toHaveLength(3);
    });

    it('focuses the first enabled item on open and navigates with arrows, skipping disabled', async () => {
      const { fixture, el } = await renderWithLimit();
      trigger(el).click();
      fixture.detectChanges();
      await fixture.whenStable();
      const [a, b, c] = items(el);
      expect(b.disabled).toBe(true);
      expect(document.activeElement).toBe(a);
      key(el, 'ArrowDown');
      expect(document.activeElement).toBe(c);
      key(el, 'ArrowDown');
      expect(document.activeElement).toBe(a);
      key(el, 'ArrowUp');
      expect(document.activeElement).toBe(c);
    });

    it('opens from the trigger with ArrowDown and focuses the first enabled item', async () => {
      const { fixture, el } = await renderWithLimit();
      trigger(el).focus();
      key(el, 'ArrowDown');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(items(el)[0]).toBe(document.activeElement);
    });

    it('jumps to the first and last enabled items with Home and End', async () => {
      const { fixture, el } = await renderWithLimit();
      trigger(el).click();
      fixture.detectChanges();
      await fixture.whenStable();
      const [a, , c] = items(el);
      key(el, 'End');
      expect(document.activeElement).toBe(c);
      key(el, 'Home');
      expect(document.activeElement).toBe(a);
    });

    it('closes on Tab', async () => {
      const { fixture, el } = await renderWithLimit();
      trigger(el).click();
      fixture.detectChanges();
      await fixture.whenStable();
      key(el, 'Tab');
      fixture.detectChanges();
      expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it('activates the focused item on click (Enter on a button)', async () => {
      const { fixture, el } = await render(undefined, three);
      trigger(el).click();
      fixture.detectChanges();
      await fixture.whenStable();
      (document.activeElement as HTMLButtonElement).click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelectorAll('app-widget-host')).toHaveLength(1);
      });
      expect(document.activeElement).toBe(trigger(el));
    });

    it('refocuses the first enabled item after a failed add', async () => {
      const { fixture, el, instances } = await render(undefined, three);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      trigger(el).click();
      fixture.detectChanges();
      await fixture.whenStable();
      instances.failNext(new DataError('busy', 'locked'));
      items(el)[0].click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('[data-testid="dashboard-add-error"]')).not.toBeNull();
        expect(document.activeElement).toBe(items(el)[0]);
      });
    });

    it('moves the focus to the add button after a widget is removed', async () => {
      const { fixture, el } = await renderWithLimit();
      (el.querySelector('[data-testid="widget-remove"]') as HTMLButtonElement).click();
      let accept: HTMLButtonElement | undefined;
      await vi.waitFor(() => {
        fixture.detectChanges();
        accept = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
          (b) =>
            b.textContent?.trim() === 'Supprimer' &&
            b.closest('[role="alertdialog"], [role="dialog"]'),
        );
        expect(accept).toBeDefined();
      });
      accept?.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelectorAll('app-widget-host')).toHaveLength(0);
        expect(document.activeElement).toBe(trigger(el));
      });
    });

    it('closes on Escape and gives the focus back to the trigger', async () => {
      const { fixture, el } = await renderWithLimit();
      trigger(el).click();
      fixture.detectChanges();
      await fixture.whenStable();
      key(el, 'Escape');
      fixture.detectChanges();
      expect(el.querySelector('[role="menu"]')).toBeNull();
      expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger(el));
    });

    it('closes on outside click but not on inside click', async () => {
      const { fixture, el } = await renderWithLimit();
      trigger(el).click();
      fixture.detectChanges();
      el.querySelector('[role="menu"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('[role="menu"]')).not.toBeNull();
      document.body.click();
      fixture.detectChanges();
      expect(el.querySelector('[role="menu"]')).toBeNull();
    });
  });
});
