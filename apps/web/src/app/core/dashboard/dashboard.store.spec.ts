import { TestBed } from '@angular/core/testing';
import { DASHBOARD_REPOSITORY, DataError, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { PendingWrites } from '../widgets/pending-writes';
import { fixtureDefinition } from '../testing/fixture-definitions';
import { provideWidget } from '../widgets/widget-registry';
import type { WidgetDefinition } from '../widgets/widget-definition';
import {
  DashboardStore,
  GridFullError,
  UnknownWidgetTypeError,
  WidgetLimitError,
} from './dashboard.store';

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
    await store.open(null, 'Accueil');
    expect(store.status()).toBe('ready');
    expect(store.dashboard()?.name).toBe('Accueil');
    await store.open(null, 'Autre');
    expect(dashboards.items).toHaveLength(1);
    expect(store.dashboard()?.name).toBe('Accueil');
  });

  it('adds an instance with defaults, default size and a free position', async () => {
    const { store } = setup();
    await store.open(null, 'Accueil');
    const first = await store.add('hello');
    expect(first).toMatchObject({
      widgetType: 'hello',
      config: { label: 'default' },
      configVersion: 1,
      grid: { x: 0, y: 0, w: 2, h: 2 },
    });
    const second = await store.add('hello');
    expect(second.grid).toEqual({ x: 2, y: 0, w: 2, h: 2 });
    expect(store.instances()).toHaveLength(2);
  });

  it('rejects an unknown type', async () => {
    const { store } = setup();
    await store.open(null, 'Accueil');
    await expect(store.add('nope')).rejects.toBeInstanceOf(UnknownWidgetTypeError);
    expect(store.canAdd('nope')).toBe(false);
  });

  it('enforces maxInstances per dashboard', async () => {
    const { store } = setup();
    await store.open(null, 'Accueil');
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
    await store.open(null, 'Accueil');
    const record = await store.add('hello');
    await store.remove(record.id);
    expect(store.instances()).toEqual([]);
    expect(instances.items).toEqual([]);
  });

  it('resets a configuration to the defaults', async () => {
    const { store } = setup();
    await store.open(null, 'Accueil');
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
    await store.open(null, 'Accueil');
    expect(store.instances().map((i) => i.grid.y)).toEqual([0, 4]);
  });

  it('reports a repository failure', async () => {
    const { store, dashboards } = setup();
    dashboards.failNext(new DataError('unavailable', 'no db'));
    await store.open(null, 'Accueil');
    expect(store.status()).toBe('error');
    expect(store.error()?.kind).toBe('unavailable');
  });
});

