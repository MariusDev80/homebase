import { ApplicationInitStatus, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  DASHBOARD_REPOSITORY,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
  type Dashboard,
} from '../../data';
import { BackupError, BackupService } from '../backup/backup.service';
import type { BackupErrorDto } from '../backup/backup.types';
import { DashboardListStore } from '../dashboard/dashboard-list.store';
import { DashboardStore } from '../dashboard/dashboard.store';
import { provideAppI18n } from '../i18n';
import { AppLock } from '../lock/app-lock';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { DashboardDeleteDialogComponent } from './dashboard-delete-dialog.component';

describe('DashboardDeleteDialogComponent', () => {
  let repository: FakeDashboardRepository;
  let instances: FakeWidgetInstanceRepository;
  let list: DashboardListStore;
  let lock: AppLock;
  let fixture: ComponentFixture<DashboardDeleteDialogComponent>;
  let closed: boolean[];
  let events: string[];
  let current: ReturnType<typeof signal<Dashboard | null>>;
  let deleteDashboard: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let lockedDuringDelete: boolean[];
  let lockedAtNavigate: boolean[];

  async function open(options: { widgets?: number; viewed?: 'target' | 'none' } = {}) {
    repository = new FakeDashboardRepository();
    instances = new FakeWidgetInstanceRepository();
    await repository.create({ name: 'Accueil' });
    await repository.create({ name: 'Pro' });
    const target = repository.items[0] as Dashboard;
    for (let i = 0; i < (options.widgets ?? 2); i++) instances.seed({ dashboardId: target.id });
    events = [];
    lockedDuringDelete = [];
    lockedAtNavigate = [];
    deleteDashboard = vi.fn(() => {
      events.push('delete');
      lockedDuringDelete.push(lock.isLocked());
      return Promise.resolve();
    });
    current = signal<Dashboard | null>(options.viewed === 'target' ? target : null);
    TestBed.configureTestingModule({
      imports: [DashboardDeleteDialogComponent],
      providers: [
        provideAppI18n(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: DASHBOARD_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
        { provide: BackupService, useValue: { deleteDashboard } },
        { provide: DashboardStore, useValue: { dashboard: current } },
      ],
    });
    await TestBed.compileComponents();
    await TestBed.inject(ApplicationInitStatus).donePromise;
    list = TestBed.inject(DashboardListStore);
    lock = TestBed.inject(AppLock);
    await list.load('Accueil');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(() => {
      events.push('navigate');
      lockedAtNavigate.push(lock.isLocked());
      return Promise.resolve(true);
    });
    vi.spyOn(list, 'prepareRemoval').mockImplementation(() => {
      events.push('prepare');
      return Promise.resolve();
    });
    closed = [];
    fixture = TestBed.createComponent(DashboardDeleteDialogComponent);
    fixture.componentRef.setInput('dashboard', target);
    fixture.componentInstance.closed.subscribe((value) => closed.push(value));
    await fixture.whenStable();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q('dashboard-delete-cancel')).not.toBeNull();
      expect(q('dashboard-delete-warning')).not.toBeNull();
    });
  }

  const q = (id: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const confirmButton = (): HTMLButtonElement => q('dashboard-delete-confirm') as HTMLButtonElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const acknowledge = async (): Promise<void> => {
    const box = q('dashboard-delete-acknowledge') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
  };
  const confirm = async (): Promise<void> => {
    confirmButton().click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(closed.length > 0 || errorText() !== undefined).toBe(true);
    });
    await settle();
  };
  const fail = (dto: BackupErrorDto): void => {
    deleteDashboard.mockImplementation(() => {
      lockedDuringDelete.push(lock.isLocked());
      return Promise.reject(new BackupError(dto));
    });
  };
  const errorText = (): string | undefined => q('dashboard-delete-error')?.textContent?.trim();

  afterEach(() => {
    document.querySelectorAll('p-dialog, .p-dialog-mask').forEach((node) => node.remove());
  });

  it('requires the checkbox when the dashboard holds widgets, and focuses Cancel first', async () => {
    await open();
    expect(confirmButton().disabled).toBe(true);
    expect(document.activeElement).toBe(q('dashboard-delete-cancel'));
    await acknowledge();
    expect(confirmButton().disabled).toBe(false);
  });

  it('shows the count, notes, tasks, shortcuts and the safety backup', async () => {
    await open();
    const text = document.body.textContent;
    expect(text).toContain('2 widgets');
    expect(text).toContain('notes');
    expect(text).toContain('tâches');
    expect(text).toContain('raccourcis');
    expect(text).toContain('sauvegarde de sécurité');
  });

  it('has no checkbox for an empty dashboard', async () => {
    await open({ widgets: 0 });
    expect(q('dashboard-delete-acknowledge')).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  it('blocks the confirmation when the count fails', async () => {
    repository = new FakeDashboardRepository();
    instances = new FakeWidgetInstanceRepository();
    await repository.create({ name: 'Accueil' });
    await repository.create({ name: 'Pro' });
    instances.failNext(new Error('db'));
    TestBed.configureTestingModule({
      imports: [DashboardDeleteDialogComponent],
      providers: [
        provideAppI18n(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: DASHBOARD_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
        { provide: BackupService, useValue: { deleteDashboard: vi.fn() } },
        { provide: DashboardStore, useValue: { dashboard: signal(null) } },
      ],
    });
    await TestBed.compileComponents();
    await TestBed.inject(ApplicationInitStatus).donePromise;
    await TestBed.inject(DashboardListStore).load('Accueil');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fixture = TestBed.createComponent(DashboardDeleteDialogComponent);
    fixture.componentRef.setInput('dashboard', repository.items[0]);
    await fixture.whenStable();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q('dashboard-delete-count-error')).not.toBeNull();
    });
    expect(confirmButton().disabled).toBe(true);
  });

  it('deletes under the lock, rereads the list and releases the lock', async () => {
    await open();
    await acknowledge();
    await confirm();
    expect(events).toEqual(['prepare', 'delete']);
    expect(lockedDuringDelete).toEqual([true]);
    expect(deleteDashboard).toHaveBeenCalledWith(repository.items[0]?.id);
    expect(lock.isLocked()).toBe(false);
    expect(closed).toEqual([true]);
  });

  it('navigates to the neighbour before taking the lock when it is the current dashboard', async () => {
    await open({ viewed: 'target' });
    await acknowledge();
    await confirm();
    expect(navigate).toHaveBeenCalledWith(['/dashboards', repository.items[1]?.id]);
    expect(events).toEqual(['navigate', 'prepare', 'delete']);
    expect(lockedAtNavigate).toEqual([false]);
    expect(closed).toEqual([true]);
  });

  it('navigates away first when the URL shows the dashboard but the store is empty', async () => {
    await open();
    const target = repository.items[0] as Dashboard;
    await TestBed.inject(Router).navigateByUrl(`/dashboards/${target.id}`);
    await acknowledge();
    await confirm();
    expect(navigate).toHaveBeenCalledWith(['/dashboards', repository.items[1]?.id]);
    expect(lockedAtNavigate).toEqual([false]);
    expect(closed).toEqual([true]);
  });

  it('forgets the dashboard and closes when only the reread fails after the deletion', async () => {
    await open();
    vi.spyOn(list, 'afterRemoval').mockRejectedValue(new Error('reread'));
    await acknowledge();
    await confirm();
    expect(errorText()).toBeUndefined();
    expect(closed).toEqual([true]);
    expect(lock.isLocked()).toBe(false);
    expect(list.dashboards().map((d) => d.name)).toEqual(['Pro']);
  });

  it('shows the generic message for restart_pending', async () => {
    await open();
    fail({ kind: 'restart_pending' });
    await acknowledge();
    await confirm();
    expect(errorText()).toContain('Rien n');
  });

  it('shows the singular warning for one widget', async () => {
    await open({ widgets: 1 });
    expect(q('dashboard-delete-warning')?.textContent).toContain('Son widget');
  });

  it('does not navigate for another dashboard', async () => {
    await open();
    await acknowledge();
    await confirm();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('stops with a message when the navigation fails, without lock', async () => {
    await open({ viewed: 'target' });
    navigate.mockImplementation(() => Promise.resolve(false));
    await acknowledge();
    await confirm();
    expect(deleteDashboard).not.toHaveBeenCalled();
    expect(errorText()).toContain('Impossible de supprimer');
    expect(closed).toEqual([]);
  });

  it('puts the focus back on Cancel after a failure', async () => {
    await open();
    fail({ kind: 'busy' });
    await acknowledge();
    confirmButton().focus();
    expect(document.activeElement).toBe(confirmButton());
    await confirm();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(document.activeElement).toBe(q('dashboard-delete-cancel'));
    });
    expect(closed).toEqual([]);
  });

  it('treats not_found as already deleted', async () => {
    await open();
    fail({ kind: 'not_found' });
    repository.items.splice(0, 1);
    await acknowledge();
    await confirm();
    expect(closed).toEqual([true]);
    expect(list.dashboards().map((d) => d.name)).toEqual(['Pro']);
  });

  it.each([
    [{ kind: 'last_dashboard' } as BackupErrorDto, 'dernier tableau'],
    [{ kind: 'busy' } as BackupErrorDto, 'autre opération'],
    [{ kind: 'unavailable' } as BackupErrorDto, 'application Windows'],
    [{ kind: 'io', code: 'x' } as BackupErrorDto, 'Rien n'],
  ])('shows a message for %j, releases the lock and keeps the list', async (dto, text) => {
    await open();
    fail(dto);
    await acknowledge();
    await confirm();
    expect(errorText()).toContain(text);
    expect(lockedDuringDelete).toEqual([true]);
    expect(lock.isLocked()).toBe(false);
    expect(closed).toEqual([]);
    expect(list.dashboards().length).toBe(2);
  });

  it('releases the lock when flushing the writes fails', async () => {
    await open();
    vi.spyOn(list, 'prepareRemoval').mockRejectedValue(new Error('flush'));
    await acknowledge();
    await confirm();
    expect(deleteDashboard).not.toHaveBeenCalled();
    expect(lock.isLocked()).toBe(false);
    expect(errorText()).toBeDefined();
  });

  it('closes on Escape at rest', async () => {
    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual([false]);
  });

  it('ignores Escape during the deletion', async () => {
    await open();
    let release: () => void = () => undefined;
    deleteDashboard.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await acknowledge();
    confirmButton().click();
    await vi.waitFor(() => expect(lock.isLocked()).toBe(true));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual([]);
    release();
    await vi.waitFor(() => expect(closed).toEqual([true]));
  });
});
