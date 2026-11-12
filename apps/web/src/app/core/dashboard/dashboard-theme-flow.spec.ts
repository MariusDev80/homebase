import { TestBed } from '@angular/core/testing';
import { DASHBOARD_REPOSITORY, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { AppLock } from '../lock/app-lock';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { DashboardStore } from './dashboard.store';
import { DashboardThemeFlow } from './dashboard-theme-flow';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      { provide: DASHBOARD_REPOSITORY, useValue: new FakeDashboardRepository() },
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: new FakeWidgetInstanceRepository() },
    ],
  });
  return {
    store: TestBed.inject(DashboardStore),
    flow: TestBed.inject(DashboardThemeFlow),
    lock: TestBed.inject(AppLock),
  };
}

const draft = { cardBody: 'rose', cardHeader: 'default' };

describe('DashboardThemeFlow', () => {
  it('is unavailable without a ready dashboard and under AppLock', async () => {
    const { flow, store, lock } = setup();
    expect(flow.phase()).toBe('unavailable');
    flow.open();
    expect(flow.phase()).toBe('unavailable');
    await store.open(null, 'Accueil');
    expect(flow.phase()).toBe('idle');
    lock.lock('import');
    expect(flow.phase()).toBe('unavailable');
    flow.open();
    lock.unlock();
    expect(flow.phase()).toBe('idle');
  });

  it('opens an edit for the current dashboard and session', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    flow.open();
    expect(flow.phase()).toBe('editing');
    expect(flow.dashboardId()).toBe(store.dashboard()?.id);
    expect(flow.editingSession()).toBe(store.session());
    expect(flow.preview()).toBeNull();
  });

  it('ignores setPreview outside an edit', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    flow.setPreview(draft);
    expect(flow.preview()).toBeNull();
    flow.open();
    flow.setPreview(draft);
    expect(flow.preview()).toEqual(draft);
  });

  it('goes idle on a session change, even for the same dashboard, and never comes back', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    const id = store.dashboard()?.id as string;
    flow.open();
    flow.setPreview(draft);
    store.close();
    await store.open(id, 'Accueil');
    expect(flow.phase()).toBe('idle');
    expect(flow.preview()).toBeNull();
    expect(flow.dashboardId()).toBeNull();
    flow.setPreview(draft);
    expect(flow.preview()).toBeNull();
    flow.close();
    expect(flow.phase()).toBe('idle');
  });

  it('becomes unavailable when the lock is taken during an edit', async () => {
    const { flow, store, lock } = setup();
    await store.open(null, 'Accueil');
    flow.open();
    lock.lock('restore');
    expect(flow.phase()).toBe('unavailable');
    expect(flow.preview()).toBeNull();
  });

  it('close returns to idle, drops the preview and focuses the trigger after render', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    const focus = vi.fn();
    flow.registerTrigger(focus);
    flow.open();
    flow.setPreview(draft);
    flow.close();
    expect(flow.phase()).toBe('idle');
    expect(flow.preview()).toBeNull();
    await vi.waitFor(() => expect(focus).toHaveBeenCalled());
  });

  it('close(oldSession) has no effect on a more recent edit', async () => {
    const { flow, store } = setup();
    await store.open(null, 'Accueil');
    const id = store.dashboard()?.id as string;
    flow.open();
    const old = flow.editingSession() as number;
    await store.open(id, 'Accueil');
    flow.open();
    flow.close(old);
    expect(flow.phase()).toBe('editing');
    flow.close(flow.editingSession() as number);
    expect(flow.phase()).toBe('idle');
  });
});
