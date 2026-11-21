import { TestBed } from '@angular/core/testing';
import { UserTimeZone } from '../../core/time';
import { mountCalendar } from './testing/calendar-harness';
import type { CalendarResult } from './testing/calendar-harness';

const config = { view: 'agenda', agendaDays: 7 } as const;
const empty: CalendarResult = {
  events: [],
  failedSources: [],
  truncated: false,
  unavailable: false,
};

const tickFake = () => vi.advanceTimersByTimeAsync(0);

describe('CalendarComponent exact reload counts (m8)', () => {
  afterEach(() => vi.useRealTimers());

  async function mount() {
    vi.useFakeTimers();
    const listEvents = vi.fn(() => Promise.resolve(empty));
    const mounted = await mountCalendar({ tick: tickFake, config, listEvents });
    const advance = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      mounted.fixture.detectChanges();
    };
    return { ...mounted, listEvents, advance };
  }

  it('loads exactly once at mount', async () => {
    const { listEvents, advance } = await mount();
    await advance(1000);
    expect(listEvents).toHaveBeenCalledTimes(1);
  });

  it('reloads exactly once when local midnight passes, without any focus event', async () => {
    const { clock, listEvents, advance } = await mount();
    listEvents.mockClear();
    // 00:00:30 on the 19th in Paris; the Today timer (capped at 15 min) notices on its own.
    clock.set('2026-11-18T23:00:30.000Z');
    await advance(15 * 60 * 1000 + 1000);
    expect(listEvents).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(listEvents).toHaveBeenCalledTimes(1);
  });

  it('reloads exactly once when the time zone changes', async () => {
    const { fixture, listEvents, advance } = await mount();
    listEvents.mockClear();
    await TestBed.inject(UserTimeZone).setPreference('America/Santiago');
    fixture.detectChanges();
    await advance(1000);
    expect(listEvents).toHaveBeenCalledTimes(1);
  });

  it('does not reload any more after destroy, even on focus', async () => {
    const { fixture, listEvents, advance } = await mount();
    listEvents.mockClear();
    fixture.destroy();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(1000);
    expect(listEvents).not.toHaveBeenCalled();
  });
});
