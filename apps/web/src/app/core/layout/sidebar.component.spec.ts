import { ApplicationInitStatus } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideAppI18n } from '../i18n';
import { SidebarComponent } from './sidebar.component';

function rect(top: number, height = 40, left = 8): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + 40,
    width: 40,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe('SidebarComponent', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideAppI18n(), provideRouter([{ path: '**', children: [] }])],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    fixture = TestBed.createComponent(SidebarComponent);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  const bubble = (testId: string): HTMLAnchorElement =>
    el.querySelector<HTMLAnchorElement>(`[data-testid="${testId}"]`) as HTMLAnchorElement;
  const label = (): HTMLElement | null => el.querySelector<HTMLElement>('.sidebar-label');
  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('is a nav of named links, without menubar role', () => {
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Navigation principale');
    expect(el.querySelector('[role="menubar"]')).toBeNull();
    expect(bubble('sidebar-dashboard').getAttribute('aria-label')).toBe('Tableau de bord');
    expect(bubble('sidebar-settings').getAttribute('aria-label')).toBe('Réglages');
    expect(bubble('sidebar-dashboard').getAttribute('href')).toBe('/');
    expect(bubble('sidebar-settings').getAttribute('href')).toBe('/settings');
  });

  it('marks the active bubble with aria-current', async () => {
    await TestBed.inject(Router).navigateByUrl('/settings');
    await flush();
    expect(bubble('sidebar-settings').getAttribute('aria-current')).toBe('page');
    expect(bubble('sidebar-dashboard').hasAttribute('aria-current')).toBe(false);
  });

  it('shows the text bubble on mouseenter (text in a span), removes it on mouseleave', async () => {
    const a = bubble('sidebar-settings');
    vi.spyOn(a, 'getBoundingClientRect').mockReturnValue(rect(100));
    a.dispatchEvent(new Event('mouseenter'));
    await flush();
    const l = label();
    expect(l?.getAttribute('aria-hidden')).toBe('true');
    expect(l?.querySelector('span')?.textContent).toBe('Réglages');
    expect(l?.style.top).toBe('104px');
    expect(l?.style.left).toBe('56px');

    a.dispatchEvent(new Event('mouseleave'));
    await flush();
    expect(label()).toBeNull();
  });

  it.each([
    [true, true],
    [false, false],
  ])('focusin with :focus-visible=%s shows the label: %s', async (visible, shown) => {
    const a = bubble('sidebar-dashboard');
    vi.spyOn(a, 'matches').mockImplementation((selector: string) =>
      selector === ':focus-visible' ? visible : false,
    );
    a.dispatchEvent(new Event('focusin'));
    await flush();
    expect(label() !== null).toBe(shown);
    if (shown) {
      a.dispatchEvent(new Event('focusout'));
      await flush();
      expect(label()).toBeNull();
    }
  });

  it('removes the label on Escape', async () => {
    bubble('sidebar-settings').dispatchEvent(new Event('mouseenter'));
    await flush();
    expect(label()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(label()).toBeNull();
  });

  it('repositions the label on list scroll and removes it when the anchor leaves the area', async () => {
    const a = bubble('sidebar-dashboard');
    const area = el.querySelector<HTMLElement>('ul.sidebar-group-scroll') as HTMLElement;
    const anchorRect = vi.spyOn(a, 'getBoundingClientRect').mockReturnValue(rect(100));
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(rect(50, 300));
    a.dispatchEvent(new Event('mouseenter'));
    await flush();
    expect(label()?.style.top).toBe('104px');

    anchorRect.mockReturnValue(rect(70));
    area.dispatchEvent(new Event('scroll'));
    await flush();
    expect(label()?.style.top).toBe('74px');

    anchorRect.mockReturnValue(rect(-20));
    area.dispatchEvent(new Event('scroll'));
    await flush();
    expect(label()).toBeNull();
  });
});
