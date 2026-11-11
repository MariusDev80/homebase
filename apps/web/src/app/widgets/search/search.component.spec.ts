import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DashboardStore } from '../../core/dashboard/dashboard.store';
import { FakeWidgetInstanceRepository } from '../../core/testing/fake-widget-instance.repository';
import { provideAppI18n } from '../../core/i18n';
import { WidgetFocus } from '../../core/dashboard/widget-focus';
import { UrlOpener } from '../../core/system';
import { FakeNoteRepository } from '../../core/testing/fake-note.repository';
import { FakeShortcutRepository } from '../../core/testing/fake-shortcut.repository';
import { FakeTodoRepository } from '../../core/testing/fake-todo.repository';
import { WIDGET_CONTEXT } from '../../core/widgets';
import type { WidgetContext } from '../../core/widgets';
import {
  NOTE_REPOSITORY,
  SHORTCUT_REPOSITORY,
  TODO_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
} from '../../data';
import type { Clock } from '../../data';
import { SEARCH_DEBOUNCE_MS, SearchComponent } from './search.component';
import type { SearchConfig } from './search.config';

async function render(engine: SearchConfig['engine'] = 'duckduckgo') {
  const clock = { nowIso: () => '2026-01-01T00:00:00.000Z' } as Clock;
  const shortcuts = new FakeShortcutRepository();
  const notes = new FakeNoteRepository();
  const todos = new FakeTodoRepository(clock);
  const open = vi.fn().mockResolvedValue(undefined);
  const focusInstance = vi
    .fn<(id: string) => Promise<'focused' | 'not-found' | 'unplaced'>>()
    .mockResolvedValue('focused');
  const config = signal<SearchConfig>({ engine });
  const updateConfig = vi.fn((next: SearchConfig): Promise<void> => {
    config.set(next);
    return Promise.resolve();
  });
  const ctx: WidgetContext<SearchConfig> = {
    instanceId: 'inst-1',
    type: 'search',
    config,
    size: signal({ w: 6, h: 1 }),
    permissions: new Set(['open-url']),
    updateConfig,
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: SHORTCUT_REPOSITORY, useValue: shortcuts },
      { provide: NOTE_REPOSITORY, useValue: notes },
      { provide: TODO_REPOSITORY, useValue: todos },
      { provide: UrlOpener, useValue: { open } },
      { provide: WidgetFocus, useValue: { focusInstance } },
      // SearchHotkey dependencies (the Ctrl+K navigation has its own spec).
      { provide: WIDGET_INSTANCE_REPOSITORY, useValue: new FakeWidgetInstanceRepository() },
      { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(false) } },
      {
        provide: DashboardStore,
        useValue: {
          dashboard: () => null,
          session: () => 1,
          whenOpened: () => Promise.resolve('ready'),
        },
      },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(SearchComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const input = el.querySelector('[data-testid="search-input"]') as HTMLInputElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };
  const type = async (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    input.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  return {
    fixture,
    el,
    input,
    q,
    settle,
    type,
    press,
    shortcuts,
    notes,
    todos,
    open,
    focusInstance,
    updateConfig,
  };
}