describe('DashboardStore layout', () => {
  async function loaded() {
    const ctx = setup();
    await ctx.store.open(null, 'Accueil');
    const a = await ctx.store.add('hello');
    const b = await ctx.store.add('hello');
    const spy = vi.spyOn(ctx.instances, 'updateLayout');
    return { ...ctx, a, b, spy };
  }
  const rect = (x: number, y: number) => ({ x, y, w: 2, h: 2 });

  it('writes nothing at load', async () => {
    const ctx = setup();
    const spy = vi.spyOn(ctx.instances, 'updateLayout');
    await ctx.store.open(null, 'Accueil');
    expect(spy).not.toHaveBeenCalled();
  });

  it('updates the state at once and writes one updateLayout with the modified items only', async () => {
    const { store, a, b, spy } = await loaded();
    const done = store.changeLayout([
      { id: a.id, grid: rect(4, 0) },
      { id: b.id, grid: b.grid },
    ]);
    expect(store.instances().find((i) => i.id === a.id)?.grid).toEqual(rect(4, 0));
    await done;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(store.dashboard()?.id, [{ id: a.id, grid: rect(4, 0) }]);
  });

  it('registers in PendingWrites: flushAll waits for the layout write in flight', async () => {
    const { store, spy, a } = await loaded();
    expect(TestBed.inject(PendingWrites).count).toBe(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    spy.mockImplementationOnce(async () => {
      await gate;
      return 1;
    });
    void store.changeLayout([{ id: a.id, grid: rect(4, 0) }]);
    let flushed = false;
    const flush = TestBed.inject(PendingWrites)
      .flushAll()
      .then(() => (flushed = true));
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await flush;
    expect(flushed).toBe(true);
  });

  it('does not write when nothing changed', async () => {
    const { store, a, spy } = await loaded();
    await store.changeLayout([{ id: a.id, grid: a.grid }]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('coalesces a burst: one write in flight, one pending, last value wins', async () => {
    const { store, a, b, spy } = await loaded();
    const pending = [
      store.changeLayout([{ id: a.id, grid: rect(1, 0) }]),
      store.changeLayout([{ id: a.id, grid: rect(2, 0) }]),
      store.changeLayout([
        { id: a.id, grid: rect(3, 0) },
        { id: b.id, grid: rect(6, 6) },
      ]),
    ];
    await Promise.all(pending);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1]).toEqual([{ id: a.id, grid: rect(1, 0) }]);
    expect(spy.mock.calls[1][1]).toEqual([
      { id: a.id, grid: rect(3, 0) },
      { id: b.id, grid: rect(6, 6) },
    ]);
  });

  it('goes back to the last persisted layout on failure and flags the error', async () => {
    const { store, instances, a } = await loaded();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await store.changeLayout([{ id: a.id, grid: rect(1, 0) }]);
    instances.failNext(new DataError('busy', 'locked'));
    await store.changeLayout([{ id: a.id, grid: rect(5, 0) }]);
    expect(store.instances().find((i) => i.id === a.id)?.grid).toEqual(rect(1, 0));
    expect(store.layoutError()).toBe(true);
    await store.changeLayout([{ id: a.id, grid: rect(2, 0) }]);
    expect(store.layoutError()).toBe(false);
  });

  it('keeps the optimistic grid when a config save returns an older record', async () => {
    const { store, a } = await loaded();
    const write = store.changeLayout([{ id: a.id, grid: rect(7, 0) }]);
    await store.saveConfig(a.id, { label: 'x' }, 1);
    await write;
    expect(store.instances().find((i) => i.id === a.id)?.grid).toEqual(rect(7, 0));
  });

  it('nudges a widget within its constraints and persists the result', async () => {
    const { store, a, spy } = await loaded();
    expect(store.nudge(a.id, { dx: -1 })).toBeNull();
    expect(store.nudge(a.id, { dw: 5 })).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(store.nudge(a.id, { dw: 1 })).toBeNull();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  });
});

describe('DashboardStore fitted layout', () => {
  const stored = (x: number, y: number) => ({ x, y, w: 4, h: 3 });

  async function seeded(positions: [number, number][]) {
    const ctx = setup();
    await ctx.dashboards.createIfNone({ name: 'Accueil' });
    const dashboardId = ctx.dashboards.items[0].id;
    const records = positions.map(([x, y]) =>
      ctx.instances.seed({ dashboardId, grid: stored(x, y) }),
    );
    await ctx.store.open(null, 'Accueil');
    return { ...ctx, records, dashboardId };
  }

  it('writes nothing at load, even with rows beyond the 8th (down to row 20)', async () => {
    const ctx = setup();
    await ctx.dashboards.createIfNone({ name: 'Accueil' });
    const dashboardId = ctx.dashboards.items[0].id;
    ctx.instances.seed({ dashboardId, grid: stored(0, 0) });
    ctx.instances.seed({ dashboardId, grid: stored(0, 20) });
    const spy = vi.spyOn(ctx.instances, 'updateLayout');
    await ctx.store.open(null, 'Accueil');
    expect(spy).not.toHaveBeenCalled();
    expect(ctx.store.layout().placed.size).toBe(2);
    expect(ctx.instances.items[1].grid).toEqual(stored(0, 20));
  });

  it('writes the moved widget and every repositioned one in a single call', async () => {
    const { store, records, instances } = await seeded([
      [0, 0],
      [0, 3],
      [0, 6],
      [0, 9],
    ]);
    const [a, , c, d] = records;
    expect(store.layout().placed.get(c.id)).toEqual(stored(4, 0));
    expect(store.layout().placed.get(d.id)).toEqual(stored(8, 0));
    const spy = vi.spyOn(instances, 'updateLayout');
    await store.changeLayout([{ id: a.id, grid: { x: 0, y: 4, w: 4, h: 3 } }]);
    // a moved to row 4 hits b (0,3): the lib would push it; here only the reported item is given.
    expect(spy).toHaveBeenCalledTimes(1);
    const written = spy.mock.calls[0][1].map((i) => i.id).sort();
    expect(written).toEqual([a.id, c.id, d.id].sort());
  });

  it('keeps C and D where they were shown after B is removed, also after a reload', async () => {
    const { store, records, instances, dashboardId } = await seeded([
      [0, 0],
      [0, 3],
      [0, 6],
      [0, 9],
    ]);
    const [a, b, c, d] = records;
    await store.remove(b.id);
    await store.open(null, 'Accueil');
    expect(store.dashboard()?.id).toBe(dashboardId);
    const placed = store.layout().placed;
    expect(placed.get(a.id)).toEqual(stored(0, 0));
    expect(placed.get(c.id)).toEqual(stored(4, 0));
    expect(placed.get(d.id)).toEqual(stored(8, 0));
    expect(instances.items.find((i) => i.id === c.id)?.grid).toEqual(stored(4, 0));
    expect(instances.items.find((i) => i.id === d.id)?.grid).toEqual(stored(8, 0));
  });

  it('reports addBlockReason and refuses an add on a full grid', async () => {
    const ctx = setup();
    await ctx.store.open(null, 'Accueil');
    const dashboardId = ctx.dashboards.items[0].id;
    expect(ctx.store.addBlockReason('hello')).toBeNull();
    await ctx.store.add('single');
    expect(ctx.store.addBlockReason('single')).toBe('limit');
    // Fill the grid: 6 x 4 widgets of 2 x 2.
    for (let i = 0; i < 23; i++) {
      ctx.instances.seed({
        dashboardId,
        grid: { x: (i % 6) * 2, y: Math.floor((i + 1) / 6) * 2, w: 2, h: 2 },
      });
    }
    await ctx.store.open(null, 'Accueil');
    expect(ctx.store.layout().placed.size).toBe(24);
    expect(ctx.store.addBlockReason('hello')).toBe('full');
    expect(ctx.store.canAdd('hello')).toBe(false);
    await expect(ctx.store.add('hello')).rejects.toBeInstanceOf(GridFullError);
  });

  it('never writes a widget without room', async () => {
    const ctx = setup();
    await ctx.dashboards.createIfNone({ name: 'Accueil' });
    const dashboardId = ctx.dashboards.items[0].id;
    const records = Array.from({ length: 25 }, () =>
      ctx.instances.seed({ dashboardId, grid: { x: 0, y: 0, w: 2, h: 2 } }),
    );
    await ctx.store.open(null, 'Accueil');
    const [lost] = ctx.store.layout().unplaced;
    expect(ctx.store.layout().unplaced).toHaveLength(1);
    const spy = vi.spyOn(ctx.instances, 'updateLayout');
    const moved = records.find((r) => r.id !== lost) as (typeof records)[number];
    const shown = ctx.store.layout().placed.get(moved.id) as { x: number; y: number };
    await ctx.store.changeLayout([
      { id: moved.id, grid: { x: shown.x, y: shown.y + 1, w: 2, h: 2 } },
    ]);
    const written = spy.mock.calls[0][1].map((item) => item.id);
    expect(written).toContain(moved.id);
    expect(written).not.toContain(lost);
    expect(ctx.instances.items.find((r) => r.id === lost)?.grid).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 2,
    });
  });
});

