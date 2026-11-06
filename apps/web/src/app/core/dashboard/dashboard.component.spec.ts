import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { LAST_DASHBOARD_SETTING } from './dashboard-list.store';
import { DashboardStore } from './dashboard.store';
import {
  DASHBOARD_REPOSITORY,
  DataError,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
} from '../../data';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { provideAppI18n } from '../i18n';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from '../widgets/widget-definition';
import { provideWidget } from '../widgets/widget-registry';
import { DashboardComponent } from './dashboard.component';
import type { DashboardGridItem } from './grid-adapter';
import { By } from '@angular/platform-browser';
import { Gridster, GridsterItem } from 'angular-gridster2';
import type { ComponentFixture } from '@angular/core/testing';

function gridItem(fixture: ComponentFixture<DashboardComponent>, index = 0): DashboardGridItem {
  return fixture.debugElement.queryAll(By.directive(GridsterItem))[index].componentInstance.item();
}
function gridOptions(fixture: ComponentFixture<DashboardComponent>) {
  return fixture.debugElement.query(By.directive(Gridster)).componentInstance.options();
}

function routeFor(id: string) {
  return { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id })) } };
}

async function render(
  configure?: (dashboards: FakeDashboardRepository) => void,
  definitions: WidgetDefinition[] = [fixtureDefinition({ type: 'fixture' }) as WidgetDefinition],
) {
  const dashboards = new FakeDashboardRepository();
  const instances = new FakeWidgetInstanceRepository();
  await dashboards.createIfNone({ name: 'Accueil' });
  configure?.(dashboards);
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      provideRouter([]),
      routeFor(dashboards.items[0].id),
      ...definitions.map((d) => provideWidget(d)),
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
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
  it('opens the dashboard of the route and shows the empty state', async () => {
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
      const item = gridItem(fixture);
      expect(item).toMatchObject({ x: 0, y: 0, cols: 2, rows: 2 });
      expect(item).toMatchObject({
        minItemCols: 1,
        maxItemCols: 4,
        minItemRows: 1,
        maxItemRows: 4,
      });
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

  describe('layout editing', () => {
    const seeded = async () => {
      const dashboards = new FakeDashboardRepository();
      const instances = new FakeWidgetInstanceRepository();
      await dashboards.createIfNone({ name: 'Accueil' });
      const [dashboard] = await dashboards.list();
      instances.seed({
        dashboardId: dashboard.id,
        widgetType: 'fixture',
        grid: { x: 0, y: 0, w: 2, h: 2 },
      });
      instances.seed({
        dashboardId: dashboard.id,
        widgetType: 'fixture',
        grid: { x: 4, y: 0, w: 2, h: 2 },
      });
      TestBed.configureTestingModule({
        providers: [
          provideAppI18n(),
          provideRouter([]),
          routeFor(dashboard.id),
          provideWidget(fixtureDefinition({ type: 'fixture' }) as WidgetDefinition),
          { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
          { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
          { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        ],
      });
      await TestBed.inject(ApplicationInitStatus).donePromise;
      const fixture = TestBed.createComponent(DashboardComponent);
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      document.body.appendChild(fixture.nativeElement);
      return { fixture, el: fixture.nativeElement as HTMLElement, instances };
    };
    const toggle = (el: HTMLElement) =>
      el.querySelector('[data-testid="toggle-layout-edit"]') as HTMLButtonElement;

    it('disables drag and resize outside the edit mode and enables them while editing', async () => {
      const { fixture, el } = await seeded();
      expect(gridOptions(fixture).draggable.enabled).toBe(false);
      expect(gridOptions(fixture).resizable.enabled).toBe(false);
      expect(el.querySelector('[data-testid="widget-drag-handle"]')).toBeNull();
      expect(toggle(el).textContent).toContain('Modifier la disposition');
      toggle(el).click();
      fixture.detectChanges();
      expect(gridOptions(fixture).draggable.enabled).toBe(true);
      expect(gridOptions(fixture).resizable.enabled).toBe(true);
      expect(el.querySelectorAll('[data-testid="widget-drag-handle"]')).toHaveLength(2);
      expect(toggle(el).textContent).toContain('Terminer');
      toggle(el).click();
      fixture.detectChanges();
      expect(gridOptions(fixture).draggable.enabled).toBe(false);
    });

    it('writes nothing on load, even when the display was clamped', async () => {
      const { instances } = await seeded();
      const spy = vi.spyOn(instances, 'updateLayout');
      await Promise.resolve();
      expect(spy).not.toHaveBeenCalled();
    });

    it('persists one updateLayout with the dragged and the pushed items at the end of a drag', async () => {
      const { fixture, el, instances } = await seeded();
      const spy = vi.spyOn(instances, 'updateLayout');
      toggle(el).click();
      fixture.detectChanges();
      const [a, b] = [gridItem(fixture, 0), gridItem(fixture, 1)];
      // What gridster does when item a is dropped on b: both objects are mutated, then notified.
      a.x = 4;
      b.y = 2;
      gridOptions(fixture).itemChangeCallback(a);
      gridOptions(fixture).itemChangeCallback(b);
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      expect(spy.mock.calls[0][1]).toEqual([
        { id: 'instance-1', grid: { x: 4, y: 0, w: 2, h: 2 } },
        { id: 'instance-2', grid: { x: 4, y: 2, w: 2, h: 2 } },
      ]);
    });

    it('moves a widget with the keyboard and announces it', async () => {
      const { fixture, el, instances } = await seeded();
      toggle(el).click();
      fixture.detectChanges();
      const handle = el.querySelector('[data-testid="widget-drag-handle"]') as HTMLButtonElement;
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      fixture.detectChanges();
      await vi.waitFor(() => expect(instances.items[0].grid).toEqual({ x: 1, y: 0, w: 2, h: 2 }));
      expect(el.querySelector('[data-testid="widget-layout-status"]')?.textContent).toContain(
        'colonne 2, ligne 1',
      );
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
      );
      await vi.waitFor(() => expect(instances.items[0].grid.h).toBe(3));
    });

    it('shows a non blocking translated error when the layout write fails', async () => {
      const { fixture, el, instances } = await seeded();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      toggle(el).click();
      fixture.detectChanges();
      instances.failNext(new DataError('busy', 'locked'));
      el.querySelector('[data-testid="widget-drag-handle"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('[data-testid="dashboard-layout-error"]')?.textContent).toContain(
          "Impossible d'enregistrer la disposition",
        );
      });
      expect(gridItem(fixture, 0)).toMatchObject({ x: 0, y: 0 });
      expect(toggle(el).disabled).toBe(false);
    });
  });

  describe('8-row grid', () => {
    const seededAt = async (
      grids: { x: number; y: number; w: number; h: number }[],
      name = 'Accueil',
      icon = 'th-large',
    ) => {
      const dashboards = new FakeDashboardRepository();
      const instances = new FakeWidgetInstanceRepository();
      await dashboards.createIfNone({ name, icon });
      const [dashboard] = await dashboards.list();
      for (const grid of grids) {
        instances.seed({ dashboardId: dashboard.id, widgetType: 'fixture', grid });
      }
      TestBed.configureTestingModule({
        providers: [
          provideAppI18n(),
          provideRouter([]),
          routeFor(dashboard.id),
          provideWidget(fixtureDefinition({ type: 'fixture' }) as WidgetDefinition),
          { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
          { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
          { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        ],
      });
      await TestBed.inject(ApplicationInitStatus).donePromise;
      const fixture = TestBed.createComponent(DashboardComponent);
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      document.body.appendChild(fixture.nativeElement);
      return { fixture, el: fixture.nativeElement as HTMLElement, instances, dashboards };
    };

    it('writes nothing on load with rows beyond 8, and shows them repositioned', async () => {
      const { fixture, instances } = await seededAt([
        { x: 0, y: 0, w: 2, h: 2 },
        { x: 0, y: 20, w: 2, h: 2 },
      ]);
      const spy = vi.spyOn(instances, 'updateLayout');
      await fixture.whenStable();
      expect(spy).not.toHaveBeenCalled();
      expect(instances.items[1].grid.y).toBe(20);
      expect(gridItem(fixture, 1)).toMatchObject({ x: 0, y: 6 });
    });

    it('shows a banner naming the widgets that do not fit, without writing', async () => {
      const full = Array.from({ length: 25 }, () => ({ x: 0, y: 0, w: 2, h: 2 }));
      const { fixture, el, instances } = await seededAt(full);
      const spy = vi.spyOn(instances, 'updateLayout');
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="dashboard-unplaced"]')?.textContent).toContain(
        '1 widget(s) ne tiennent pas',
      );
      expect(el.querySelectorAll('gridster-item')).toHaveLength(24);
      expect(spy).not.toHaveBeenCalled();
    });

    describe('moving the widgets that do not fit', () => {
      const full = Array.from({ length: 25 }, () => ({ x: 0, y: 0, w: 2, h: 2 }));
      const move = (el: HTMLElement): void =>
        el.querySelector<HTMLButtonElement>('[data-testid="dashboard-move-unplaced"]')?.click();

      it('moves them to a new dashboard with the same icon, without navigating', async () => {
        const { fixture, el, instances, dashboards } = await seededAt(full, 'Accueil', 'briefcase');
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
        const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
        move(el);
        await vi.waitFor(() => expect(dashboards.items).toHaveLength(2));
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(el.querySelector('[data-testid="dashboard-unplaced"]')).toBeNull();
        });
        expect(dashboards.items[1]).toMatchObject({ name: 'Accueil (suite)', icon: 'briefcase' });
        expect(
          instances.items.filter((i) => i.dashboardId === dashboards.items[1].id),
        ).toHaveLength(1);
        expect(el.querySelectorAll('gridster-item')).toHaveLength(24);
        expect(el.querySelector('[data-testid="dashboard-move-error"]')).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
      });

      it('cuts the name of the new dashboard to 100 characters', async () => {
        const { el, dashboards } = await seededAt(full, 'é'.repeat(100));
        move(el);
        await vi.waitFor(() => expect(dashboards.items).toHaveLength(2));
        const name = dashboards.items[1].name;
        expect(name.length).toBeLessThanOrEqual(100);
        expect(name.endsWith(' (suite)')).toBe(true);
      });

      it('removes the empty dashboard it created and shows an error when the move fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { fixture, el, instances, dashboards } = await seededAt(full);
        vi.spyOn(instances, 'moveToDashboard').mockRejectedValue(new Error('boom'));
        move(el);
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(el.querySelector('[data-testid="dashboard-move-error"]')?.textContent).toContain(
            'Impossible de déplacer',
          );
        });
        expect(dashboards.items.map((d) => d.name)).toEqual(['Accueil']);
        expect(el.querySelector('[data-testid="dashboard-unplaced"]')).not.toBeNull();
      });

      it('only logs a failed cleanup', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { fixture, el, instances, dashboards } = await seededAt(full);
        vi.spyOn(instances, 'moveToDashboard').mockRejectedValue(new Error('boom'));
        vi.spyOn(dashboards, 'remove').mockRejectedValue(new Error('cleanup'));
        move(el);
        await vi.waitFor(() => {
          fixture.detectChanges();
          expect(el.querySelector('[data-testid="dashboard-move-error"]')).not.toBeNull();
        });
        expect(error).toHaveBeenCalledWith(
          'Could not remove the empty dashboard',
          expect.any(Error),
        );
      });
    });

    it('warns when gridster moves an item without a gesture, but still saves it', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { fixture, el, instances } = await seededAt([{ x: 0, y: 0, w: 2, h: 2 }]);
      el.querySelector<HTMLButtonElement>('[data-testid="toggle-layout-edit"]')?.click();
      fixture.detectChanges();
      const spy = vi.spyOn(instances, 'updateLayout');
      const item = gridItem(fixture);
      item.x = 3;
      gridOptions(fixture).itemChangeCallback(item);
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith('gridster moved an item by itself', item.id);
    });

    it('does not warn during a drag', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      warn.mockClear();
      const { fixture, el, instances } = await seededAt([{ x: 0, y: 0, w: 2, h: 2 }]);
      el.querySelector<HTMLButtonElement>('[data-testid="toggle-layout-edit"]')?.click();
      fixture.detectChanges();
      const spy = vi.spyOn(instances, 'updateLayout');
      const item = gridItem(fixture);
      gridOptions(fixture).draggable.start();
      item.x = 3;
      gridOptions(fixture).itemChangeCallback(item);
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      expect(warn.mock.calls).toEqual([]);
    });
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

  describe('route', () => {
    async function routed() {
      const dashboards = new FakeDashboardRepository();
      const instances = new FakeWidgetInstanceRepository();
      const settings = new FakeSettingsRepository();
      await dashboards.createIfNone({ name: 'Accueil' });
      const second = await dashboards.create({ name: 'Autre' });
      const first = dashboards.items[0];
      const params = new BehaviorSubject(convertToParamMap({ id: first.id }));
      TestBed.configureTestingModule({
        providers: [
          provideAppI18n(),
          provideRouter([]),
          { provide: ActivatedRoute, useValue: { paramMap: params } },
          provideWidget(fixtureDefinition({ type: 'fixture' }) as WidgetDefinition),
          { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
          { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
          { provide: SETTINGS_REPOSITORY, useValue: settings },
        ],
      });
      await TestBed.inject(ApplicationInitStatus).donePromise;
      const fixture = TestBed.createComponent(DashboardComponent);
      await fixture.whenStable();
      fixture.detectChanges();
      document.body.appendChild(fixture.nativeElement);
      return { fixture, el: fixture.nativeElement as HTMLElement, params, first, second, settings };
    }

    it('opens the dashboard of the route, remembers it and follows the parameter', async () => {
      const { fixture, el, params, first, second, settings } = await routed();
      const store = TestBed.inject(DashboardStore);
      await vi.waitFor(() => expect(store.dashboard()?.id).toBe(first.id));
      await vi.waitFor(() => expect(settings.values.get(LAST_DASHBOARD_SETTING)).toBe(first.id));
      params.next(convertToParamMap({ id: second.id }));
      await vi.waitFor(() => expect(store.dashboard()?.id).toBe(second.id));
      fixture.detectChanges();
      await vi.waitFor(() => expect(settings.values.get(LAST_DASHBOARD_SETTING)).toBe(second.id));
      expect(el.querySelector('h1')?.textContent).toBe('Autre');
    });

    it('goes back to the root when the id is unknown', async () => {
      const { params } = await routed();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      params.next(convertToParamMap({ id: 'missing' }));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replaceUrl: true }));
    });

    it('does not take the focus when the dashboard changes', async () => {
      const { fixture, params, second } = await routed();
      const store = TestBed.inject(DashboardStore);
      await vi.waitFor(() => expect(store.status()).toBe('ready'));
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      params.next(convertToParamMap({ id: second.id }));
      await vi.waitFor(() => expect(store.dashboard()?.id).toBe(second.id));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it('closes the store when destroyed', async () => {
      const { fixture } = await routed();
      const store = TestBed.inject(DashboardStore);
      await vi.waitFor(() => expect(store.status()).toBe('ready'));
      fixture.destroy();
      expect(store.status()).toBe('idle');
      expect(store.dashboard()).toBeNull();
    });
  });
});
