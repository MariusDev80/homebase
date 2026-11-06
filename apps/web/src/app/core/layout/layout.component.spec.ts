import { ApplicationInitStatus } from '@angular/core';
import { BackupService } from '../backup';
import { AppLock } from '../lock';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER } from '../time';
import { DASHBOARD_REPOSITORY, SETTINGS_REPOSITORY, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAppI18n } from '../i18n';

import { LayoutComponent } from './layout.component';

/** No root provider for the repositories: the layout loads the list of dashboards. */
function fakeRepositories() {
  return [
    { provide: DASHBOARD_REPOSITORY, useValue: new FakeDashboardRepository() },
    { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
    { provide: WIDGET_INSTANCE_REPOSITORY, useValue: new FakeWidgetInstanceRepository() },
  ];
}

describe('LayoutComponent', () => {
  async function render(): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [provideAppI18n(), provideRouter([]), ...fakeRepositories()],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    const fixture = TestBed.createComponent(LayoutComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    document.documentElement.classList.remove('app-dark');
    delete (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it.each(['restore', 'import', 'delete'] as const)(
    'freezes the sidebar and the page and shows the status overlay during a %s',
    async (kind) => {
      const el = await render();
      const lock = TestBed.inject(AppLock);
      const region = el.querySelector('[data-testid="app-lock-status"]');
      expect(region?.getAttribute('role')).toBe('status');
      expect(el.querySelector('[data-testid="app-lock-overlay"]')).toBeNull();
      expect(el.querySelector('app-sidebar')?.hasAttribute('inert')).toBe(false);

      lock.lock(kind);
      TestBed.tick();
      expect(el.querySelector('app-sidebar')?.hasAttribute('inert')).toBe(true);
      expect(el.querySelector('main')?.hasAttribute('inert')).toBe(true);
      // Same live region node, outside the inert area, filled afterwards.
      expect(el.querySelector('[data-testid="app-lock-status"]')).toBe(region);
      expect(region?.closest('[inert]')).toBeNull();
      expect(region?.textContent).toContain(
        {
          restore: 'Restauration en cours',
          import: 'Opération en cours',
          delete: 'Suppression du tableau en cours',
        }[kind],
      );

      lock.unlock();
      TestBed.tick();
      expect(el.querySelector('main')?.hasAttribute('inert')).toBe(false);
      expect(el.querySelector('app-sidebar')?.hasAttribute('inert')).toBe(false);
      expect(el.querySelector('[data-testid="app-lock-overlay"]')).toBeNull();
    },
  );

  it('loads the backup banner inside the desktop shell', async () => {
    (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    TestBed.configureTestingModule({
      providers: [
        provideAppI18n(),
        provideRouter([]),
        {
          provide: BackupService,
          useValue: { isAvailable: () => false, overview: vi.fn(), acknowledge: vi.fn() },
        },
        ...fakeRepositories(),
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    const fixture = TestBed.createComponent(LayoutComponent);
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="backup-alert-region"]')).not.toBeNull();
    });
  });

  it('renders a sidebar and a main landmark, with no header, app name or theme button', async () => {
    const el = await render();
    expect(el.querySelector('header')).toBeNull();
    expect(el.querySelector('app-sidebar')).not.toBeNull();
    expect(el.querySelector('main')).not.toBeNull();
    const nav = el.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Navigation principale');
    const links = Array.from(nav?.querySelectorAll('a') ?? []).map((a) =>
      a.getAttribute('aria-label'),
    );
    expect(links).toEqual(['Accueil', 'Réglages']);
    expect(el.textContent).not.toContain('Homebase');
    expect(el.querySelector('[data-testid="theme-toggle"]')).toBeNull();
  });
});
