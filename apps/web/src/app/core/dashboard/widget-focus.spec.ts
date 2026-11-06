import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DASHBOARD_REPOSITORY, DataError, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from '../widgets/widget-definition';
import { provideWidget } from '../widgets/widget-registry';
import { DashboardStore } from './dashboard.store';
import { WidgetFocus } from './widget-focus';

async function setup() {
  const dashboards = new FakeDashboardRepository();
  const instances = new FakeWidgetInstanceRepository();
  const navigate = vi.fn<(commands: unknown[]) => Promise<boolean>>();
  TestBed.configureTestingModule({
    providers: [
      provideWidget(fixtureDefinition({ type: 'fixture' }) as WidgetDefinition),
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const store = TestBed.inject(DashboardStore);
  const focus = TestBed.inject(WidgetFocus);
  const a = await dashboards.create({ name: 'A' });
  const b = await dashboards.create({ name: 'B' });
  // What the dashboard page does when the route changes.
  navigate.mockImplementation((commands) => {
    void store.open(commands[1] as string, 'x');
    return Promise.resolve(true);
  });
  return { dashboards, instances, navigate, store, focus, a, b };
}

describe('WidgetFocus', () => {
  it('requests the focus at once on the current dashboard, without navigating', async () => {
    const { store, instances, focus, navigate, a } = await setup();
    const record = instances.seed({ dashboardId: a.id, widgetType: 'fixture' });
    await store.open(a.id, 'x');
    const promise = focus.focusInstance(record.id);
    // No await before the request.
    expect(focus.request()).toMatchObject({ instanceId: record.id, session: store.session() });
    expect(await promise).toBe('focused');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the other dashboard, then requests after it is open', async () => {
    const { store, instances, focus, navigate, a, b } = await setup();
    const record = instances.seed({ dashboardId: b.id, widgetType: 'fixture' });
    await store.open(a.id, 'x');
    expect(await focus.focusInstance(record.id)).toBe('focused');
    expect(navigate).toHaveBeenCalledWith(['/dashboards', b.id]);
    expect(store.dashboard()?.id).toBe(b.id);
    const request = focus.request();
    expect(request).toMatchObject({ instanceId: record.id, session: store.session() });
    expect(focus.claim(request as NonNullable<typeof request>)).toBe(true);
    expect(focus.claim(request as NonNullable<typeof request>)).toBe(false);
  });

  it('answers unplaced for an instance without room, on this or another dashboard', async () => {
    const { store, instances, focus, a, b } = await setup();
    const full = Array.from({ length: 24 }, (_, i) =>
      instances.seed({
        dashboardId: a.id,
        widgetType: 'fixture',
        grid: { x: i % 12, y: Math.floor(i / 12) * 4, w: 1, h: 4 },
      }),
    );
    const extra = instances.seed({
      dashboardId: a.id,
      widgetType: 'fixture',
      grid: { x: 0, y: 8, w: 4, h: 4 },
    });
    await store.open(a.id, 'x');
    expect(store.layout().unplaced).toContain(extra.id);
    expect(await focus.focusInstance(extra.id)).toBe('unplaced');
    expect(focus.request()).toBeNull();

    // Same, from the other dashboard: navigation first, then 'unplaced'.
    await store.open(b.id, 'x');
    expect(await focus.focusInstance(extra.id)).toBe('unplaced');
    expect(store.dashboard()?.id).toBe(a.id);
    expect(focus.request()).toBeNull();
    expect(full).toHaveLength(24);
  });

  it('answers not-found for a missing instance and a failed read', async () => {
    const { store, instances, focus, a } = await setup();
    await store.open(a.id, 'x');
    expect(await focus.focusInstance('ghost')).toBe('not-found');
    instances.failNext(new DataError('unavailable', 'down'));
    expect(await focus.focusInstance('ghost')).toBe('not-found');
    expect(focus.request()).toBeNull();
  });

  it('answers not-found when the navigation is refused', async () => {
    const { store, instances, focus, navigate, a, b } = await setup();
    const record = instances.seed({ dashboardId: b.id, widgetType: 'fixture' });
    await store.open(a.id, 'x');
    navigate.mockResolvedValue(false);
    expect(await focus.focusInstance(record.id)).toBe('not-found');
    expect(focus.request()).toBeNull();
  });

  it('answers not-found when the dashboard fails to open or another one opens', async () => {
    const { store, dashboards, instances, focus, navigate, a, b } = await setup();
    const record = instances.seed({ dashboardId: b.id, widgetType: 'fixture' });
    await store.open(a.id, 'x');
    navigate.mockImplementation(() => {
      dashboards.failNext(new DataError('unavailable', 'down'));
      void store.open(b.id, 'x');
      return Promise.resolve(true);
    });
    expect(await focus.focusInstance(record.id)).toBe('not-found');

    navigate.mockImplementation(() => {
      void store.open(b.id, 'x');
      void store.open(a.id, 'x');
      return Promise.resolve(true);
    });
    expect(await focus.focusInstance(record.id)).toBe('not-found');
    expect(focus.request()).toBeNull();
  });

  it('does not let a request survive a change of session', async () => {
    const { store, instances, focus, a, b } = await setup();
    const record = instances.seed({ dashboardId: a.id, widgetType: 'fixture' });
    await store.open(a.id, 'x');
    await focus.focusInstance(record.id);
    const request = focus.request() as NonNullable<ReturnType<typeof focus.request>>;
    await store.open(b.id, 'x');
    expect(focus.claim(request)).toBe(false);
  });
});
