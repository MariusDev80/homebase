import type { Mock } from 'vitest';
import { DestroyRef } from '@angular/core';
import { DueRefresher } from './due-refresher';
import { ManualClock } from './testing/manual-clock';

describe('DueRefresher', () => {
  let clock: ManualClock;
  let refresh: Mock<() => void>;
  let destroyCallbacks: (() => void)[];
  let refresher: DueRefresher;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock = new ManualClock('2026-11-16T10:00:00.000Z');
    refresh = vi.fn<() => void>();
    destroyCallbacks = [];
    const destroyRef = {
      onDestroy: (cb: () => void) => {
        destroyCallbacks.push(cb);
        return () => undefined;
      },
    } as DestroyRef;
    refresher = new DueRefresher(document, clock, destroyRef, refresh);
  });
  afterEach(() => {
    destroyCallbacks.forEach((cb) => cb());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('refreshes 1 s after the deadline', () => {
    refresher.arm('2026-11-16T10:00:30.000Z');
    vi.advanceTimersByTime(30_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('backs off 1 s, 2 s, 4 s... up to 30 s for a deadline already passed', () => {
    const late = '2026-11-16T09:00:00.000Z';
    for (const wait of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      refresh.mockClear();
      refresher.arm(late);
      vi.advanceTimersByTime(wait - 1);
      expect(refresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    }
  });

  it('resets the back-off when the deadline changes', () => {
    refresher.arm('2026-11-16T09:00:00.000Z');
    vi.advanceTimersByTime(1000);
    refresher.arm('2026-11-16T09:00:00.000Z');
    vi.advanceTimersByTime(2000);
    refresher.arm('2026-11-16T09:30:00.000Z');
    refresh.mockClear();
    vi.advanceTimersByTime(999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('cancels an armed timer when the window becomes hidden', () => {
    refresher.arm('2026-11-16T10:00:30.000Z');
    expect(vi.getTimerCount()).toBe(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts focus and visibilitychange fired together once', () => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);
    clock.advance(249);
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);
    clock.advance(1);
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('caps a far deadline at 15 minutes', () => {
    refresher.arm('2026-11-17T10:00:00.000Z');
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('arms nothing without a deadline and replaces a previous timer', () => {
    refresher.arm('2026-11-16T10:00:30.000Z');
    refresher.arm(null);
    expect(vi.getTimerCount()).toBe(0);
    refresher.arm('2026-11-16T10:00:05.000Z');
    refresher.arm('2026-11-16T10:00:10.000Z');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('refreshes on focus and when visible again, and arms nothing while hidden', () => {
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);
    clock.advance(300);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
    refresher.arm('2026-11-16T10:00:30.000Z');
    expect(vi.getTimerCount()).toBe(0);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
