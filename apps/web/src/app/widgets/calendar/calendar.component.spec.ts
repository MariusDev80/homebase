import { F10_COUNT } from './testing/calendar-fixtures';
import { mountCalendar } from './testing/calendar-harness';
import type { CalendarResult } from './testing/calendar-harness';

const MORE_HINT = `Voir les ${F10_COUNT - 2} autres événements de ce jour`;

const config = { view: 'agenda', agendaDays: 7 } as const;

describe('CalendarComponent banners (CA-C2-11)', () => {
  it('shows the desktop-only banner when the sources are unavailable', async () => {
    const { el } = await mountCalendar({
      config,
      flags: { failedSources: ['reminders', 'todo'], unavailable: true },
    });
    expect(el.querySelector('[data-testid="calendar-unavailable"]')!.textContent).toContain(
      "Disponible uniquement dans l'application Windows.",
    );
    expect(el.querySelector('[data-testid="calendar-partial"]')).toBeNull();
  });

  it('shows the partial banner when one source failed', async () => {
    const { el } = await mountCalendar({ config, flags: { failedSources: ['todo'] } });
    const banner = el.querySelector('[data-testid="calendar-partial"]')!;
    expect(banner.classList.contains('flash-attention')).toBe(true);
    expect(banner.textContent).toContain("Certains éléments n'ont pas pu être chargés.");
    expect(el.querySelector('[data-testid="calendar-unavailable"]')).toBeNull();
  });

  it('shows the truncated banner', async () => {
    const { el } = await mountCalendar({ config, flags: { truncated: true } });
    expect(el.querySelector('[data-testid="calendar-truncated"]')!.textContent).toContain(
      '2000 premiers',
    );
  });

  it('shows no banner when everything loaded', async () => {
    const { el } = await mountCalendar({ config });
    expect(el.querySelector('.flash')).toBeNull();
  });
});

describe('CalendarComponent failures and navigation', () => {
  const failing = () => Promise.reject(new Error('boom'));
  const ok = (extra: Partial<CalendarResult> = {}): CalendarResult => ({
    events: [],
    failedSources: [],
    truncated: false,
    unavailable: false,
    ...extra,
  });

  it('retries the Month when "Mois" is chosen again after a failure (I1)', async () => {
    let fail = true;
    const { el, settle } = await mountCalendar({
      styles: () => (fail ? Promise.reject(new Error('x')) : Promise.resolve()),
    });
    expect(el.querySelector('[data-testid="calendar-month-failed"]')).not.toBeNull();
    fail = false;
    el.querySelector<HTMLElement>('[data-testid="calendar-view-month"]')!.click();
    await settle();
    expect(el.querySelector('[data-testid="calendar-month-failed"]')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-month-host"]')).not.toBeNull();
  });

  it.each(['calendar-prev', 'calendar-next', 'calendar-today'])(
    'closes the Day panel on %s (I2)',
    async (testId) => {
      const { el, settle } = await mountCalendar();
      el.querySelector<HTMLElement>(`[title="${MORE_HINT}"]`)!.click();
      await settle();
      expect(el.querySelector('[data-testid="calendar-day-panel"]')).not.toBeNull();
      // The area is inert while the panel is open: drive the toolbar button directly.
      el.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.click();
      await settle();
      expect(el.querySelector('[data-testid="calendar-day-panel"]')).toBeNull();
    },
  );

  it('shows neither the empty state nor stale banners when the first load fails (M1)', async () => {
    const { el } = await mountCalendar({ config, listEvents: failing });
    expect(el.querySelector('[data-testid="calendar-load-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="calendar-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-agenda"]')).toBeNull();
  });

  it('hides the partial and truncated banners of a previous load once it fails (M1)', async () => {
    let calls = 0;
    const { el, settle } = await mountCalendar({
      config,
      listEvents: () =>
        ++calls === 1
          ? Promise.resolve(ok({ failedSources: ['todo'], truncated: true }))
          : failing(),
    });
    expect(el.querySelector('[data-testid="calendar-partial"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="calendar-truncated"]')).not.toBeNull();
    el.querySelector<HTMLElement>('[data-testid="calendar-next"]')!.click();
    await settle();
    expect(el.querySelector('[data-testid="calendar-load-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="calendar-partial"]')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-truncated"]')).toBeNull();
  });
});

describe('CalendarComponent ResizeObserver (B1)', () => {
  const original = globalThis.ResizeObserver;
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  it('feeds the size to the view and disconnects on destroy', async () => {
    const disconnect = vi.fn();
    let callback: ResizeObserverCallback | null = null;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        callback = cb;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnect;
    } as unknown as typeof ResizeObserver;
    const { fixture, el, settle } = await mountCalendar({
      config: { view: 'month', agendaDays: 7 },
    });
    expect(callback).not.toBeNull();
    callback!(
      [{ contentRect: { width: 400, height: 400 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    await settle();
    expect(el.querySelector('[data-testid="calendar-month-host"]')).toBeNull();
    expect(disconnect).not.toHaveBeenCalled();
    fixture.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
