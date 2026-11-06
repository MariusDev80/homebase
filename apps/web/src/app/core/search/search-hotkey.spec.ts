import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DASHBOARD_REPOSITORY, DataError, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { DashboardStore } from '../dashboard/dashboard.store';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from '../widgets/widget-definition';
import { provideWidget } from '../widgets/widget-registry';
import { SEARCH_WIDGET_TYPE, SearchHotkey } from './search-hotkey';

async function setup() {
  const dashboards = new FakeDashboardRepository();
  const instances = new FakeWidgetInstanceRepository();
  const navigate = vi.fn<(commands: unknown[]) => Promise<boolean>>();
  TestBed.configureTestingModule({
    providers: [
      provideWidget(fixtureDefinition({ type: SEARCH_WIDGET_TYPE }) as WidgetDefinition),
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const store = TestBed.inject(DashboardStore);
  const hotkey = TestBed.inject(SearchHotkey);
  const a = await dashboards.create({ name: 'A' });
  const b = await dashboards.create({ name: 'B' });
  instances.dashboardOrder = [a.id, b.id];
  // What the dashboard page does when the route changes.
  navigate.mockImplementation((commands) => {
    void store.open(commands[1] as string, 'x');
    return Promise.resolve(true);
  });
  const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const ctrlK = () => key({ key: 'k', ctrlKey: true });
  /** Lets the pending promises settle and the render hooks run. */
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.inject(ApplicationRef).tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { dashboards, instances, navigate, store, hotkey, a, b, key, ctrlK, flush };
}

describe('SearchHotkey', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the current behavior when a bar is registered (Ctrl+K and /)', async () => {
    const { hotkey, key, ctrlK, navigate } = await setup();
    const focus = vi.fn();
    hotkey.register(focus);
    expect(ctrlK().defaultPrevented).toBe(true);
    expect(key({ key: '/' }).defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does nothing for / without a bar, and leaves the key free', async () => {
    const { key, navigate, instances } = await setup();
    const spy = vi.spyOn(instances, 'findFirstOfType');
    expect(key({ key: '/' }).defaultPrevented).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Ctrl+K without a bar goes to the first dashboard that has one, then focuses on registration', async () => {
    const { instances, navigate, store, hotkey, b, ctrlK, flush } = await setup();
    instances.seed({ dashboardId: b.id, widgetType: SEARCH_WIDGET_TYPE });
    expect(ctrlK().defaultPrevented).toBe(true);
    await flush();
    expect(navigate).toHaveBeenCalledWith(['/dashboards', b.id]);
    expect(store.dashboard()?.id).toBe(b.id);

    const focus = vi.fn();
    hotkey.register(focus);
    expect(focus).not.toHaveBeenCalled(); // after the next render, not at registration
    await flush();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('can be consumed by a registration happening before the navigation settles', async () => {
    const { instances, store, hotkey, b, ctrlK, flush } = await setup();
    instances.seed({ dashboardId: b.id, widgetType: SEARCH_WIDGET_TYPE });
    ctrlK();
    await vi.waitFor(() => expect(store.status()).toBe('ready'));
    const focus = vi.fn();
    hotkey.register(focus);
    await flush();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no dashboard has a bar', async () => {
    const { navigate, ctrlK, flush } = await setup();
    expect(ctrlK().defaultPrevented).toBe(true);
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does nothing when the lookup fails', async () => {
    const { instances, navigate, ctrlK, flush } = await setup();
    instances.failNext(new DataError('unavailable', 'down'));
    ctrlK();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('abandons the request when the navigation is refused', async () => {
    const { instances, navigate, store, hotkey, b, ctrlK, flush } = await setup();
    instances.seed({ dashboardId: b.id, widgetType: SEARCH_WIDGET_TYPE });
    navigate.mockResolvedValue(false);
    ctrlK();
    await flush();
    await store.open(b.id, 'x');
    const focus = vi.fn();
    hotkey.register(focus);
    await flush();
    expect(focus).not.toHaveBeenCalled();
  });

  it('abandons the request when the dashboard fails to open', async () => {
    const { instances, dashboards, store, hotkey, b, ctrlK, flush } = await setup();
    instances.seed({ dashboardId: b.id, widgetType: SEARCH_WIDGET_TYPE });
    // The lookup reads the instances; the next read of the dashboards is the open, which fails.
    dashboards.failNext(new DataError('unavailable', 'down'));
    ctrlK();
    await flush();
    expect(store.status()).toBe('error');
    await store.open(b.id, 'x');
    const focus = vi.fn();
    hotkey.register(focus);
    await flush();
    expect(focus).not.toHaveBeenCalled();
  });

  it('C37: opening another dashboard before the load ends abandons the request', async () => {
    const { instances, store, hotkey, a, b, ctrlK, flush } = await setup();
    instances.seed({ dashboardId: b.id, widgetType: SEARCH_WIDGET_TYPE });
    ctrlK();
    await vi.waitFor(() => expect(store.status()).not.toBe('idle'));
    void store.open(a.id, 'x'); // click on another bubble
    await flush();
    expect(store.dashboard()?.id).toBe(a.id);
    // Opening the target later focuses nothing.
    await store.open(b.id, 'x');
    const focus = vi.fn();
    hotkey.register(focus);
    await flush();
    expect(focus).not.toHaveBeenCalled();
  });

  it('C38: a bar without room is never registered, the request dies with the next session', async () => {
    const { instances, store, hotkey, a, b, ctrlK, flush } = await setup();
    instances.seed({ dashboardId: b.id, widgetType: SEARCH_WIDGET_TYPE });
    ctrlK();
    await flush(); // dashboard B open, nothing registers
    expect(store.dashboard()?.id).toBe(b.id);
    await store.open(a.id, 'x');
    await store.open(b.id, 'x'); // later return to the same dashboard: new session
    const focus = vi.fn();
    hotkey.register(focus);
    await flush();
    expect(focus).not.toHaveBeenCalled();
  });

  it('a later return to the same dashboard does not focus (the request was consumed)', async () => {
    const { instances, store, hotkey, b, ctrlK, flush } = await setup();
    instances.seed({ dashboardId: b.id, widgetType: SEARCH_WIDGET_TYPE });
    ctrlK();
    await flush();
    const first = vi.fn();
    const unregister = hotkey.register(first);
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    unregister();
    await store.open(b.id, 'x');
    const second = vi.fn();
    hotkey.register(second);
    await flush();
    expect(second).not.toHaveBeenCalled();
  });

  it('stops listening when the injector is destroyed', async () => {
    const { key, navigate, instances, b } = await setup();
    instances.seed({ dashboardId: b.id, widgetType: SEARCH_WIDGET_TYPE });
    TestBed.resetTestingModule();
    expect(key({ key: 'k', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
