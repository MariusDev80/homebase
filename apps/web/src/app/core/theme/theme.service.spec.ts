import { TestBed } from '@angular/core/testing';
import { THEME_PREFERENCE_STORE, ThemeMode, ThemePreferenceStore } from './theme-preference.store';
import { ThemeService } from './theme.service';

class FakeMediaQuery {
  matches: boolean;
  private listeners: ((event: MediaQueryListEvent) => void)[] = [];

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  emit(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((l) => l({ matches } as MediaQueryListEvent));
  }
}

describe('ThemeService', () => {
  let query: FakeMediaQuery;
  let store: ThemePreferenceStore & {
    save: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
  };

  function setup(systemDark: boolean, saved: ThemeMode | null = null): ThemeService {
    query = new FakeMediaQuery(systemDark);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => query,
    });
    store = {
      load: vi.fn().mockResolvedValue(saved),
      save: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: THEME_PREFERENCE_STORE, useValue: store }],
    });
    return TestBed.inject(ThemeService);
  }

  const isDarkClass = (): boolean => document.documentElement.classList.contains('app-dark');

  afterEach(() => {
    document.documentElement.classList.remove('app-dark');
    delete (window as unknown as Record<string, unknown>)['matchMedia'];
  });

  it('cycles system -> light -> dark -> system', () => {
    const service = setup(false);
    expect(service.mode()).toBe('system');
    service.cycle();
    expect(service.mode()).toBe('light');
    service.cycle();
    expect(service.mode()).toBe('dark');
    service.cycle();
    expect(service.mode()).toBe('system');
  });

  it('follows prefers-color-scheme in system mode and reacts to changes', () => {
    const service = setup(true);
    expect(service.effectiveTheme()).toBe('dark');
    query.emit(false);
    expect(service.effectiveTheme()).toBe('light');
    query.emit(true);
    expect(service.effectiveTheme()).toBe('dark');
  });

  it('ignores the system preference in explicit modes', () => {
    const service = setup(true);
    service.setMode('light');
    expect(service.effectiveTheme()).toBe('light');
    query.emit(false);
    service.setMode('dark');
    expect(service.effectiveTheme()).toBe('dark');
  });

  it('adds and removes the app-dark class on <html>', () => {
    const service = setup(false);
    TestBed.tick();
    expect(isDarkClass()).toBe(false);
    service.setMode('dark');
    TestBed.tick();
    expect(isDarkClass()).toBe(true);
    service.setMode('light');
    TestBed.tick();
    expect(isDarkClass()).toBe(false);
    service.setMode('system');
    query.emit(true);
    TestBed.tick();
    expect(isDarkClass()).toBe(true);
  });

  it('calls the store on every change', () => {
    const service = setup(false);
    service.cycle();
    service.cycle();
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenNthCalledWith(1, 'light');
    expect(store.save).toHaveBeenNthCalledWith(2, 'dark');
  });

  it('loads the initial preference from the store', async () => {
    const service = setup(false, 'dark');
    await service.ready;
    expect(store.load).toHaveBeenCalledOnce();
    expect(service.mode()).toBe('dark');
    expect(service.effectiveTheme()).toBe('dark');
  });

  it('does not override a choice made before the stored preference arrived', async () => {
    const service = setup(false, 'dark');
    service.setMode('light');
    await service.ready;
    expect(service.mode()).toBe('light');
  });

  it('keeps system mode when nothing is stored', async () => {
    const service = setup(false, null);
    await service.ready;
    expect(service.mode()).toBe('system');
  });
});
