import { TestBed } from '@angular/core/testing';
import { CalendarChanges } from '../../core/calendar/calendar-changes';
import { UserTimeZone } from '../../core/time';
import { fixture as fixtureOf } from './testing/calendar-fixtures';
import { mountCalendar } from './testing/calendar-harness';
import type { CalendarResult } from './testing/calendar-harness';

const config = { view: 'agenda', agendaDays: 7 } as const;
const empty: CalendarResult = {
  events: [],
  failedSources: [],
  truncated: false,
  unavailable: false,
};

describe('CalendarComponent reloads (CA-C3-2)', () => {
  afterEach(() => vi.useRealTimers());

  async function mount() {
    const listEvents = vi.fn(() => Promise.resolve(empty));
    const mounted = await mountCalendar({ config, listEvents });
    listEvents.mockClear();
    vi.useFakeTimers();
    const advance = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      mounted.fixture.detectChanges();
    };
    return { ...mounted, listEvents, advance };
  }

  it('reloads once, 300 ms after a notify (also after three close notifies)', async () => {
    const { fixture, listEvents, advance } = await mount();
    const changes = TestBed.inject(CalendarChanges);
    changes.notify('todo');
    fixture.detectChanges();
    await advance(299);
    expect(listEvents).not.toHaveBeenCalled();
    await advance(1);
    expect(listEvents).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i++) {
      changes.notify('reminders');
      fixture.detectChanges();
      await advance(50);
    }
    await advance(300);
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('reloads on focus and on visibilitychange', async () => {
    const { clock, listEvents, advance } = await mount();
    window.dispatchEvent(new Event('focus'));
    await advance(300);
    expect(listEvents).toHaveBeenCalledTimes(1);
    clock.set('2026-11-18T10:00:05.000Z');
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(300);
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('reloads when Today changes and when the time zone changes', async () => {
    const { fixture, clock, listEvents, advance } = await mount();
    clock.set('2026-11-19T10:00:00.000Z');
    window.dispatchEvent(new Event('focus'));
    await advance(400);
    // Today moved: the anchor followed it (M2), hence a new range, loaded at once.
    expect(listEvents.mock.calls.length).toBeGreaterThanOrEqual(1);
    listEvents.mockClear();
    await TestBed.inject(UserTimeZone).setPreference('America/Santiago');
    fixture.detectChanges();
    await advance(400);
    expect(listEvents).toHaveBeenCalled();
  });

  it('keeps the most recent response when two arrive in reverse order', async () => {
    const resolvers: ((result: CalendarResult) => void)[] = [];
    const listEvents = vi.fn(
      () => new Promise<CalendarResult>((resolve) => resolvers.push(resolve)),
    );
    const { fixture, el } = await mountCalendar({ config, listEvents });
    vi.useFakeTimers();
    const changes = TestBed.inject(CalendarChanges);
    changes.notify('todo');
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(300);
    expect(resolvers).toHaveLength(2);
    // The second request answers first, then the first one answers late.
    resolvers[1]({ ...empty, events: [fixtureOf('F1')] });
    await vi.advanceTimersByTimeAsync(0);
    resolvers[0]({ ...empty, events: [fixtureOf('F2')] });
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const text = el.textContent ?? '';
    expect(text).toContain('F1 Rappel 09:00 Paris');
    expect(text).not.toContain('F2 Rappel 23:30 Paris');
  });
});

describe('CalendarComponent anchor follows the day (M2)', () => {
  it('moves an anchor that was on today to the new day', async () => {
    const { el, clock, settle } = await mountCalendar({ config });
    const title = () => el.querySelector('[data-testid="calendar-title"]')!.textContent;
    const before = title();
    clock.set('2026-11-19T10:00:00.000Z');
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(title()).not.toBe(before);
    expect(el.querySelector('[data-testid="calendar-day-pill"]')!.textContent).toContain(
      "Aujourd'hui",
    );
    expect(el.querySelector('section[data-day="2026-11-19"]')).not.toBeNull();
  });

  it('leaves an anchor that was navigated elsewhere', async () => {
    const { el, clock, settle } = await mountCalendar({ config });
    el.querySelector<HTMLElement>('[data-testid="calendar-next"]')!.click();
    await settle();
    const before = el.querySelector('[data-testid="calendar-title"]')!.textContent;
    clock.set('2026-11-19T10:00:00.000Z');
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(el.querySelector('[data-testid="calendar-title"]')!.textContent).toBe(before);
  });
});

describe('CalendarToolbar group (M5)', () => {
  it('is a labelled group, not a toolbar', async () => {
    const { el } = await mountCalendar({ config });
    const group = el.querySelector('[data-testid="calendar-toolbar"]')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Navigation du calendrier');
    expect(el.querySelector('[role="toolbar"]')).toBeNull();
  });
});
