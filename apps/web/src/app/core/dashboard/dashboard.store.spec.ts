import { TestBed } from '@angular/core/testing';
import { DASHBOARD_REPOSITORY, DataError, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { fixtureDefinition } from '../testing/fixture-definitions';
import { provideWidget } from '../widgets/widget-registry';
import type { WidgetDefinition } from '../widgets/widget-definition';
import { DashboardStore, UnknownWidgetTypeError, WidgetLimitError } from './dashboard.store';

function setup() {
  const dashboards = new FakeDashboardRepository();
  const instances = new FakeWidgetInstanceRepository();
  TestBed.configureTestingModule({
    providers: [
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
      provideWidget(fixtureDefinition({ type: 'hello' }) as WidgetDefinition),
      provideWidget(fixtureDefinition({ type: 'single', maxInstances: 1 }) as WidgetDefinition),
    ],
  });
  return { dashboards, instances, store: TestBed.inject(DashboardStore) };
}

describe('DashboardStore', () => {
  it('creates the default dashboard on first load only', async () => {
    const { dashboards, store } = setup();
    await store.load('Accueil');
    expect(store.status()).toBe('ready');
    expect(store.dashboard()?.name).toBe('Accueil');
    await store.load('Autre');
    expect(dashboards.items).toHaveLength(1);
    expect(store.dashboard()?.name).toBe('Accueil');
  });

  it('adds an instance with defaults, default size and a free position', async () => {
    const { store } = setup();
    await store.load('Accueil');
    const first = await store.add('hello');
    expect(first).toMatchObject({
      widgetType: 'hello',
      config: { label: 'default' },
      configVersion: 1,
      grid: { x: 0, y: 0, w: 2, h: 2 },
    });
    const second = await store.add('hello');
    expect(second.grid).toEqual({ x: 0, y: 2, w: 2, h: 2 });
    expect(store.instances()).toHaveLength(2);
  });

  it('rejects an unknown type', async () => {
    const { store } = setup();
    await store.load('Accueil');
    await expect(store.add('nope')).rejects.toBeInstanceOf(UnknownWidgetTypeError);
    expect(store.canAdd('nope')).toBe(false);
  });

  it('enforces maxInstances per dashboard', async () => {
    const { store } = setup();
    await store.load('Accueil');
    expect(store.canAdd('single')).toBe(true);
    await store.add('single');
    expect(store.canAdd('single')).toBe(false);
    await expect(store.add('single')).rejects.toBeInstanceOf(WidgetLimitError);
  });

  it('cannot add before the dashboard is loaded', () => {
    expect(setup().store.canAdd('hello')).toBe(false);
  });

  it('removes an instance', async () => {
    const { store, instances } = setup();
    await store.load('Accueil');
    const record = await store.add('hello');
    await store.remove(record.id);
    expect(store.instances()).toEqual([]);
    expect(instances.items).toEqual([]);
  });

  it('resets a configuration to the defaults', async () => {
    const { store } = setup();
    await store.load('Accueil');
    const record = await store.add('hello');
    await store.saveConfig(record.id, { label: 'custom' }, 1);
    expect(store.instances()[0].config).toEqual({ label: 'custom' });
    await store.resetConfig(record.id);
    expect(store.instances()[0]).toMatchObject({ config: { label: 'default' }, configVersion: 1 });
  });

  it('keeps instances sorted by position', async () => {
    const { store, dashboards, instances } = setup();
    await dashboards.create({ name: 'Accueil' });
    const id = dashboards.items[0].id;
    instances.seed({ dashboardId: id, grid: { x: 0, y: 4, w: 2, h: 2 } });
    instances.seed({ dashboardId: id, grid: { x: 0, y: 0, w: 2, h: 2 } });
    await store.load('Accueil');
    expect(store.instances().map((i) => i.grid.y)).toEqual([0, 4]);
  });

  it('reports a repository failure', async () => {
    const { store, dashboards } = setup();
    dashboards.failNext(new DataError('unavailable', 'no db'));
    await store.load('Accueil');
    expect(store.status()).toBe('error');
    expect(store.error()?.kind).toBe('unavailable');
  });
});
