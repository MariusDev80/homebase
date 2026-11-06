import { TestBed } from '@angular/core/testing';
import { DASHBOARD_REPOSITORY, DataError, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from '../widgets/widget-definition';
import { provideWidget } from '../widgets/widget-registry';
import { DashboardStore } from './dashboard.store';
import { WidgetAddFlow } from './widget-add-flow';

function setup() {
  const dashboards = new FakeDashboardRepository();
  const instances = new FakeWidgetInstanceRepository();
  TestBed.configureTestingModule({
    providers: [
      { provide: DASHBOARD_REPOSITORY, useValue: dashboards },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
      provideWidget(fixtureDefinition({ type: 'hello' }) as WidgetDefinition),
    ],
  });
  return {
    dashboards,
    instances,
    store: TestBed.inject(DashboardStore),
    flow: TestBed.inject(WidgetAddFlow),
  };
}

describe('WidgetAddFlow', () => {
  it('is unavailable outside a dashboard', () => {
    const { flow, store } = setup();
    expect(flow.phase()).toBe('unavailable');
    flow.open();
    expect(flow.phase()).toBe('unavailable');
    store.close();
    expect(flow.phase()).toBe('unavailable');
  });

  it('goes idle -> choosing -> confirming -> idle', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    expect(flow.phase()).toBe('idle');
    expect(flow.newInstanceId()).toBeNull();
    flow.open();
    expect(flow.phase()).toBe('choosing');
    await flow.pick('hello');
    expect(flow.phase()).toBe('confirming');
    expect(flow.newInstanceId()).toBe(store.instances()[0]?.id);
    flow.finish();
    expect(flow.phase()).toBe('idle');
    expect(flow.newInstanceId()).toBeNull();
    expect(store.instances()).toHaveLength(1);
  });

  it('cancel returns to idle and gives the focus back, creating nothing', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    const focus = vi.fn();
    flow.registerTrigger(focus);
    flow.open();
    flow.cancel();
    expect(flow.phase()).toBe('idle');
    await vi.waitFor(() => expect(focus).toHaveBeenCalled());
    expect(store.instances()).toHaveLength(0);
  });

  it('a failed pick stays in choosing with addFailed, and a retry works', async () => {
    const { flow, store, instances } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await store.open(null, 'Accueil');
    flow.open();
    instances.failNext(new DataError('busy', 'locked'));
    await flow.pick('hello');
    expect(flow.phase()).toBe('choosing');
    expect(flow.addFailed()).toBe(true);
    expect(flow.pending()).toBe(false);
    await flow.pick('hello');
    expect(flow.phase()).toBe('confirming');
    expect(flow.addFailed()).toBe(false);
  });

  it('a double pick creates one instance', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    flow.open();
    await Promise.all([flow.pick('hello'), flow.pick('hello')]);
    expect(store.instances()).toHaveLength(1);
    expect(flow.phase()).toBe('confirming');
  });

  it('a second widget needs the V first: pick is ignored while confirming', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    flow.open();
    await flow.pick('hello');
    flow.open();
    await flow.pick('hello');
    expect(store.instances()).toHaveLength(1);
    flow.finish();
    flow.open();
    await flow.pick('hello');
    expect(store.instances()).toHaveLength(2);
  });

  it('coming back to the same dashboard ends the add (new session) and restarts cleanly', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    const id = store.dashboard()?.id as string;
    flow.open();
    await flow.pick('hello');
    expect(flow.phase()).toBe('confirming');
    store.close();
    await store.open(id, 'Accueil');
    expect(flow.phase()).toBe('idle');
    expect(flow.newInstanceId()).toBeNull();
    flow.finish();
    expect(flow.phase()).toBe('idle');
    flow.open();
    expect(flow.phase()).toBe('choosing');
    flow.cancel();
    expect(flow.phase()).toBe('idle');
  });

  it('a pop-up left open does not reopen after a change of session', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    const id = store.dashboard()?.id as string;
    flow.open();
    expect(flow.phase()).toBe('choosing');
    await store.open(id, 'Accueil');
    expect(flow.phase()).toBe('idle');
    store.close();
    await store.open(id, 'Accueil');
    expect(flow.phase()).toBe('idle');
  });

  it('is idle when the new instance disappears', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    flow.open();
    await flow.pick('hello');
    await store.remove(store.instances()[0]?.id as string);
    expect(flow.phase()).toBe('idle');
    expect(flow.newInstanceId()).toBeNull();
  });

  it('a pick resolved after a change of session ends idle, the widget stays created', async () => {
    const { flow, store, instances } = setup();
    await store.open(null, 'Accueil');
    const id = store.dashboard()?.id as string;
    const create = instances.create.bind(instances);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(instances, 'create').mockImplementation(async (input) => {
      await gate;
      return create(input);
    });
    flow.open();
    const picking = flow.pick('hello');
    expect(flow.pending()).toBe(true);
    await store.open(id, 'Accueil');
    release();
    await picking;
    expect(flow.phase()).toBe('idle');
    expect(flow.pending()).toBe(false);
    expect(instances.items).toHaveLength(1);
  });

  it('registerTrigger returns an unregistration; focusTrigger calls the registered focus', () => {
    const { flow } = setup();
    const focus = vi.fn();
    const off = flow.registerTrigger(focus);
    flow.focusTrigger();
    expect(focus).toHaveBeenCalledTimes(1);
    off();
    flow.focusTrigger();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
