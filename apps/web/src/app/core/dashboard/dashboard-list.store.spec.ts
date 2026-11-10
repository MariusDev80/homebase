import { TestBed } from '@angular/core/testing';
import {
  DASHBOARD_REPOSITORY,
  DataError,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
} from '../../data';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { PendingWrites } from '../widgets/pending-writes';
import {
  DashboardLimitError,
  DashboardListStore,
  LAST_DASHBOARD_SETTING,
  MAX_DASHBOARDS,
} from './dashboard-list.store';

function setup() {
  const dashboards = new FakeDashboardRepository();
  const settings = new FakeSettingsRepository();
  const instances = new FakeWidgetInstanceRepository();
  TestBed.configureTestingModule({
    providers: [
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: SETTINGS_REPOSITORY, useValue: settings },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
    ],
  });
  return { dashboards, settings, instances, store: TestBed.inject(DashboardListStore) };
}

describe('DashboardListStore', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('loads once: createIfNone then list, idempotent', async () => {
    const { store, dashboards } = setup();
    const spy = vi.spyOn(dashboards, 'list');
    await Promise.all([store.load('Accueil'), store.load('Accueil')]);
    await store.load('Autre');
    expect(store.status()).toBe('ready');
    expect(dashboards.items.map((d) => d.name)).toEqual(['Accueil']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.canCreate()).toBe(true);
    expect(store.canRemove()).toBe(false);
  });

  it('never rejects and allows a new attempt after a failure', async () => {
    const { store, dashboards } = setup();
    dashboards.failNext(new DataError('unavailable', 'no db'));
    await expect(store.load('Accueil')).resolves.toBeUndefined();
    expect(store.status()).toBe('error');
    expect(store.canCreate()).toBe(false);
    await store.load('Accueil');
    expect(store.status()).toBe('ready');
    expect(store.dashboards()).toHaveLength(1);
  });

  describe('defaultTargetId', () => {
    async function ready() {
      const ctx = setup();
      await ctx.store.load('Accueil');
      const other = await ctx.store.create({ name: 'Autre', icon: 'home' });
      return { ...ctx, first: ctx.dashboards.items[0], other };
    }

    it('returns the last opened dashboard when it exists', async () => {
      const { store, settings, other } = await ready();
      settings.values.set(LAST_DASHBOARD_SETTING, other.id);
      await expect(store.defaultTargetId()).resolves.toBe(other.id);
    });

    it.each([
      ['a stale id', 'gone'],
      ['a non-string value', 42],
      ['no value', undefined],
    ])('falls back to the first dashboard on %s', async (_label, value) => {
      const { store, settings, first } = await ready();
      if (value !== undefined) settings.values.set(LAST_DASHBOARD_SETTING, value);
      await expect(store.defaultTargetId()).resolves.toBe(first.id);
    });

    it('ignores a failing read of the setting', async () => {
      const { store, settings, first } = await ready();
      settings.failGet = true;
      await expect(store.defaultTargetId()).resolves.toBe(first.id);
    });

    it('returns null before loading, after an error and with an empty list', async () => {
      const { store, dashboards } = setup();
      await expect(store.defaultTargetId()).resolves.toBeNull();
      dashboards.failNext(new DataError('unavailable', 'no db'));
      await store.load('Accueil');
      await expect(store.defaultTargetId()).resolves.toBeNull();
      await store.load('Accueil');
      dashboards.items.length = 0;
      await store.afterRemoval();
      await expect(store.defaultTargetId()).resolves.toBeNull();
    });
  });

  it('refuses to create beyond the limit', async () => {
    const { store, dashboards } = setup();
    await store.load('Accueil');
    for (let i = 1; i < MAX_DASHBOARDS; i++) await dashboards.create({ name: `T${i}` });
    await store.afterRemoval();
    expect(store.dashboards()).toHaveLength(MAX_DASHBOARDS);
    expect(store.canCreate()).toBe(false);
    await expect(store.create({ name: 'Trop', icon: 'home' })).rejects.toBeInstanceOf(
      DashboardLimitError,
    );
    expect(dashboards.items).toHaveLength(MAX_DASHBOARDS);
  });

  it('creates and updates dashboards in the list', async () => {
    const { store } = setup();
    await store.load('Accueil');
    const created = await store.create({ name: 'Pro', icon: 'briefcase' });
    expect(store.canRemove()).toBe(true);
    await store.update(created.id, { name: 'Travail', icon: 'code' });
    expect(store.dashboards().map((d) => [d.name, d.icon])).toEqual([
      ['Accueil', 'th-large'],
      ['Travail', 'code'],
    ]);
  });

  it('counts the widgets of a dashboard', async () => {
    const { store, instances, dashboards } = setup();
    await store.load('Accueil');
    instances.seed({ dashboardId: dashboards.items[0].id });
    instances.seed({ dashboardId: dashboards.items[0].id });
    await expect(store.countWidgets(dashboards.items[0].id)).resolves.toBe(2);
  });

  it('prepareRemoval flushes the pending writes', async () => {
    const { store } = setup();
    const flush = vi.spyOn(TestBed.inject(PendingWrites), 'flushAll');
    await store.prepareRemoval();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('rememberOpened writes the setting and never rejects', async () => {
    const { store, settings } = setup();
    store.rememberOpened('abc');
    await vi.waitFor(() => expect(settings.values.get(LAST_DASHBOARD_SETTING)).toBe('abc'));
    settings.failSet = true;
    expect(() => store.rememberOpened('def')).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(settings.values.get(LAST_DASHBOARD_SETTING)).toBe('abc');
  });

  it('discardEmpty removes the dashboard, and only logs a failure', async () => {
    const { store, dashboards } = setup();
    await store.load('Accueil');
    const extra = await store.create({ name: 'Vide', icon: 'home' });
    await store.discardEmpty(extra.id);
    expect(store.dashboards().map((d) => d.name)).toEqual(['Accueil']);
    const kept = await store.create({ name: 'Reste', icon: 'home' });
    dashboards.failNext(new DataError('unavailable', 'x'));
    await expect(store.discardEmpty(kept.id)).resolves.toBeUndefined();
    expect(store.dashboards()).toHaveLength(2);
  });
});

describe('DashboardListStore theme', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('create passes theme and themeVersion through', async () => {
    const { store, dashboards } = setup();
    await store.load('Accueil');
    const created = await store.create({
      name: 'Suite',
      icon: 'home',
      theme: { cardBody: 'rose' },
      themeVersion: 2,
    });
    expect(created).toMatchObject({ theme: { cardBody: 'rose' }, themeVersion: 2 });
    expect(dashboards.items[1]).toMatchObject({ theme: { cardBody: 'rose' }, themeVersion: 2 });
  });

  it('create without theme keeps the defaults', async () => {
    const { store } = setup();
    await store.load('Accueil');
    const created = await store.create({ name: 'Autre', icon: 'home' });
    expect(created).toMatchObject({ theme: {}, themeVersion: 1 });
  });

  it('updateTheme replaces the entry of the list', async () => {
    const { store } = setup();
    await store.load('Accueil');
    const updated = await store.updateTheme(store.dashboards()[0].id, { cardBody: 'sky' }, 1);
    expect(store.dashboards()[0]).toBe(updated);
    expect(store.dashboards()[0].theme).toEqual({ cardBody: 'sky' });
  });

  it('updateTheme propagates a failure and leaves the list unchanged', async () => {
    const { store, dashboards } = setup();
    await store.load('Accueil');
    const before = store.dashboards();
    dashboards.failNext(new DataError('busy', 'locked'));
    await expect(store.updateTheme(before[0].id, { cardBody: 'sky' }, 1)).rejects.toBeInstanceOf(
      DataError,
    );
    expect(store.dashboards()).toEqual(before);
  });
});
