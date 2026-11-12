import { ApplicationInitStatus } from '@angular/core';
import { BackupService } from '../backup';
import { AppLock } from '../lock';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER } from '../time';
import { SETTINGS_REPOSITORY } from '../../data';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAppI18n } from '../i18n';
import { ThemeService } from '../theme';
import { LayoutComponent } from './layout.component';

describe('LayoutComponent', () => {
  async function render(): Promise<HTMLElement> {
    TestBed.configureTestingModule({ providers: [provideAppI18n(), provideRouter([])] });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    const fixture = TestBed.createComponent(LayoutComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    document.documentElement.classList.remove('app-dark');
    delete (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it.each(['restore', 'import'] as const)(
    'freezes the header and the page and shows the status overlay during a %s',
    async (kind) => {
      const el = await render();
      const lock = TestBed.inject(AppLock);
      const region = el.querySelector('[data-testid="app-lock-status"]');
      expect(region?.getAttribute('role')).toBe('status');
      expect(el.querySelector('[data-testid="app-lock-overlay"]')).toBeNull();
      expect(el.querySelector('header')?.hasAttribute('inert')).toBe(false);

      lock.lock(kind);
      TestBed.tick();
      expect(el.querySelector('header')?.hasAttribute('inert')).toBe(true);
      expect(el.querySelector('main')?.hasAttribute('inert')).toBe(true);
      // Same live region node, outside the inert area, filled afterwards.
      expect(el.querySelector('[data-testid="app-lock-status"]')).toBe(region);
      expect(region?.closest('[inert]')).toBeNull();
      expect(region?.textContent).toContain(
        kind === 'restore' ? 'Restauration en cours' : 'Opération en cours',
      );

      lock.unlock();
      TestBed.tick();
      expect(el.querySelector('main')?.hasAttribute('inert')).toBe(false);
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
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
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

  it('renders landmarks and translated navigation links', async () => {
    const el = await render();
    expect(el.querySelector('header')).not.toBeNull();
    expect(el.querySelector('main')).not.toBeNull();
    const nav = el.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Navigation principale');
    const links = Array.from(nav?.querySelectorAll('a') ?? []).map((a) => a.textContent?.trim());
    expect(links).toEqual(['Tableau de bord', 'Réglages']);
    expect(el.querySelector('header')?.textContent).toContain('Homebase');
  });

  it('cycles the theme when the toggle is clicked and updates its label', async () => {
    const el = await render();
    const theme = TestBed.inject(ThemeService);
    const button = el.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]');
    expect(button?.getAttribute('aria-label')).toContain('Système');

    button?.click();
    expect(theme.mode()).toBe('light');
    await TestBed.inject(ThemeService).ready;
    TestBed.tick();
    await vi.waitFor(() => expect(button?.getAttribute('aria-label')).toContain('Clair'));

    button?.click();
    expect(theme.mode()).toBe('dark');
  });
});