describe('DashboardStore open and close', () => {
  function gate<T>() {
    let release!: (value: T) => void;
    let fail!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    return { promise, release, fail };
  }

  async function twoDashboards() {
    const ctx = setup();
    await ctx.dashboards.createIfNone({ name: 'Accueil' });
    const second = await ctx.dashboards.create({ name: 'Autre' });
    return { ...ctx, first: ctx.dashboards.items[0], second };
  }

  it('opens a dashboard by id and reports an unknown id as not-found', async () => {
    const { store, second } = await twoDashboards();
    await expect(store.open(second.id, 'x')).resolves.toBe('ready');
    expect(store.dashboard()?.id).toBe(second.id);
    await expect(store.open('missing', 'x')).resolves.toBe('not-found');
    expect(store.status()).toBe('not-found');
    expect(store.dashboard()).toBeNull();
    await expect(store.whenOpened()).resolves.toBe('not-found');
  });

  it('keeps only the last of two opens (token)', async () => {
    const { store, dashboards, first, second } = await twoDashboards();
    const slow = gate<typeof first | null>();
    vi.spyOn(dashboards, 'get').mockImplementationOnce(() => slow.promise);
    const a = store.open(first.id, 'x');
    await vi.waitFor(() => expect(dashboards.get).toHaveBeenCalled());
    const b = store.open(second.id, 'x');
    await expect(b).resolves.toBe('ready');
    slow.release(first);
    await expect(a).resolves.toBe('superseded');
    expect(store.dashboard()?.id).toBe(second.id);
    expect(store.status()).toBe('ready');
    await expect(store.whenOpened()).resolves.toBe('ready');
  });

  it('ignores a superseded open that ends in not-found', async () => {
    const { store, dashboards, second } = await twoDashboards();
    const slow = gate<null>();
    vi.spyOn(dashboards, 'get').mockImplementationOnce(() => slow.promise);
    const a = store.open('missing', 'x');
    await vi.waitFor(() => expect(dashboards.get).toHaveBeenCalled());
    await expect(store.open(second.id, 'x')).resolves.toBe('ready');
    slow.release(null);
    await expect(a).resolves.toBe('superseded');
    expect(store.status()).toBe('ready');
    expect(store.dashboard()?.id).toBe(second.id);
  });

  it('ignores a superseded open that ends in error', async () => {
    const { store, instances, first, second } = await twoDashboards();
    const slow = gate<never>();
    vi.spyOn(instances, 'listByDashboard').mockImplementationOnce(() => slow.promise);
    const a = store.open(first.id, 'x');
    await vi.waitFor(() => expect(instances.listByDashboard).toHaveBeenCalled());
    await expect(store.open(second.id, 'x')).resolves.toBe('ready');
    slow.fail(new DataError('unavailable', 'gone'));
    await expect(a).resolves.toBe('superseded');
    expect(store.status()).toBe('ready');
    expect(store.error()).toBeNull();
  });

  it('close supersedes a pending open, empties the state and bumps the session', async () => {
    const { store, instances, first } = await twoDashboards();
    const s0 = store.session();
    const slow = gate<never[]>();
    vi.spyOn(instances, 'listByDashboard').mockImplementationOnce(() => slow.promise);
    const a = store.open(first.id, 'x');
    expect(store.session()).toBe(s0 + 1);
    await vi.waitFor(() => expect(instances.listByDashboard).toHaveBeenCalled());
    store.close();
    expect(store.session()).toBe(s0 + 2);
    slow.release([]);
    await expect(a).resolves.toBe('superseded');
    expect(store.status()).toBe('idle');
    expect(store.dashboard()).toBeNull();
    expect(store.instances()).toEqual([]);
  });

  it('close does not empty the pending layout writes', async () => {
    const { store, instances, first } = await twoDashboards();
    const a = instances.seed({ dashboardId: first.id, grid: { x: 0, y: 0, w: 2, h: 2 } });
    await store.open(first.id, 'x');
    const hold = gate<number>();
    const spy = vi.spyOn(instances, 'updateLayout').mockImplementationOnce(() => hold.promise);
    void store.changeLayout([{ id: a.id, grid: { x: 2, y: 0, w: 2, h: 2 } }]);
    const queued = store.changeLayout([{ id: a.id, grid: { x: 4, y: 0, w: 2, h: 2 } }]);
    store.close();
    hold.release(1);
    await queued;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1][0].grid.x).toBe(4);
  });

  it('clears layoutError on open', async () => {
    const { store, instances, first } = await twoDashboards();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const a = instances.seed({ dashboardId: first.id, grid: { x: 0, y: 0, w: 2, h: 2 } });
    await store.open(first.id, 'x');
    vi.spyOn(instances, 'updateLayout').mockRejectedValueOnce(new DataError('busy', 'locked'));
    await store.changeLayout([{ id: a.id, grid: { x: 2, y: 0, w: 2, h: 2 } }]);
    expect(store.layoutError()).toBe(true);
    await store.open(first.id, 'x');
    expect(store.layoutError()).toBe(false);
  });

  it('moveUnplacedTo moves the widgets without room and leaves the placed ones', async () => {
    const { store, instances, dashboards, first } = await twoDashboards();
    for (let i = 0; i < 25; i++) {
      instances.seed({ dashboardId: first.id, grid: { x: 0, y: 0, w: 2, h: 2 } });
    }
    await store.open(first.id, 'x');
    const [lost] = store.layout().unplaced;
    const placedBefore = new Map(store.layout().placed);
    const target = await dashboards.create({ name: 'Trop-plein' });
    await expect(store.moveUnplacedTo(target.id)).resolves.toBe(1);
    expect(instances.items.find((i) => i.id === lost)?.dashboardId).toBe(target.id);
    expect(store.instances()).toHaveLength(24);
    expect(store.layout().unplaced).toEqual([]);
    expect(store.layout().placed).toEqual(placedBefore);
    await expect(store.moveUnplacedTo(target.id)).resolves.toBe(0);
  });
});
