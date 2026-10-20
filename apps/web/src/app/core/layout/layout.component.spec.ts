import { ApplicationInitStatus } from '@angular/core';
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

  afterEach(() => document.documentElement.classList.remove('app-dark'));

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