describe('SearchComponent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('follows ARIA 1.2 combobox attributes', async () => {
    const t = await render();
    expect(t.input.getAttribute('role')).toBe('combobox');
    expect(t.input.getAttribute('aria-expanded')).toBe('false');
    expect(t.input.getAttribute('aria-controls')).toBe(t.q('search-listbox')?.id);
    await t.type('a');
    expect(t.input.getAttribute('aria-expanded')).toBe('true');
    expect(t.q('search-listbox')?.getAttribute('role')).toBe('listbox');
  });

  it('debounces the search', async () => {
    const t = await render();
    t.shortcuts.seed('Angular', 'https://angular.dev');
    const spy = vi.spyOn(t.shortcuts, 'search');
    await t.type('a');
    await t.type('an');
    await t.type('ang');
    await t.settle(SEARCH_DEBOUNCE_MS - 1);
    expect(spy).not.toHaveBeenCalled();
    await t.settle(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('ang', 5);
    expect(t.q('search-option-0')?.textContent).toContain('Angular');
  });

  it('shows grouped results, the web entry last, and an announcement', async () => {
    const t = await render();
    t.shortcuts.seed('Angular', 'https://angular.dev');
    t.notes.seed({ id: 'n1', title: 'Angular notes', widgetInstanceId: 'w1' });
    await t.type('angular');
    await t.settle(SEARCH_DEBOUNCE_MS);
    const headers = Array.from(t.el.querySelectorAll('[role="group"] > [role="presentation"]')).map(
      (h) => h.textContent?.trim(),
    );
    expect(headers).toEqual(['Raccourcis', 'Notes']);
    expect(t.el.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(t.q('search-option-web')?.textContent).toContain(
      'Rechercher « angular » sur DuckDuckGo',
    );
    expect(t.q('search-status')?.textContent).toContain('2 résultat');
  });

  it('highlights matches with elements, never HTML', async () => {
    const t = await render();
    t.notes.seed({ id: 'n1', title: '<img src=x onerror=alert(1)> foo', widgetInstanceId: 'w' });
    await t.type('foo');
    await t.settle(SEARCH_DEBOUNCE_MS);
    const option = t.q('search-option-0') as HTMLElement;
    expect(option.querySelector('img')).toBeNull();
    expect(option.querySelector('mark')?.textContent).toBe('foo');
    expect(option.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows a todo description excerpt highlighted, as text only', async () => {
    const t = await render();
    const list = t.todos.seedList('w1');
    t.todos.seed(list.id, 'Ranger', { description: 'foo <img src=x onerror=alert(1)>' });
    t.todos.seed(list.id, 'foo sans description');
    await t.type('foo');
    await t.settle(SEARCH_DEBOUNCE_MS);
    const withExcerpt = t.q('search-option-0') as HTMLElement;
    expect(withExcerpt.querySelector('img')).toBeNull();
    expect(withExcerpt.querySelector('.text-xs mark')?.textContent).toBe('foo');
    expect(withExcerpt.textContent).toContain('foo <img src=x onerror=alert(1)>');
    const without = t.q('search-option-1') as HTMLElement;
    expect(without.querySelector('.text-xs')).toBeNull();
  });

  it('navigates with arrows (wrapping), tracks aria-activedescendant, Enter activates', async () => {
    const t = await render();
    t.shortcuts.seed('Angular', 'https://angular.dev');
    t.notes.seed({ id: 'n1', title: 'Angular', widgetInstanceId: 'w1' });
    await t.type('angular');
    await t.settle(SEARCH_DEBOUNCE_MS);
    expect(t.input.getAttribute('aria-activedescendant')).toBeNull();

    t.press('ArrowDown');
    expect(t.input.getAttribute('aria-activedescendant')).toBe(t.q('search-option-0')?.id);
    expect(t.q('search-option-0')?.getAttribute('aria-selected')).toBe('true');
    t.press('ArrowDown');
    t.press('ArrowDown');
    expect(t.input.getAttribute('aria-activedescendant')).toBe(t.q('search-option-web')?.id);
    t.press('ArrowDown');
    expect(t.input.getAttribute('aria-activedescendant')).toBe(t.q('search-option-0')?.id);
    t.press('ArrowUp');
    expect(t.input.getAttribute('aria-activedescendant')).toBe(t.q('search-option-web')?.id);
    t.press('ArrowUp');
    t.press('ArrowUp');
    t.press('Enter');
    await t.settle();
    expect(t.open).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'search' }),
      'https://angular.dev',
    );
    expect(t.input.getAttribute('aria-expanded')).toBe('false');
  });

  it('Enter without selection searches the web with the encoded query', async () => {
    const t = await render('google');
    await t.type('a&b #c é d');
    const event = t.press('Enter');
    await t.settle();
    expect(event.defaultPrevented).toBe(true);
    const url = t.open.mock.calls[0][1] as string;
    expect(url).toBe('https://www.google.com/search?q=a%26b+%23c+%C3%A9+d');
  });

  it('uses the selected engine and saves a change', async () => {
    const t = await render('duckduckgo');
    const select = t.q('search-engine') as HTMLSelectElement;
    select.value = 'bing';
    select.dispatchEvent(new Event('change'));
    await t.settle();
    expect(t.updateConfig).toHaveBeenCalledWith({ engine: 'bing' });
    await t.type('x');
    t.press('Enter');
    await t.settle();
    expect(t.open.mock.calls[0][1]).toBe('https://www.bing.com/search?q=x');
  });

  it('Escape closes the list, then clears the field', async () => {
    const t = await render();
    await t.type('abc');
    await t.settle(SEARCH_DEBOUNCE_MS);
    expect(t.press('Escape').defaultPrevented).toBe(true);
    expect(t.input.getAttribute('aria-expanded')).toBe('false');
    expect(t.input.value).toBe('abc');
    t.press('Escape');
    expect(t.input.value).toBe('');
  });

  it('opens a note or a todo by focusing its widget, with a message when missing', async () => {
    const t = await render();
    t.notes.seed({ id: 'n1', title: 'Courses', widgetInstanceId: 'w1' });
    t.notes.seed({ id: 'n2', title: 'Courses libres', widgetInstanceId: null });
    await t.type('courses');
    await t.settle(SEARCH_DEBOUNCE_MS);
    t.press('ArrowDown');
    t.press('Enter');
    await t.settle();
    expect(t.focusInstance).toHaveBeenCalledWith('w1');
    expect(t.q('search-message')).toBeNull();

    await t.type('courses');
    await t.settle(SEARCH_DEBOUNCE_MS);
    t.press('ArrowDown');
    t.press('ArrowDown');
    t.press('Enter');
    await t.settle();
    expect(t.q('search-message')?.textContent).toContain("n'existe plus");

    t.focusInstance.mockResolvedValue('not-found');
    await t.type('courses');
    await t.settle(SEARCH_DEBOUNCE_MS);
    t.press('ArrowDown');
    t.press('Enter');
    await t.settle();
    expect(t.q('search-message')).not.toBeNull();
  });

  it('says so when the widget has no room on the grid of its dashboard', async () => {
    const t = await render();
    t.focusInstance.mockResolvedValue('unplaced');
    t.notes.seed({ id: 'n1', title: 'Courses', widgetInstanceId: 'w1' });
    await t.type('courses');
    await t.settle(SEARCH_DEBOUNCE_MS);
    t.press('ArrowDown');
    t.press('Enter');
    await t.settle();
    expect(t.q('search-message')?.textContent).toContain('ne tient pas sur la grille');
  });

  describe('list placement', () => {
    const rectOf = (top: number, bottom: number): DOMRect =>
      ({ top, bottom, left: 10, width: 300, height: bottom - top }) as DOMRect;

    it('opens below the field when there is room', async () => {
      const t = await render();
      vi.spyOn(t.input, 'getBoundingClientRect').mockReturnValue(rectOf(100, 130));
      await t.type('a');
      const list = t.q('search-listbox') as HTMLElement;
      expect(list.style.top).toBe('134px');
      expect(list.style.bottom).toBe('');
    });

    it('opens above the field when the room below is short and the room above is larger', async () => {
      const t = await render();
      const height = window.innerHeight;
      vi.spyOn(t.input, 'getBoundingClientRect').mockReturnValue(rectOf(height - 100, height - 70));
      await t.type('a');
      const list = t.q('search-listbox') as HTMLElement;
      expect(list.style.top).toBe('');
      expect(list.style.bottom).toBe('104px');
      expect(list.style.maxHeight).toBe(`${height - 120}px`);
    });
  });

  it('shows the empty state and a partial error', async () => {
    const t = await render();
    await t.type('zzz');
    await t.settle(SEARCH_DEBOUNCE_MS);
    expect(t.q('search-empty')).not.toBeNull();

    t.todos.failNext(new Error('db'));
    await t.type('yyy');
    await t.settle(SEARCH_DEBOUNCE_MS);
    expect(t.q('search-partial-error')?.textContent).toContain('Tâches');
    expect(t.q('search-empty')).toBeNull();
  });

  it('reports a link that cannot be opened', async () => {
    const t = await render();
    t.shortcuts.seed('Angular', 'https://angular.dev');
    t.open.mockRejectedValueOnce(new Error('nope'));
    await t.type('angular');
    await t.settle(SEARCH_DEBOUNCE_MS);
    t.press('ArrowDown');
    t.press('Enter');
    await t.settle();
    expect(t.q('search-message')?.textContent).toContain("Impossible d'ouvrir");
  });

  describe('global shortcuts', () => {
    const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };

    it('Ctrl+K focuses the field from anywhere', async () => {
      const t = await render();
      const event = key({ key: 'k', ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(t.input);
    });

    it('/ focuses the field outside text fields only', async () => {
      const t = await render();
      const other = document.createElement('textarea');
      document.body.appendChild(other);
      other.focus();
      const ignored = key({ key: '/' }, other);
      expect(ignored.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(other);

      other.blur();
      const handled = key({ key: '/' });
      expect(handled.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(t.input);
    });

    it('is unregistered when the widget is destroyed', async () => {
      const t = await render();
      t.fixture.destroy();
      expect(key({ key: '/' }).defaultPrevented).toBe(false);
    });
  });
});
