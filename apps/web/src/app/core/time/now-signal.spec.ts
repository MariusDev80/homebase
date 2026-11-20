import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CLOCK } from '../../data';
import { createNowSignal } from './now-signal';
import { ManualClock } from './testing/manual-clock';

describe('createNowSignal', () => {
  let clock: ManualClock;
  let destroyCallbacks: (() => void)[];
  let destroyRef: DestroyRef;

  function create(period: 1000 | 60000) {
    return TestBed.runInInjectionContext(() => createNowSignal(period, destroyRef));
  }

  /** Moves the clock and the fake timers together. */
  function elapse(ms: number): void {
    clock.advance(ms);
    vi.advanceTimersByTime(ms);
  }

  function setVisibility(state: 'visible' | 'hidden'): void {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock = new ManualClock('2026-11-16T10:00:00.400Z');
    destroyCallbacks = [];
    destroyRef = {
      onDestroy: (cb: () => void) => {
        destroyCallbacks.push(cb);
        return () => undefined;
      },
    } as DestroyRef;
    TestBed.configureTestingModule({ providers: [{ provide: CLOCK, useValue: clock }] });
  });
  afterEach(() => {
    destroyCallbacks.forEach((cb) => cb());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts at the current instant', () => {
    expect(create(1000)()).toBe('2026-11-16T10:00:00.400Z');
  });

  it('ticks on the next multiple of the period', () => {
    const now = create(1000);
    elapse(599);
    expect(now()).toBe('2026-11-16T10:00:00.400Z');
    elapse(1);
    expect(now()).toBe('2026-11-16T10:00:01.000Z');
    elapse(1000);
    expect(now()).toBe('2026-11-16T10:00:02.000Z');
  });

  it('aligns a one-minute period on the minute', () => {
    const now = create(60000);
    elapse(59599);
    expect(now()).toBe('2026-11-16T10:00:00.400Z');
    elapse(1);
    expect(now()).toBe('2026-11-16T10:01:00.000Z');
  });

  it('is suspended while hidden and resumes on visibilitychange', () => {
    const now = create(1000);
    setVisibility('hidden');
    elapse(5000);
    expect(now()).toBe('2026-11-16T10:00:00.400Z');
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('visible');
    expect(now()).toBe('2026-11-16T10:00:05.400Z');
    expect(vi.getTimerCount()).toBe(1);
    elapse(600);
    expect(now()).toBe('2026-11-16T10:00:06.000Z');
  });

  it('is recomputed on focus', () => {
    const now = create(60000);
    clock.advance(10_000);
    window.dispatchEvent(new Event('focus'));
    expect(now()).toBe('2026-11-16T10:00:10.400Z');
  });

  it('stops everything on destroy', () => {
    const now = create(1000);
    destroyCallbacks.forEach((cb) => cb());
    expect(vi.getTimerCount()).toBe(0);
    clock.advance(10_000);
    window.dispatchEvent(new Event('focus'));
    expect(now()).toBe('2026-11-16T10:00:00.400Z');
  });
});
