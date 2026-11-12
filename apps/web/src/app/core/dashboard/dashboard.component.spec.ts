import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { DashboardListStore, LAST_DASHBOARD_SETTING } from './dashboard-list.store';
import { DashboardStore } from './dashboard.store';
import { DashboardThemeFlow } from './dashboard-theme-flow';
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

  it('places a widget added by the store on the grid, with its size constraints', async () => {
    const { fixture, el } = await render();
    await TestBed.inject(DashboardStore).add('fixture');
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
    expect(el.querySelectorAll('app-widget-host')).toHaveLength(1);
  });

  it('has no add menu and no primary button (the add button lives in the sidebar)', async () => {
    const { el } = await render();
    expect(el.querySelector('[data-testid="add-widget"]')).toBeNull();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(el.querySelector('.btn-primary')).toBeNull();
  });

  it('shows the load error', async () => {
    const { el } = await render((dashboards) =>
      dashboards.failNext(new DataError('unavailable', 'no db')),
    );
    expect(el.querySelector('[data-testid="dashboard-error"]')?.textContent).toContain(
      'Impossible de charger le tableau de bord.',
    );
  });

  describe('card theme', () => {
    const area = (el: HTMLElement): HTMLElement =>
      el.querySelector<HTMLElement>('[data-testid="dashboard-grid-area"]') as HTMLElement;
    const withTheme =
      (theme: Record<string, string>, themeVersion = 1) =>
      (d: FakeDashboardRepository) => {
        d.items[0] = { ...d.items[0], theme, themeVersion };
      };

    it('puts card-theme on the grid area, never on a box', async () => {
      const { el } = await render();
      expect(area(el).classList.contains('card-theme')).toBe(true);
      expect(el.querySelectorAll('.card-theme.box')).toHaveLength(0);
      expect(area(el).hasAttribute('data-card-body')).toBe(false);
      expect(area(el).style.getPropertyValue('--hb-card-body-bg')).toBe('');
    });

    it('tints the grid from the stored theme (S2)', async () => {
      const { el } = await render(withTheme({ cardBody: 'rose' }));
      expect(area(el).style.getPropertyValue('--hb-card-body-bg')).toBe('var(--hb-tint-rose-body)');
      expect(area(el).getAttribute('data-card-body')).toBe('rose');
      expect(area(el).getAttribute('data-card-header')).toBe('rose');
    });

    it('applies no property for a future theme', async () => {
      const { el } = await render(withTheme({ cardBody: 'rose' }, 2));
      expect(area(el).style.getPropertyValue('--hb-card-body-bg')).toBe('');
      expect(area(el).hasAttribute('data-card-body')).toBe(false);
    });

    it('applies no property for an invalid theme', async () => {
      const { el } = await render(withTheme({ cardBody: 'Rose' }));
      expect(area(el).style.getPropertyValue('--hb-card-body-bg')).toBe('');
      expect(area(el).hasAttribute('data-card-body')).toBe(false);
    });

    it('shows the draft of the edited dashboard, then the stored theme after close', async () => {
      const { fixture, el } = await render(withTheme({ cardBody: 'rose' }));
      const flow = TestBed.inject(DashboardThemeFlow);
      flow.open();
      flow.setPreview({ cardBody: 'sky', cardHeader: 'default' });
      fixture.detectChanges();
      expect(area(el).getAttribute('data-card-body')).toBe('sky');
      flow.close();
      fixture.detectChanges();
      expect(area(el).getAttribute('data-card-body')).toBe('rose');
    });

    it('follows list.updateTheme without reopening', async () => {
      const { fixture, el, dashboards } = await render();
      const list = TestBed.inject(DashboardListStore);
      await list.load('Accueil');
      await list.updateTheme(dashboards.items[0].id, { cardBody: 'mint', cardHeader: 'sky' }, 1);
      fixture.detectChanges();
      expect(area(el).getAttribute('data-card-body')).toBe('mint');
      expect(area(el).getAttribute('data-card-header')).toBe('sky');
    });
  });

  describe('layout', () => {
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

    it('has no layout toggle; drag and resize are on, with one handle per card', async () => {
      const { fixture, el } = await seeded();
      expect(el.querySelector('button[aria-pressed]')).toBeNull();
      expect(gridOptions(fixture).draggable.enabled).toBe(true);
      expect(gridOptions(fixture).resizable.enabled).toBe(true);
      expect(el.querySelectorAll('[data-testid="widget-drag-handle"]')).toHaveLength(2);
      expect(el.querySelectorAll('[data-testid="widget-remove"]')).toHaveLength(2);
      for (const remove of el.querySelectorAll('[data-testid="widget-remove"]')) {
        expect(remove.closest('.widget-drag-handle')).toBeNull();
      }
    });

    it('writes nothing on load, even when the display was clamped', async () => {
      const { instances } = await seeded();
      const spy = vi.spyOn(instances, 'updateLayout');
      await Promise.resolve();
      expect(spy).not.toHaveBeenCalled();
    });

    it('persists one updateLayout with the dragged and the pushed items at the end of a drag', async () => {
      const { fixture, instances } = await seeded();
      const spy = vi.spyOn(instances, 'updateLayout');
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

      it('copies the raw theme, even a future one, to the new dashboard', async () => {
        const { el, dashboards } = await seededAt(full, 'Accueil', 'briefcase');
        const list = TestBed.inject(DashboardListStore);
        await list.load('Accueil');
        dashboards.items[0] = {
          ...dashboards.items[0],
          theme: { cardBody: 'coral', later: 'x' },
          themeVersion: 3,
        };
        await list.update(dashboards.items[0].id, { name: 'Accueil', icon: 'briefcase' });
        const create = vi.spyOn(list, 'create');
        move(el);
        await vi.waitFor(() => expect(dashboards.items).toHaveLength(2));
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({ theme: { cardBody: 'coral', later: 'x' }, themeVersion: 3 }),
        );
        expect(dashboards.items[1]).toMatchObject({
          theme: { cardBody: 'coral', later: 'x' },
          themeVersion: 3,
        });
      });

      it('names the new dashboard after the edited name and icon of the list', async () => {
        const { el, dashboards } = await seededAt(full, 'Accueil', 'briefcase');
        const list = TestBed.inject(DashboardListStore);
        await list.load('Accueil');
        await list.update(dashboards.items[0].id, { name: 'Renommé', icon: 'home' });
        move(el);
        await vi.waitFor(() => expect(dashboards.items).toHaveLength(2));
        expect(dashboards.items[1]).toMatchObject({ name: 'Renommé (suite)', icon: 'home' });
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
      const { fixture, instances } = await seededAt([{ x: 0, y: 0, w: 2, h: 2 }]);
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
      const { fixture, instances } = await seededAt([{ x: 0, y: 0, w: 2, h: 2 }]);
      const spy = vi.spyOn(instances, 'updateLayout');
      const item = gridItem(fixture);
      gridOptions(fixture).draggable.start();
      item.x = 3;
      gridOptions(fixture).itemChangeCallback(item);
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      expect(warn.mock.calls).toEqual([]);
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
